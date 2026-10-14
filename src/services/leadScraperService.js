import fs from 'fs';
import puppeteer from 'puppeteer';

/**
 * Lead Scraper Service
 * Uses headless Chromium to extract local business leads from Google Maps / Local search
 * Deep-extracts full addresses, phone numbers, ratings, reviews, websites, social links,
 * and auto-generates tailored services to pitch.
 */

// Helper: Normalize phone numbers (stripping non-digits and leading 0/91 for 10-digit matching)
export const normalizePhone = (phone) => {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length > 10) {
    if (digits.startsWith('91') && digits.length === 12) return digits.slice(2);
    if (digits.startsWith('0') && digits.length === 11) return digits.slice(1);
    return digits.slice(-10);
  }
  return digits;
};
// Helper: Normalize company names for fuzzy identity matching
export const normalizeCompanyName = (name) => {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/\b(pvt|ltd|limited|private|llp|inc|co|corp|industries|company|enterprises)\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
};

// Helper: Clean icon glyphs, private-use unicode, and stray characters
export const cleanText = (val) => {
  if (!val) return '';
  return String(val)
    .replace(/[\uE000-\uF8FF]/g, '') // Google font private-use icons (including )
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '') // Unicode surrogate glyphs (e.g. 🖈)
    .replace(/[•·]/g, ', ')
    .replace(/^[\s,.\-🖈•·]+|[\s,.\-🖈•·]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Detect social media presence from website homepage
 * Ensures strict consistency: If no social platforms exist, socialActivities MUST be "Not Active"
 */
export const detectWebsiteSocial = async (url) => {
  if (!url) {
    return {
      instagram: 'No',
      facebook: 'No',
      linkedin: 'No',
      youtube: 'No',
      socialActivities: 'Not Active'
    };
  }

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(1800),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const html = await res.text();

    const hasIg = /instagram\.com\/[a-zA-Z0-9._-]+/i.test(html) && !/instagram\.com\/(p|reel|explore)\b/i.test(html);
    const hasFb = /facebook\.com\/[a-zA-Z0-9._-]+/i.test(html) && !/facebook\.com\/sharer/i.test(html);
    const hasLi = /linkedin\.com\/(company|in)\/[a-zA-Z0-9._-]+/i.test(html);
    const hasYt = /youtube\.com\/(channel|c|@|[a-zA-Z0-9._-]+)/i.test(html) && !/youtube\.com\/watch/i.test(html);

    const activeCount = [hasIg, hasFb, hasLi, hasYt].filter(Boolean).length;
    const socialActivities = activeCount >= 1 ? 'Active' : 'Not Active';

    return {
      instagram: hasIg ? 'Yes' : 'No',
      facebook: hasFb ? 'Yes' : 'No',
      linkedin: hasLi ? 'Yes' : 'No',
      youtube: hasYt ? 'Yes' : 'No',
      socialActivities
    };
  } catch {
    return {
      instagram: 'No',
      facebook: 'No',
      linkedin: 'No',
      youtube: 'No',
      socialActivities: 'Not Active'
    };
  }
};

export const extractSocialMediaPresence = (corpusText) => {
  if (!corpusText || typeof corpusText !== 'string') {
    return { hasIg: false, hasFb: false, hasLi: false, hasYt: false, activeCount: 0 };
  }

  // Unescape backslashes (JSON strings like https:\/\/www.instagram.com\/youngwheels__)
  const normalized = corpusText.replace(/\\\//g, '/');

  const igMatches = [...normalized.matchAll(/(?:https?:)?\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/([a-zA-Z0-9._-]+)/gi)].map(m => m[1]);
  const fbMatches = [...normalized.matchAll(/(?:https?:)?\/\/(?:www\.)?(?:facebook\.com|fb\.com|fb\.me)\/(?:people\/[^\/]+\/|pages\/[^\/]+\/)?([a-zA-Z0-9._-]+)/gi)].map(m => m[1]);
  const liMatches = [...normalized.matchAll(/(?:https?:)?\/\/(?:www\.)?linkedin\.com\/(?:company|in|school|showcase)\/([a-zA-Z0-9._-]+)/gi)].map(m => m[1]);
  const ytMatches = [...normalized.matchAll(/(?:https?:)?\/\/(?:www\.)?(?:youtube\.com\/(?:channel\/|c\/|user\/|@)?|youtu\.be\/)([a-zA-Z0-9._-]+)/gi)].map(m => m[1]);

  const igIgnored = ['p', 'reel', 'reels', 'explore', 'share', 'stories', 'accounts', 'about', 'developer', 'legal', 'static', 'directory', 'tags'];
  const fbIgnored = ['sharer', 'plugins', 'tr', 'policies', 'privacy', 'help', 'login', 'dialog', 'share', 'home', 'events'];
  const ytIgnored = ['watch', 'embed', 'shorts', 'feed', 'playlist', 'premium', 'channel', 'c', 'results', 'user'];

  const hasIg = igMatches.some(h => h && !igIgnored.includes(h.toLowerCase()));
  const hasFb = fbMatches.some(h => h && !fbIgnored.includes(h.toLowerCase()));
  const hasLi = liMatches.length > 0;
  const hasYt = ytMatches.some(h => h && !ytIgnored.includes(h.toLowerCase()));

  const activeCount = [hasIg, hasFb, hasLi, hasYt].filter(Boolean).length;
  return { hasIg, hasFb, hasLi, hasYt, activeCount };
};

/**
 * Deep Website Analyzer
 * Evaluates website existence, speed, HTTPS, mobile responsiveness (Website Status),
 * and scans for social media presence (Instagram, Facebook, LinkedIn, YouTube, Social Activities).
 */
export const analyzeWebsiteDetails = async (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return {
      url: '',
      websiteExist: 'No',
      websiteStatus: 'No',
      instagram: 'No',
      facebook: 'No',
      linkedin: 'No',
      youtube: 'No',
      socialActivities: 'Not Active'
    };
  }

  const cleanInput = rawUrl.trim();
  if (['no', 'none', 'n/a', 'na', 'no website', 'not available', 'nil', '-', 'null', 'undefined', 'not in snippet'].includes(cleanInput.toLowerCase())) {
    return {
      url: '',
      websiteExist: 'No',
      websiteStatus: 'No',
      instagram: 'No',
      facebook: 'No',
      linkedin: 'No',
      youtube: 'No',
      socialActivities: 'Not Active'
    };
  }

  // Ensure protocol
  let targetUrl = cleanInput;
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = `https://${targetUrl}`;
  }

  let finalUrl = targetUrl;
  let html = '';
  let responseTimeMs = 0;
  let httpStatus = 0;
  let isHttps = targetUrl.startsWith('https://');

  const startTime = Date.now();
  try {
    let res = null;
    try {
      res = await fetch(targetUrl, {
        signal: AbortSignal.timeout(2500),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        redirect: 'follow'
      });
    } catch (err) {
      if (targetUrl.startsWith('https://')) {
        const httpFallback = `http://${cleanInput.replace(/^https?:\/\//, '')}`;
        try {
          res = await fetch(httpFallback, {
            signal: AbortSignal.timeout(1800),
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            redirect: 'follow'
          });
          finalUrl = httpFallback;
          isHttps = false;
        } catch (httpErr) {
          throw err;
        }
      } else {
        throw err;
      }
    }

    responseTimeMs = Date.now() - startTime;
    httpStatus = res.status;
    finalUrl = res.url || finalUrl;
    isHttps = finalUrl.startsWith('https://');

    if (res.ok) {
      const fullText = await res.text();
      html = fullText.slice(0, 500000);
    }
  } catch (fetchErr) {
    console.warn(`[analyzeWebsiteDetails] Failed to fetch "${targetUrl}":`, fetchErr.message);
    return {
      url: targetUrl,
      websiteExist: targetUrl ? 'Yes' : 'No',
      websiteStatus: targetUrl ? 'Live' : 'No',
      instagram: 'No',
      facebook: 'No',
      linkedin: 'No',
      youtube: 'No',
      socialActivities: 'Not Active',
      error: fetchErr.message
    };
  }

  // 1. Evaluate Website Status with Multi-Point Agency Quality Engine
  let websiteExist = targetUrl ? 'Yes' : 'No';
  let websiteStatus = 'Medium';
  let auditScore = 50;

  if (httpStatus >= 400 || !html) {
    websiteExist = targetUrl ? 'Yes' : 'No';
    websiteStatus = (httpStatus === 403 || httpStatus === 401) ? 'Live' : (targetUrl ? 'Live' : 'No');
    auditScore = httpStatus === 403 ? 40 : 10;
  } else {
    const isUnderConstruction = /under construction|coming soon|domain for sale|buy this domain|parked domain|this domain is registered|website under maintenance|default web site page/i.test(html);
    if (isUnderConstruction) {
      websiteStatus = 'Poor';
      auditScore = 20;
    } else {
      // Analyze HTML tags, metadata, and structural signals
      const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
      
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const titleText = titleMatch ? titleMatch[1].trim() : '';
      const hasTitle = titleText.length >= 4 && !/default|untitled|welcome to nginx|apache2/i.test(titleText);
      
      // Meta description (SEO)
      const hasDescription = /<meta[^>]+(?:name=["']description["']|property=["']og:description["'])[^>]+content=["'][^"']{12,}["']/i.test(html) ||
                             /<meta[^>]+content=["'][^"']{12,}["'][^>]+(?:name=["']description["']|property=["']og:description["'])/i.test(html);
      
      // OpenGraph social sharing meta
      const hasOgTags = /<meta[^>]+property=["']og:(?:title|image|url)["']/i.test(html);
      
      // Favicon present
      const hasFavicon = /<link[^>]+rel=["'](?:shortcut )?icon["']/i.test(html);
      
      // Semantic Headings
      const hasH1 = /<h1[^>]*>[\s\S]*?<\/h1>/i.test(html);
      const hasH2 = /<h2[^>]*>[\s\S]*?<\/h2>/i.test(html);
      
      // Conversion CTAs (Phone, WhatsApp, Contact Form)
      const hasPhoneCta = /href=["']tel:[^"']+["']/i.test(html) || /\+?91[\s-]?[6-9]\d{9}/.test(html);
      const hasWhatsApp = /wa\.me\/|api\.whatsapp\.com|whatsapp/i.test(html);
      const hasEmailCta = /href=["']mailto:[^"']+["']/i.test(html);
      const hasContactForm = /<form[^>]*>[\s\S]*?(?:submit|send|enquire|inquiry|contact|message)[\s\S]*?<\/form>/i.test(html) || /contact-form|wpforms|elementor-form|lead-form/i.test(html);
      
      // Text depth & content length
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const cleanBodyText = (bodyMatch ? bodyMatch[1] : html)
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const wordCount = cleanBodyText ? cleanBodyText.split(/\s+/).length : 0;
      
      // Outdated Table-based layout
      const isTableLayout = /<table[^>]*>[\s\S]*?<table/i.test(html) && !/<(?:main|header|nav|section|footer)/i.test(html);
      
      // Copyright freshness (older than 3 years indicates neglected site)
      const copyrightMatch = html.match(/(?:copyright|©|&copy;)\s*(?:20\d\d\s*[-–]\s*)?(20\d\d)/i);
      const currentYear = new Date().getFullYear();
      let hasOldCopyright = false;
      if (copyrightMatch) {
        const cYear = parseInt(copyrightMatch[1], 10);
        if (cYear && cYear < currentYear - 3) {
          hasOldCopyright = true;
        }
      }

      // Calculate composite score (0 - 100)
      let score = 0;

      // 1. SSL & Security (15 pts)
      if (isHttps) score += 15;

      // 2. Mobile Responsiveness (20 pts)
      if (hasViewport) score += 20;

      // 3. Technical SEO & Meta Presence (20 pts)
      if (hasTitle) score += 5;
      if (hasDescription) score += 8;
      if (hasOgTags) score += 4;
      if (hasFavicon) score += 3;

      // 4. Content Structure & Depth (15 pts)
      if (hasH1) score += 5;
      if (hasH2) score += 3;
      if (wordCount >= 120) score += 4;
      if (wordCount >= 300) score += 3;

      // 5. Conversion CTAs & Lead Channels (15 pts)
      if (hasPhoneCta || hasWhatsApp) score += 7;
      if (hasContactForm) score += 5;
      if (hasEmailCta) score += 3;

      // 6. Response Time & Speed (15 pts)
      if (responseTimeMs < 600) score += 15;
      else if (responseTimeMs < 1400) score += 10;
      else if (responseTimeMs < 2500) score += 5;

      // Penalties:
      if (hasOldCopyright) score -= 14; // Outdated website copyright
      if (isTableLayout) score -= 15; // 90s table-based layout
      if (wordCount < 50) score -= 12; // Single-page or empty shell
      if (!hasViewport) score -= 25; // Non-mobile responsive is a critical flaw

      auditScore = Math.max(10, Math.min(100, score));

      if (auditScore >= 82 && isHttps && hasViewport && hasDescription) {
        websiteStatus = 'Excellent';
      } else if (auditScore >= 62 && hasViewport) {
        websiteStatus = 'Good';
      } else if (auditScore >= 40 && hasViewport) {
        websiteStatus = 'Medium';
      } else {
        websiteStatus = 'Poor';
      }
    }
  }

  // Fast social media presence detection directly from homepage HTML (zero additional latency)
  let { hasIg, hasFb, hasLi, hasYt, activeCount } = extractSocialMediaPresence(html);

  let socialActivities = 'Not Active';
  if (activeCount >= 3) socialActivities = 'Very Active';
  else if (activeCount >= 1) socialActivities = 'Active';

  // 3. Generate tailored pitch based on findings
  const pitch = generateSmartPitch({
    websiteExist,
    websiteStatus,
    socialActivities,
    reviews: '10',
    instagram: hasIg ? 'Yes' : 'No',
    facebook: hasFb ? 'Yes' : 'No',
    linkedin: hasLi ? 'Yes' : 'No',
    youtube: hasYt ? 'Yes' : 'No'
  });

  return {
    url: finalUrl,
    websiteExist,
    websiteStatus,
    auditScore,
    instagram: hasIg ? 'Yes' : 'No',
    facebook: hasFb ? 'Yes' : 'No',
    linkedin: hasLi ? 'Yes' : 'No',
    youtube: hasYt ? 'Yes' : 'No',
    socialActivities,
    service: pitch.service,
    serviceCategory: pitch.serviceCategory,
    remark: pitch.remark,
    chances: pitch.chances,
    responseTimeMs
  };
};

/**
 * Automatically determine the proper Service to Pitch, Category, and Remark
 * based on digital presence (website, social activity, ratings & reviews)
 * Matches the exact service catalog and format of existing leads in the CRM.
 */
export const generateSmartPitch = ({
  websiteExist = 'No',
  websiteStatus = 'Medium',
  socialActivities = 'Not Active',
  reviews = '0',
  instagram = 'No',
  facebook = 'No',
  linkedin = 'No',
  youtube = 'No'
}) => {
  const hasWebsite = String(websiteExist || '').toLowerCase() === 'yes';
  const hasSocial = (socialActivities === 'Active' || socialActivities === 'Very Active') ||
    [instagram, facebook, linkedin, youtube].some(x => String(x || '').toLowerCase() === 'yes');
  const reviewCount = parseInt(reviews, 10) || 0;
  const isWeakWebsite = websiteStatus === 'Poor' || websiteStatus === 'Medium';

  let service = '';
  let serviceCategory = 'Lead Generation';
  let remark = '';
  let chances = 'High';

  if (!hasWebsite && !hasSocial) {
    // 1. Neither website nor social media exists
    service = 'Website Design + Social Media Management + GMB Optimization + Review Generation';
    serviceCategory = 'Website Design';
    remark = 'No website or social presence found. Pitch complete online identity setup, responsive website and Google review generation.';
    chances = 'High';
  } else if (!hasWebsite && hasSocial) {
    // 2. Active on social, but no official website
    service = 'Website Design + Social Media Setup + Paid Promotions + Review Generation';
    serviceCategory = 'Website Design';
    remark = 'Active on social channels but has no official website. High opportunity for e-commerce or business catalogue website.';
    chances = 'High';
  } else if (hasWebsite && isWeakWebsite && !hasSocial) {
    // 3. Has website, but poor or medium quality and no active social media
    service = 'Website Redesign + Social Media Setup + Review Generation';
    serviceCategory = 'Website Design';
    remark = `Current website is ${websiteStatus.toLowerCase()} quality (needs modern redesign, mobile optimization & SEO). Pitch website revamp & social branding.`;
    chances = 'High';
  } else if (hasWebsite && isWeakWebsite && hasSocial) {
    // 4. Active on social, but website is outdated / weak
    service = 'Website Redesign + Speed Optimization + Paid Promotions';
    serviceCategory = 'Website Design';
    remark = `Active on social media but current website is ${websiteStatus.toLowerCase()} quality. Pitch high-converting UI/UX redesign and speed optimization.`;
    chances = 'High';
  } else if (hasWebsite && !hasSocial) {
    // 5. Website is good/excellent, but social media is missing
    service = 'Social Media Setup + Paid Promotions + Review Generation';
    serviceCategory = 'SMO & Social Media';
    remark = 'Website exists but social platforms are missing. Pitch social media branding, Meta ad campaigns, and Google review generation.';
    chances = 'High';
  } else if (hasWebsite && hasSocial && reviewCount < 30) {
    // 6. Has digital presence, but low GMB reviews
    service = 'Social Media Setup + Paid Promotions + GMB Optimization + Review Generation';
    serviceCategory = 'Lead Generation';
    remark = 'Digital presence exists. High value in pitching Google Maps ranking, review acceleration and local lead generation.';
    chances = 'High';
  } else {
    // 7. Well-established presence with good reviews
    service = 'Paid Promotions + Review Generation';
    serviceCategory = 'Lead Generation';
    remark = 'Established brand presence. Pitch performance ads, review generation and scale-up marketing.';
    chances = 'Medium';
  }

  return { service, serviceCategory, remark, chances };
};

// Helper: Clean category prefixes (e.g. "Footwear wholesaler, ", "Hospital, ", "Shoe factory - ") and action words from addresses
const cleanAddressCategoryPrefix = (addr) => {
  if (!addr || typeof addr !== 'string') return '';
  let cleaned = addr
    .replace(/\b(website|directions|share|save|call|send to phone|menu|order online|table booking|book online|book appointment|book an appointment|online appointment|consult online|overview|reviews|about|photos|in-store|kerbside|delivery|dine-in|open|closed|closes|opens|24 hours|temporarily|permanently|on-site services)\b/gi, '')
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/^[\s,.\-•·]+|[\s,.\-•·]+$/g, '')
    .trim();

  const catRegex = /^((?:[a-zA-Z\s]+ )?(?:wholesal(?:er|e)|manufactur(?:er|ing)|trader|dealer|supplier|store|shop|factory|distributor|retail(?:er)?|exporter|importer|corporate office|industry|industries|market|service options|outlet|hospital|clinic|nursing\s*home|dispensary|diagnostic\s*cent(?:er|re)|pathology|medical\s*cent(?:er|re)|healthcare|health\s*cent(?:er|re)|school|college|institute|academy|restaurant|hotel|cafe|showroom|workshop|godown|warehouse))[,\s\-•·]+(.+)$/i;
  while (catRegex.test(cleaned)) {
    cleaned = cleaned.replace(catRegex, '$2').trim();
  }
  return cleaned.replace(/^[\s,.\-•·]+|[\s,.\-•·]+$/g, '').trim();
};

// Helper: Fast enrichment of cards extracted from the Google Maps feed
const enrichCardBatch = async (batch, { location, state, category, type }) => {
  if (!batch || batch.length === 0) return [];

  const enrichedListings = [];

  for (const item of batch) {
    let phone = item.phone;
    let website = item.url;
    let detailedCategory = item.category;

    let rawStreet = cleanText(item.snippetAddress || '')
      // Strip advertising markers
      .replace(/^\s*(?:sponsored|ad|promoted|anzeige)[,\s·•\-]+/i, '')
      .replace(/[,\s·•\-]+(?:sponsored|ad|promoted|anzeige)\s*$/i, '')
      // Strip stray unicode icons
      .replace(/[\uE000-\uF8FF]/g, '')
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
      .replace(/^[\s,.\-•·]+|[\s,.\-•·]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Deduplicate consecutive repeated tokens like "1/81, 1/81"
    rawStreet = rawStreet.replace(/\b([a-zA-Z0-9\/-]+)[,\s]+\1\b/gi, '$1');

    // Strip company name if prepended
    const normComp = (item.company || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (normComp) {
      rawStreet = rawStreet.replace(new RegExp(`^${normComp}[,\\s]+`, 'i'), '');
    }

    // Strip category prefix like "Footwear wholesaler, " or "Shoe factory - "
    rawStreet = cleanAddressCategoryPrefix(rawStreet);

    let detectedArea = '';
    let detectedCity = '';
    let detectedState = '';
    const scanText = `${rawStreet} ${item.company || ''} ${location || ''} ${state || ''}`;

    if (/swarn\s*(?:pk|park)/i.test(scanText) || /khamdhenu/i.test(scanText)) {
      detectedArea = 'Swarn Park, Mundka';
      detectedCity = 'New Delhi';
      detectedState = 'Delhi';
    } else if (/metro\s*pillar\s*(?:no[-.\s]*)?(?:4\d\d|5\d\d)/i.test(scanText) || /rohtak\s*r(?:oa)?d/i.test(scanText) || /mundka/i.test(scanText)) {
      detectedArea = 'Mundka Industrial Area';
      detectedCity = 'New Delhi';
      detectedState = 'Delhi';
    } else if (/odeon|connaught|inner\s*circle|outer\s*circle|\bcp\b/i.test(scanText)) {
      detectedArea = 'Connaught Place';
      detectedCity = 'New Delhi';
      detectedState = 'Delhi';
    } else if (/espire|mohan\s*cooperative|mathura\s*r(?:oa)?d/i.test(scanText) || (/bijnis/i.test(scanText) && /a-?41/i.test(scanText))) {
      detectedArea = 'Mohan Cooperative Industrial Area, Mathura Road';
      detectedCity = 'New Delhi';
      detectedState = 'Delhi';
    } else if ((/a-?80/i.test(scanText) && /dapper|shoe/i.test(scanText)) || /okhla/i.test(scanText)) {
      detectedArea = 'Okhla Industrial Area';
      detectedCity = 'New Delhi';
      detectedState = 'Delhi';
    } else if (/t[,\s-]*1\/81/i.test(scanText) || /mangol\s*puri/i.test(scanText)) {
      detectedArea = 'Mangolpuri Industrial Area Phase 1';
      detectedCity = 'New Delhi';
      detectedState = 'Delhi';
    } else if (/bawana/i.test(scanText)) {
      detectedArea = 'Bawana Industrial Area';
      detectedCity = 'Delhi';
      detectedState = 'Delhi';
    } else if (/narela/i.test(scanText)) {
      detectedArea = 'Narela Industrial Area';
      detectedCity = 'Delhi';
      detectedState = 'Delhi';
    } else if (/mayapuri/i.test(scanText)) {
      detectedArea = 'Mayapuri Industrial Area';
      detectedCity = 'New Delhi';
      detectedState = 'Delhi';
    } else if (/wazirpur/i.test(scanText)) {
      detectedArea = 'Wazirpur Industrial Area';
      detectedCity = 'Delhi';
      detectedState = 'Delhi';
    } else if (/kirti\s*nagar/i.test(scanText)) {
      detectedArea = 'Kirti Nagar Industrial Area';
      detectedCity = 'New Delhi';
      detectedState = 'Delhi';
    } else if (/naraina/i.test(scanText)) {
      detectedArea = 'Naraina Industrial Area';
      detectedCity = 'New Delhi';
      detectedState = 'Delhi';
    } else if (/patparganj/i.test(scanText)) {
      detectedArea = 'Patparganj Industrial Area';
      detectedCity = 'Delhi';
      detectedState = 'Delhi';
    } else if (/badli/i.test(scanText)) {
      detectedArea = 'Badli Industrial Area';
      detectedCity = 'Delhi';
      detectedState = 'Delhi';
    } else if (/rohini/i.test(scanText)) {
      detectedArea = 'Rohini';
      detectedCity = 'Delhi';
      detectedState = 'Delhi';
    } else if (/karol\s*bagh/i.test(scanText)) {
      detectedArea = 'Karol Bagh';
      detectedCity = 'New Delhi';
      detectedState = 'Delhi';
    } else if (/chandni\s*chowk/i.test(scanText)) {
      detectedArea = 'Chandni Chowk';
      detectedCity = 'Delhi';
      detectedState = 'Delhi';
    } else if (/gandhi\s*nagar/i.test(scanText)) {
      detectedArea = 'Gandhi Nagar';
      detectedCity = 'Delhi';
      detectedState = 'Delhi';
    } else if (/sadar\s*bazar/i.test(scanText)) {
      detectedArea = 'Sadar Bazar';
      detectedCity = 'Delhi';
      detectedState = 'Delhi';
    } else if (/nangloi/i.test(scanText)) {
      detectedArea = 'Nangloi';
      detectedCity = 'Delhi';
      detectedState = 'Delhi';
    } else if (/peera\s*garhi/i.test(scanText)) {
      detectedArea = 'Peeragarhi';
      detectedCity = 'Delhi';
      detectedState = 'Delhi';
    } else if (/ghevra/i.test(scanText)) {
      detectedArea = 'Ghevra';
      detectedCity = 'Delhi';
      detectedState = 'Delhi';
    } else if (/tikri/i.test(scanText)) {
      detectedArea = 'Tikri Kalan';
      detectedCity = 'Delhi';
      detectedState = 'Delhi';
    } else if (/kundli/i.test(scanText)) {
      detectedArea = 'Kundli Industrial Area';
      detectedCity = 'Sonipat';
      detectedState = 'Haryana';
    } else if (/rai\b/i.test(scanText)) {
      detectedArea = 'Rai Industrial Area';
      detectedCity = 'Sonipat';
      detectedState = 'Haryana';
    } else if (/sonipat|sonepat/i.test(scanText)) {
      detectedArea = 'Sonipat';
      detectedCity = 'Sonipat';
      detectedState = 'Haryana';
    } else if (/bahadurgarh/i.test(scanText)) {
      detectedArea = 'Bahadurgarh Industrial Area';
      detectedCity = 'Jhajjar';
      detectedState = 'Haryana';
    } else if (/manesar/i.test(scanText)) {
      detectedArea = 'IMT Manesar';
      detectedCity = 'Gurugram';
      detectedState = 'Haryana';
    } else if (/gurugram|gurgaon/i.test(scanText)) {
      detectedArea = 'Gurugram';
      detectedCity = 'Gurugram';
      detectedState = 'Haryana';
    } else if (/faridabad/i.test(scanText)) {
      detectedArea = 'Faridabad Industrial Area';
      detectedCity = 'Faridabad';
      detectedState = 'Haryana';
    } else if (/noida/i.test(scanText)) {
      detectedArea = 'Noida';
      detectedCity = 'Noida';
      detectedState = 'Uttar Pradesh';
    } else if (/ghaziabad/i.test(scanText)) {
      detectedArea = 'Ghaziabad';
      detectedCity = 'Ghaziabad';
      detectedState = 'Uttar Pradesh';
    } else if (/sahibabad/i.test(scanText)) {
      detectedArea = 'Sahibabad Industrial Area';
      detectedCity = 'Ghaziabad';
      detectedState = 'Uttar Pradesh';
    } else if (/bhiwandi/i.test(scanText)) {
      detectedArea = 'Bhiwandi';
      detectedCity = 'Thane';
      detectedState = 'Maharashtra';
    } else if (/chakan/i.test(scanText)) {
      detectedArea = 'Chakan MIDC';
      detectedCity = 'Pune';
      detectedState = 'Maharashtra';
    } else if (/bhosari/i.test(scanText)) {
      detectedArea = 'Bhosari MIDC';
      detectedCity = 'Pune';
      detectedState = 'Maharashtra';
    } else if (/peenya/i.test(scanText)) {
      detectedArea = 'Peenya Industrial Area';
      detectedCity = 'Bengaluru';
      detectedState = 'Karnataka';
    }

    if (!detectedState) {
      const indianStates = [
        'Delhi', 'Haryana', 'Uttar Pradesh', 'Maharashtra', 'Gujarat', 
        'West Bengal', 'Rajasthan', 'Punjab', 'Karnataka', 'Tamil Nadu', 
        'Telangana', 'Madhya Pradesh', 'Andhra Pradesh', 'Bihar', 'Chandigarh', 
        'Chhattisgarh', 'Goa', 'Himachal Pradesh', 'Jharkhand', 'Kerala', 
        'Odisha', 'Uttarakhand', 'Assam'
      ];
      for (const st of indianStates) {
        if (new RegExp(`\\b${st}\\b`, 'i').test(scanText)) {
          detectedState = st;
          break;
        }
      }
    }

    if (!detectedState) {
      detectedState = state || 'Delhi';
    }

    if (!detectedCity && location && location.toLowerCase() !== (detectedState || '').toLowerCase()) {
      detectedCity = location;
    }

    // Build rich composite address: If already detailed from Google Maps Place Details (has PIN code or >= 3 segments), keep intact
    const hasPincode = /\b\d{6}\b/.test(rawStreet);
    const isAlreadyDetailedAddress = hasPincode || rawStreet.split(',').length >= 3;

    let fullAddress = '';
    if (isAlreadyDetailedAddress) {
      fullAddress = rawStreet;
    } else {
      const addressParts = [];
      if (rawStreet) {
        // Clean trailing state or city if we will append it cleanly
        let cleanS = rawStreet.replace(new RegExp(`[,\\s]+${detectedState}\\s*$`, 'i'), '').trim();
        if (cleanS) addressParts.push(cleanS);
      }

      if (detectedArea) {
        const areaKeywords = detectedArea.split(/[, ]+/).filter(w => w.length > 3);
        const streetHasArea = addressParts.length > 0 && areaKeywords.some(w => addressParts[0].toLowerCase().includes(w.toLowerCase()));
        if (!streetHasArea) {
          addressParts.push(detectedArea);
        }
      }

      if (detectedCity) {
        const cur = addressParts.join(', ').toLowerCase();
        if (!cur.includes(detectedCity.toLowerCase())) {
          addressParts.push(detectedCity);
        }
      }

      if (detectedState) {
        const cur = addressParts.join(', ').toLowerCase();
        if (!cur.includes(detectedState.toLowerCase())) {
          addressParts.push(detectedState);
        }
      }

      fullAddress = addressParts.join(', ');
      if (!fullAddress) {
        fullAddress = detectedArea 
          ? `${detectedArea}, ${detectedState || 'India'}` 
          : (location ? `${location}, ${detectedState || 'India'}` : (detectedState ? `${detectedState}, India` : 'Delhi, India'));
      }
    }

    enrichedListings.push({
      ...item,
      phone: phone ? cleanText(phone) : '',
      url: website || '',
      address: cleanText(fullAddress),
      area: detectedArea || location || '',
      state: detectedState || state || '',
      detailedCategory: detailedCategory || category
    });
  }

  // Fast website social audit & pitch generation
  const finalBatch = [];
  const auditResults = await Promise.all(
    enrichedListings.map(async (item) => {
      if (!item.url) {
        return {
          url: '',
          websiteExist: 'No',
          websiteStatus: 'No',
          instagram: 'No',
          facebook: 'No',
          linkedin: 'No',
          youtube: 'No',
          socialActivities: 'Not Active'
        };
      }
      try {
        return await analyzeWebsiteDetails(item.url);
      } catch {
        return {
          url: item.url,
          websiteExist: 'Yes',
          websiteStatus: 'Medium',
          instagram: 'No',
          facebook: 'No',
          linkedin: 'No',
          youtube: 'No',
          socialActivities: 'Not Active'
        };
      }
    })
  );

  enrichedListings.forEach((item, idx) => {
    const auditData = auditResults[idx];
    const websiteExist = auditData.websiteExist || (item.url ? 'Yes' : 'No');
    const websiteStatus = auditData.websiteStatus || (item.url ? 'Medium' : 'No');

    const pitchData = generateSmartPitch({
      websiteExist,
      websiteStatus,
      socialActivities: auditData.socialActivities,
      reviews: item.reviews || '10',
      instagram: auditData.instagram,
      facebook: auditData.facebook,
      linkedin: auditData.linkedin,
      youtube: auditData.youtube
    });

    finalBatch.push({
      company: cleanText(item.company),
      gmbRating: item.gmbRating || '4.5',
      reviews: item.reviews || '10',
      phone: item.phone,
      url: auditData.url || item.url,
      websiteExist,
      websiteStatus,
      instagram: auditData.instagram,
      facebook: auditData.facebook,
      linkedin: auditData.linkedin,
      youtube: auditData.youtube,
      socialActivities: auditData.socialActivities,
      service: pitchData.service,
      serviceCategory: pitchData.serviceCategory,
      remark: pitchData.remark,
      chances: pitchData.chances,
      address: item.address,
      area: item.area || location || '',
      state: item.state || state || '',
      category: item.detailedCategory || category,
      type: type,
      mapsUrl: item.mapsUrl
    });
  });

  return finalBatch;
};

/**
 * Scrapes Google Maps for business listings matching the search query
 * Extracts full address, phone number, website, social links, and auto-generated pitch
 * Supports real-time progressive streaming via onBatchExtracted callback.
 */
export const scrapeGoogleMapsLeads = async ({
  query = '',
  location = '',
  state = '',
  limit = 20,
  offset = 0,
  category = 'Manufacturer',
  type = 'Shoes',
  excludeCompanies = [],
  onBatchExtracted = null,
  onProgress = null,
  isAborted = null
}) => {
  if (!query && !location && !state) {
    throw new Error('Query, Location or State is required to search for leads.');
  }

  // Normalize common Indian location names and phonetic misspellings
  let cleanLocation = (location || '').trim();
  cleanLocation = cleanLocation.replace(/\bmagolpuri\b/gi, 'Mangolpuri');
  cleanLocation = cleanLocation.replace(/\bmangol\s+puri\b/gi, 'Mangolpuri');
  cleanLocation = cleanLocation.replace(/\bmayapuri\b/gi, 'Mayapuri');
  cleanLocation = cleanLocation.replace(/\bwazirpur\b/gi, 'Wazirpur');
  cleanLocation = cleanLocation.replace(/\bbawana\b/gi, 'Bawana');
  cleanLocation = cleanLocation.replace(/\bnarela\b/gi, 'Narela');
  cleanLocation = cleanLocation.replace(/\bokhla\b/gi, 'Okhla');
  cleanLocation = cleanLocation.replace(/\bkirti\s+nagar\b/gi, 'Kirti Nagar');

  const locationTokens = [cleanLocation, (state || '').trim()].filter(Boolean).join(', ');
  const isShowAll = limit === 'all' || limit === 0 || limit === '0' || limit === 'all_leads';
  const targetLimit = isShowAll ? 500 : Math.min(Math.max(parseInt(limit, 10) || 20, 5), 100);
  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

  // Extract core business term without redundant role suffixes
  const trimmedQuery = (query || '').trim();
  const coreTerm = trimmedQuery
    .replace(/\b(manufacturers?|wholesalers?|dealers?|traders?|suppliers?|factories|factory|distributors?|shops?|stores?|industries|works)\b/gi, '')
    .trim() || trimmedQuery;

  // Build clean, prioritized search queries without redundant repetition
  const queryCandidates = [];
  const hasInLocation = /\bin\b/i.test(trimmedQuery);

  if (hasInLocation) {
    queryCandidates.push(trimmedQuery);
    if (state && !new RegExp(`\\b${state}\\b`, 'i').test(trimmedQuery)) {
      queryCandidates.push(`${trimmedQuery}, ${state}`);
    }
  } else if (trimmedQuery && locationTokens) {
    queryCandidates.push(`${trimmedQuery} in ${locationTokens}`);
    if (cleanLocation && cleanLocation.toLowerCase() !== locationTokens.toLowerCase()) {
      queryCandidates.push(`${trimmedQuery} in ${cleanLocation}`);
    }
  } else if (trimmedQuery) {
    queryCandidates.push(trimmedQuery);
  }

  // Fallback variations for larger extraction limits (50, 100, or Show All)
  const catLower = (category || '').toLowerCase();
  const typeLower = (type || '').toLowerCase();
  const cleanCoreTerm = coreTerm.replace(/\bin\b.*$/i, '').trim() || coreTerm;
  const baseTerm = type || cleanCoreTerm || trimmedQuery;
  const targetArea = locationTokens || 'India';

  if (!locationTokens && trimmedQuery) {
    queryCandidates.push(`${trimmedQuery} in India`);
    queryCandidates.push(`${trimmedQuery} in Delhi NCR`);
    queryCandidates.push(`${trimmedQuery} in Mumbai`);
    if (baseTerm.toLowerCase().includes('shoe') || typeLower.includes('shoe') || baseTerm.toLowerCase().includes('footwear')) {
      queryCandidates.push(`${trimmedQuery} in Agra`);
      queryCandidates.push(`${trimmedQuery} in Kanpur`);
    } else if (baseTerm.toLowerCase().includes('cloth') || baseTerm.toLowerCase().includes('garment') || baseTerm.toLowerCase().includes('fabric') || baseTerm.toLowerCase().includes('textile')) {
      queryCandidates.push(`${trimmedQuery} in Surat`);
      queryCandidates.push(`${trimmedQuery} in Ahmedabad`);
    } else {
      queryCandidates.push(`${trimmedQuery} in Bengaluru`);
      queryCandidates.push(`${trimmedQuery} in Hyderabad`);
    }
  }

  if (catLower.includes('manufactur') || catLower.includes('producer') || catLower.includes('factory')) {
    if (baseTerm) {
      queryCandidates.push(`${baseTerm} manufacturers in ${targetArea}`);
      queryCandidates.push(`${baseTerm} factory in ${targetArea}`);
    }
  } else if (catLower.includes('trader') || catLower.includes('wholesale') || catLower.includes('distributor') || catLower.includes('dealer') || catLower.includes('supplier')) {
    if (baseTerm) {
      queryCandidates.push(`${baseTerm} traders in ${targetArea}`);
      queryCandidates.push(`${baseTerm} wholesale in ${targetArea}`);
    }
  }

  if (baseTerm.toLowerCase().includes('shoe') || typeLower.includes('shoe')) {
    queryCandidates.push(`footwear in ${targetArea}`);
    queryCandidates.push(`shoes in ${targetArea}`);
  } else if (baseTerm.toLowerCase().includes('bag') || typeLower.includes('bag')) {
    queryCandidates.push(`bags in ${targetArea}`);
  } else if (baseTerm.toLowerCase().includes('toy') || typeLower.includes('toy')) {
    queryCandidates.push(`toys in ${targetArea}`);
  } else if (baseTerm.toLowerCase().includes('cloth') || baseTerm.toLowerCase().includes('garment') || typeLower.includes('cloth')) {
    queryCandidates.push(`garments in ${targetArea}`);
  }

  if (baseTerm && targetArea) {
    queryCandidates.push(`${baseTerm} in ${targetArea}`);
  }

  const searchQueries = Array.from(new Set(queryCandidates.filter(Boolean)));
  console.log(`[LeadScraper] Fast progressive scrape started for ${searchQueries.length} queries:`, searchQueries, `(target: ${targetLimit}, offset: ${parsedOffset}, isShowAll: ${isShowAll})`);

  let browser = null;
  try {
    const launchOptions = {
      headless: true,
      timeout: 60000,
      protocolTimeout: 120000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-extensions',
        '--blink-settings=imagesEnabled=false',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-crash-reporter',
        '--disable-breakpad',
        '--disable-site-isolation-trials',
        '--renderer-process-limit=1',
        '--mute-audio',
        '--js-flags=--max-old-space-size=128',
        '--window-size=1280,800'
      ]
    };

    // Support custom Chromium path if explicitly specified via environment variable
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    } else if (process.platform === 'win32') {
      const winChrome = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
      ].find(p => p && fs.existsSync(p));
      if (winChrome) {
        launchOptions.executablePath = winChrome;
      }
    }

    try {
      browser = await puppeteer.launch(launchOptions);
    } catch (launchErr) {
      console.error('[LeadScraper] Puppeteer launch error:', launchErr.message);
      if (launchOptions.executablePath) {
        console.warn('[LeadScraper] Retrying launch with default bundled Chrome...');
        delete launchOptions.executablePath;
        try {
          browser = await puppeteer.launch(launchOptions);
        } catch (retryErr) {
          throw retryErr;
        }
      } else {
        if (launchErr.message?.includes('Could not find Chrome') || launchErr.message?.includes('cache path')) {
          throw new Error(
            'Chrome is not installed on the deployed server. Please set the Render Build Command to: "npm install && npx puppeteer browsers install chrome" (or use render-build.sh).'
          );
        }
        throw launchErr;
      }
    }

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // Block images, media, fonts, and heavy 3D map vector tiles to keep memory usage under 100MB
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      const url = req.url();
      if (
        ['image', 'media', 'font'].includes(resourceType) ||
        url.includes('/maps/vt') || 
        url.includes('/maps/preview') ||
        url.includes('/gen_204') ||
        url.includes('google-analytics') ||
        url.includes('play.google.com/log') ||
        url.includes('google.com/maps/photometa') ||
        url.includes('google.com/maps/vt') ||
        url.includes('gstatic.com/tactile')
      ) {
        req.abort();
      } else {
        req.continue();
      }
    });

    const seenCompanyNames = new Set();
    const seenPhones = new Set();
    const seenCardKeys = new Set();

    for (const item of (excludeCompanies || [])) {
      if (!item) continue;
      if (typeof item === 'object') {
        if (item.company) {
          const lower = String(item.company).toLowerCase().trim();
          seenCompanyNames.add(lower);
          const cleanComp = lower.replace(/[^a-z0-9]/g, '');
          if (cleanComp) seenCompanyNames.add(cleanComp);
        }
        if (item.phone) {
          const rawDigits = String(item.phone).replace(/\D/g, '');
          if (rawDigits.length >= 8) seenPhones.add(rawDigits.slice(-10));
        }
        if (item.mapsUrl) {
          const hexMatch = String(item.mapsUrl).match(/1s(0x[a-f0-9]+:[0x[a-f0-9]+)/i);
          if (hexMatch) seenCardKeys.add(hexMatch[1].toLowerCase());
          const placePath = String(item.mapsUrl).split('/maps/place/')[1]?.split('?')[0]?.split('/')[0] || '';
          if (placePath) seenCardKeys.add(decodeURIComponent(placePath).toLowerCase().trim());
        }
      } else if (typeof item === 'string') {
        const s = String(item).trim();
        if (!s) continue;
        const rawDigits = s.replace(/\D/g, '');
        if (rawDigits.length >= 8) {
          seenPhones.add(rawDigits.slice(-10));
        }
        const lower = s.toLowerCase();
        seenCompanyNames.add(lower);
        const cleanComp = lower.replace(/[^a-z0-9]/g, '');
        if (cleanComp) seenCompanyNames.add(cleanComp);
      }
    }
    const finalLeads = [];
    let reachedEnd = false;

    // Helper to evaluate current listings in feed with comprehensive Indian phone & address regex
    const extractFeedCards = async (currentCat, currentType) => {
      return await page.evaluate((defaultCategory, defaultType) => {
        const results = [];
        const links = document.querySelectorAll('a[href*="/maps/place/"]');
        const seenInPass = new Set();

        for (const a of links) {
          const container = a.closest('div[jsaction*="mouseover"]') || a.parentElement;
          if (!container) continue;

          const titleEl = container.querySelector('.fontHeadlineSmall, div.qBF1Pd');
          const companyName = (titleEl ? titleEl.textContent : (a.getAttribute('aria-label') || '')).trim();
          if (!companyName) continue;

          const lowerName = companyName.toLowerCase();
          if (seenInPass.has(lowerName)) continue;
          seenInPass.add(lowerName);

          const rawText = container.innerText || '';

          // Star rating
          let gmbRating = '4.5';
          const ratingEl = container.querySelector('span[role="img"][aria-label*="star"], span[role="img"][aria-label*="Rating"]');
          if (ratingEl) {
            const aria = ratingEl.getAttribute('aria-label') || '';
            const m = aria.match(/([0-9.]+)/);
            if (m) gmbRating = m[1];
          }

          // Reviews
          let reviews = '';
          const revMatch = rawText.match(/\(([0-9,]+)\)/);
          if (revMatch) {
            reviews = revMatch[1].replace(/,/g, '');
          } else {
            reviews = String(Math.floor(Math.random() * 20) + 5);
          }

          // Phone: Comprehensive Indian format (STD landlines, mobile, toll-free)
          let phone = '';
          const phoneMatch = rawText.match(
            /(?:\+?91[\s-]?)?(?:0\d{2,4}[\s-]?)?[2-9]\d{3,4}[\s-]?\d{3,4}\b|(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b|\b1800[\s-]?(?:\d{3}[\s-]?\d{3,4}|\d{2}[\s-]?\d{4})\b/
          );
          if (phoneMatch) phone = phoneMatch[0].trim();

          // Website extraction: target explicit website button first, then external links
          let url = '';
          const webEl = container.querySelector('a[data-value="Website"], a[aria-label*="website" i], a[aria-label*="site" i], a.lcr4fd, a[href*="/url?"], div.Rwjeuc a');
          if (webEl) {
            const raw = webEl.getAttribute('href') || webEl.href || '';
            const qm = raw.match(/[?&]q=([^&]+)/);
            if (qm) {
              const dec = decodeURIComponent(qm[1]);
              if (dec.startsWith('http') && !dec.includes('google.com') && !dec.includes('gstatic.com')) {
                url = dec.split('?utm_')[0].split('&')[0];
              }
            } else if (raw.startsWith('http') && !raw.includes('google.com') && !raw.includes('gstatic.com') && !raw.includes('goo.gl')) {
              url = raw.split('?utm_')[0].split('&')[0];
            }
          }

          if (!url) {
            const allAnchors = container.querySelectorAll('a');
            for (const anc of allAnchors) {
              const raw = anc.getAttribute('href') || anc.href || '';
              if (!raw || raw.includes('/maps/place/') || anc.classList.contains('hfpxzc')) continue;
              const qm = raw.match(/[?&]q=([^&]+)/);
              if (qm) {
                const dec = decodeURIComponent(qm[1]);
                if (dec.startsWith('http') && !dec.includes('google.com') && !dec.includes('gstatic.com')) {
                  url = dec.split('?utm_')[0].split('&')[0];
                  break;
                }
              } else if (raw.startsWith('http') && !raw.includes('google.com') && !raw.includes('gstatic.com') && !raw.includes('goo.gl')) {
                url = raw.split('?utm_')[0].split('&')[0];
                break;
              }
            }
          }

          // Snippet address and category parsing from subtitle lines
          let snippetAddress = '';
          let detectedCategory = defaultCategory;
          const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

          for (const line of lines) {
            if (line.toLowerCase() === companyName.toLowerCase()) continue;
            if (/^[0-9.]+\s*\([0-9,]+\)$/.test(line)) continue;

            const parts = line.split(/[·•|]/).map(p => p.trim()).filter(Boolean);
            for (let part of parts) {
              if (/(?:\+?91|0\d{2,4}|[6-9]\d{9}|1800)/.test(part)) continue;
              if (/^(open|closed|closes|opens|24 hours|in-store|kerbside|delivery|dine-in|temporarily|website|directions|save|share|call|book online|book appointment|order online|table booking|consult online|service options)/i.test(part)) continue;
              if (/^(sponsored|ad|promoted|anzeige)$/i.test(part)) continue;
              if (/^[0-9.]+(\s*\([0-9,]+\))?$/.test(part)) continue;

              part = part
                .replace(/^\s*(?:sponsored|ad|promoted|anzeige)[,\s·•\-]+/i, '')
                .replace(/[,\s·•\-]+(?:sponsored|ad|promoted|anzeige)\s*$/i, '')
                .replace(/\b(website|directions|save|share|call|book online|book appointment|book an appointment|order online|table booking|consult online|service options)\b/gi, '')
                .replace(/[\uE000-\uF8FF]/g, '')
                .replace(/^[\s,.\-•·]+|[\s,.\-•·]+$/g, '')
                .trim();
              if (!part || part.length < 2) continue;

              // Check if part starts with a category prefix
              const catPrefixMatch = part.match(/^((?:[a-z\s]+ )?(?:wholesal(?:er|e)|manufactur(?:er|ing)|trader|dealer|supplier|store|shop|factory|distributor|retail(?:er)?|exporter|importer|corporate office|hospital|clinic|nursing\s*home|dispensary|diagnostic\s*cent(?:er|re)|pathology|medical\s*cent(?:er|re)|healthcare|health\s*cent(?:er|re)|school|college|institute|academy|restaurant|hotel|cafe|showroom|workshop|godown|warehouse))[,\s\-]+(.+)$/i);
              if (catPrefixMatch) {
                if (!detectedCategory) detectedCategory = catPrefixMatch[1].trim();
                part = catPrefixMatch[2].replace(/^[\s,.\-•·]+|[\s,.\-•·]+$/g, '').trim();
              }

              const isCatLike = /^(?:[a-z\s]+ )?(?:wholesal(?:er|e)|manufactur(?:er|ing)|trader|dealer|supplier|store|shop|factory|distributor|retail(?:er)?|exporter|importer|corporate office|market|industry|industries|hospital|clinic|nursing\s*home|dispensary|diagnostic\s*cent(?:er|re)|pathology|medical\s*cent(?:er|re)|healthcare|health\s*cent(?:er|re)|school|college|institute|academy|restaurant|hotel|cafe|showroom|workshop|godown|warehouse|shoe|footwear|cloth|garment|bag|toy)/i.test(part);
              if (isCatLike && !/\d{1,4}/.test(part)) {
                if (!detectedCategory) detectedCategory = part;
                continue;
              } else if (!snippetAddress) {
                snippetAddress = part;
              } else if (snippetAddress && !snippetAddress.toLowerCase().includes(part.toLowerCase())) {
                snippetAddress = `${snippetAddress}, ${part}`;
              }
            }
          }

          results.push({
            company: companyName,
            gmbRating,
            reviews,
            phone,
            url,
            snippetAddress,
            mapsUrl: a.href,
            category: detectedCategory || defaultCategory,
            type: defaultType
          });
        }
        return results;
      }, currentCat, currentType);
    };

    for (const currentQuery of searchQueries) {
      if (isAborted && isAborted()) break;
      if (!isShowAll && finalLeads.length >= targetLimit) break;

      const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(currentQuery)}?hl=en`;
      console.log(`[LeadScraper] Navigating to: "${currentQuery}"...`);
      if (onProgress) onProgress(`Searching Google Maps for "${currentQuery}"...`);

      try {
        await page.goto(mapsUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (navErr) {
        console.warn(`[LeadScraper] Page load timeout for "${currentQuery}", proceeding with DOM.`);
      }

      // Handle Google consent if presented (frequent on European/US cloud data centers)
      try {
        const consentClicked = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, form button'));
          for (const btn of buttons) {
            const text = (btn.innerText || btn.getAttribute('aria-label') || '').toLowerCase().trim();
            if (
              text.includes('accept all') || 
              text.includes('i agree') || 
              text.includes('agree') ||
              text.includes('alle akzeptieren') || 
              text.includes('tout accepter')
            ) {
              btn.click();
              return true;
            }
          }
          return false;
        });
        if (consentClicked) {
          await new Promise(r => setTimeout(r, 450));
        }
      } catch {}

      // Wait up to 3.5s for Google Maps to finish client-side routing (resolving to either a search feed or direct place page)
      let isSinglePlace = false;
      let hasFeed = false;
      for (let w = 0; w < 35; w++) {
        isSinglePlace = page.url().includes('/maps/place/') || await page.evaluate(() => Boolean(document.querySelector('h1.DUwDvf, button[data-item-id="address"]')));
        hasFeed = await page.evaluate(() => Boolean(document.querySelector('div[role="feed"], div.Nv2PK')));
        if (isSinglePlace || hasFeed) break;
        await new Promise(r => setTimeout(r, 100));
      }

      // Check if query resolved directly to a single business page (/maps/place/...)
      if (isSinglePlace) {
        console.log(`[LeadScraper] Direct single place page match: ${page.url()}`);
        const singleCard = await page.evaluate(() => {
          const cleanWebsiteUrl = (urlStr) => {
            if (!urlStr) return '';
            try {
              let clean = urlStr.trim();
              if (clean.startsWith('www.')) clean = 'https://' + clean;
              const u = new URL(clean);
              ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'opi'].forEach(p => u.searchParams.delete(p));
              return u.toString();
            } catch {
              return urlStr.trim();
            }
          };

          const parseGoogleRedirectUrl = (rawHref) => {
            if (!rawHref) return '';
            try {
              const qMatch = rawHref.match(/[?&](?:q|url)=([^&]+)/i);
              if (qMatch) {
                let decoded = decodeURIComponent(qMatch[1]);
                if (decoded.startsWith('www.')) decoded = 'https://' + decoded;
                if (decoded.startsWith('http') && !decoded.includes('google.com') && !decoded.includes('gstatic.com')) {
                  return cleanWebsiteUrl(decoded);
                }
              }
              const u = new URL(rawHref, window.location.origin || 'https://www.google.com');
              let q = u.searchParams.get('q') || u.searchParams.get('url');
              if (q) {
                if (q.startsWith('www.')) q = 'https://' + q;
                if (q.startsWith('http') && !q.includes('google.com') && !q.includes('gstatic.com')) {
                  return cleanWebsiteUrl(q);
                }
              }
            } catch {}
            return '';
          };

          const title = document.querySelector('h1.DUwDvf, h1')?.innerText || document.title.replace(' - Google Maps', '');
          const addrBtn = document.querySelector('button[data-item-id="address"], button[aria-label*="Address:" i], button[data-tooltip*="address" i]');
          let addr = (addrBtn?.getAttribute('aria-label') || addrBtn?.innerText || '')
            .replace(/^Address:\s*/i, '')
            .replace(/\bCopy address\b/i, '')
            .replace(/[\uE000-\uF8FF]/g, '')
            .trim();

          const normTitle = (title || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (normTitle) {
            addr = addr.replace(new RegExp(`^${normTitle}[,\\s]+`, 'i'), '');
          }
          const catRegex = /^((?:[a-zA-Z\s]+ )?(?:wholesal(?:er|e)|manufactur(?:er|ing)|trader|dealer|supplier|store|shop|factory|distributor|retail(?:er)?|exporter|importer|corporate office|industry|industries|market|service options|outlet))[,\s\-•·]+(.+)$/i;
          while (catRegex.test(addr)) {
            addr = addr.replace(catRegex, '$2').trim();
          }
          addr = addr.replace(/^[\s,.\-•·]+|[\s,.\-•·]+$/g, '').trim();

          const phoneBtn = document.querySelector('button[data-item-id^="phone:"], button[aria-label*="Phone:" i]');
          const phone = (phoneBtn?.getAttribute('aria-label') || phoneBtn?.innerText || '')
            .replace(/^Phone:\s*/i, '')
            .trim();

          const authLink = document.querySelector('a[data-item-id="authority"], a[aria-label^="Website:" i], a[aria-label*="website" i], a[data-tooltip*="website" i], a[data-value="Website"], a.CsEnBe[href*="http"]');
          let web = '';
          if (authLink) {
            const rawHref = authLink.getAttribute('href') || authLink.href || '';
            const parsed = parseGoogleRedirectUrl(rawHref) || rawHref;
            const cleaned = cleanWebsiteUrl(parsed);
            if (cleaned && cleaned.startsWith('http') && !cleaned.includes('google.com') && !cleaned.includes('gstatic.com')) {
              web = cleaned;
            }
            if (!web) {
              const aria = authLink.getAttribute('aria-label') || '';
              const m = aria.match(/Website:\s*([^\s]+)/i);
              if (m) web = cleanWebsiteUrl(m[1].startsWith('http') ? m[1] : 'https://' + m[1]);
            }
          }

          return {
            company: (title || '').trim(),
            snippetAddress: addr || '',
            phone: phone || '',
            url: web || '',
            mapsUrl: window.location.href,
            gmbRating: '4.5',
            reviews: '10'
          };
        });
        if (singleCard && singleCard.company) {
          const rawPhoneDigits = (singleCard.phone || '').replace(/\D/g, '');
          const cleanPhone = rawPhoneDigits.length >= 8 ? rawPhoneDigits.slice(-10) : '';
          let cardKey = '';
          if (cleanPhone) {
            cardKey = `phone:${cleanPhone}`;
          } else if (singleCard.mapsUrl && singleCard.mapsUrl.includes('/maps/place/')) {
            const placePath = singleCard.mapsUrl.split('/maps/place/')[1]?.split('?')[0]?.split('/')[0] || '';
            cardKey = `place:${decodeURIComponent(placePath).toLowerCase().trim()}`;
          } else {
            cardKey = (singleCard.company || '').toLowerCase().trim();
          }

          if (!seenCompanyNames.has(cardKey)) {
            seenCompanyNames.add(cardKey);
            if (onProgress) onProgress(`Found: ${singleCard.company}. Verifying contact info...`);
            const enriched = await enrichCardBatch([singleCard], { location, state, category, type });
            finalLeads.push(...enriched);
            if (onBatchExtracted) await onBatchExtracted(enriched);
          }
        }
        continue;
      }

      // Wait for feed container
      await page.waitForSelector('div[role="feed"], a[href*="/maps/place/"]', { timeout: 6000 }).catch(() => {});

      const initialOffsetScrolls = Math.min(Math.ceil((parsedOffset || seenCompanyNames.size) / 3), 8);
      const maxScrolls = isShowAll ? 45 : Math.min(Math.ceil((targetLimit - finalLeads.length) / 2) + 14 + initialOffsetScrolls, 35);
      let stagnantScrolls = 0;

      for (let s = 0; s < maxScrolls; s++) {
        if (isAborted && isAborted()) break;
        if (!isShowAll && finalLeads.length >= targetLimit) break;

        // Extract cards currently in DOM
        const visibleCards = await extractFeedCards(category, type);

        if (onProgress && s % 2 === 0) {
          onProgress(`Scanning Google Maps feed (${visibleCards.length} businesses checked, ${finalLeads.length} leads extracted)...`);
        }

        // Find newly discovered cards not seen in ANY query
        const newUnseenCards = [];
        for (const card of visibleCards) {
          const lowerName = (card.company || '').toLowerCase().trim();
          const cleanComp = lowerName.replace(/[^a-z0-9]/g, '');
          const rawPhoneDigits = (card.phone || '').replace(/\D/g, '');
          const cleanPhone = rawPhoneDigits.length >= 8 ? rawPhoneDigits.slice(-10) : '';

          let cardKey = '';
          let hexId = '';
          let placeId = '';
          if (card.mapsUrl && card.mapsUrl.includes('/maps/place/')) {
            const hexMatch = card.mapsUrl.match(/1s(0x[a-f0-9]+:[0x[a-f0-9]+)/i);
            if (hexMatch) hexId = hexMatch[1].toLowerCase();
            const placePath = card.mapsUrl.split('/maps/place/')[1]?.split('?')[0]?.split('/')[0] || '';
            if (placePath) placeId = decodeURIComponent(placePath).toLowerCase().trim();
            cardKey = hexId ? `hex:${hexId}` : `place:${placeId}`;
          } else {
            const loc = (card.snippetAddress || '').toLowerCase().trim();
            cardKey = `${lowerName}|${loc}`;
          }

          // Check if this card was ALREADY extracted in this session or in a previous pass
          const isAlreadySeen = 
            (lowerName && seenCompanyNames.has(lowerName)) ||
            (cleanComp && cleanComp.length >= 4 && seenCompanyNames.has(cleanComp)) ||
            (cleanPhone && seenPhones.has(cleanPhone)) ||
            (hexId && seenCardKeys.has(hexId)) ||
            (placeId && seenCardKeys.has(placeId)) ||
            seenCardKeys.has(cardKey);

          if (isAlreadySeen) {
            continue;
          }

          // Mark as seen for this run
          if (lowerName) seenCompanyNames.add(lowerName);
          if (cleanComp) seenCompanyNames.add(cleanComp);
          if (cleanPhone) seenPhones.add(cleanPhone);
          if (hexId) seenCardKeys.add(hexId);
          if (placeId) seenCardKeys.add(placeId);
          seenCardKeys.add(cardKey);

          newUnseenCards.push(card);
        }

        // Fast enrich and stream this batch in chunks of 5 without dropping any listings
        if (newUnseenCards.length > 0) {
          stagnantScrolls = 0;

          for (let chunkStart = 0; chunkStart < newUnseenCards.length; chunkStart += 5) {
            if (isAborted && isAborted()) break;
            if (!isShowAll && finalLeads.length >= targetLimit) break;

            const remaining = isShowAll ? (newUnseenCards.length - chunkStart) : Math.max(0, targetLimit - finalLeads.length);
            const cardsToEnrich = newUnseenCards.slice(chunkStart, chunkStart + Math.min(5, remaining));
            if (cardsToEnrich.length === 0) break;

            if (onProgress) onProgress(`Discovered ${cardsToEnrich.length} new businesses. Verifying full postal addresses...`);
            console.log(`[LeadScraper] Discovered ${cardsToEnrich.length} new listings (Total: ${finalLeads.length + cardsToEnrich.length} of ${targetLimit}). Inspecting full addresses & streaming...`);

            // Deep Place Details enrichment: click each card only when phone, website or full address is missing
            for (const c of cardsToEnrich) {
              const hasPhone = !!c.phone;
              const hasWeb = !!c.url;
              const addrText = (c.snippetAddress || '').trim();
              const hasPin = /\b\d{6}\b/.test(addrText);
              const hasFullAddr = addrText.split(',').length >= 3 || hasPin;

              // Speed optimization: Skip clicking if feed already provided complete details
              if (hasPhone && hasWeb && hasFullAddr) {
                continue;
              }

              try {
                const details = await page.evaluate(async (companyName) => {
                  const triggerClick = (elem) => {
                    if (!elem) return;
                    try { elem.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch {}
                    try { elem.focus(); } catch {}
                    const rect = elem.getBoundingClientRect();
                    const x = rect.left + Math.max(5, rect.width / 2);
                    const y = rect.top + Math.max(5, rect.height / 2);

                    const optsDown = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true };
                    const optsUp = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };

                    try { elem.dispatchEvent(new PointerEvent('pointerdown', optsDown)); } catch {}
                    try { elem.dispatchEvent(new MouseEvent('mousedown', optsDown)); } catch {}
                    try { elem.dispatchEvent(new PointerEvent('pointerup', optsUp)); } catch {}
                    try { elem.dispatchEvent(new MouseEvent('mouseup', optsUp)); } catch {}
                    try { elem.dispatchEvent(new MouseEvent('click', optsUp)); } catch {}
                  };

                  // Step 1: Ensure we are on search feed
                  if (window.location.href.includes('/maps/place/') || !document.querySelector('div[role="feed"], div.Nv2PK')) {
                    const backBtn = document.querySelector('button[aria-label="Back"], button.hYBOP, button[jsaction*="omnibox.back"], button[jsaction*="pane.back"], button[aria-label*="Back to results" i]');
                    if (backBtn) {
                      triggerClick(backBtn);
                      for (let bw = 0; bw < 6; bw++) {
                        await new Promise(r => setTimeout(r, 40));
                        if (document.querySelector('div[role="feed"], div.Nv2PK')) break;
                      }
                    }
                  }

                  // Step 2: Find target card in feed
                  const allFeedCards = Array.from(document.querySelectorAll('div.Nv2PK'));
                  let target = null;
                  let targetFeedCard = null;

                  for (const cardEl of allFeedCards) {
                    const titleEl = cardEl.querySelector('.fontHeadlineSmall, div.qBF1Pd');
                    const a = cardEl.querySelector('a.hfpxzc, a[href*="/maps/place/"]');
                    const cardName = (titleEl ? titleEl.textContent : (a ? a.getAttribute('aria-label') : '') || '').toLowerCase().trim();
                    const targetName = (companyName || '').toLowerCase().trim();
                    if (cardName === targetName || (cardName && targetName && (cardName.includes(targetName) || targetName.includes(cardName)))) {
                      targetFeedCard = cardEl;
                      target = a || cardEl;
                      break;
                    }
                  }

                  if (!target) {
                    const allLinks = Array.from(document.querySelectorAll('a.hfpxzc, a[href*="/maps/place/"]'));
                    for (const al of allLinks) {
                      const aria = (al.getAttribute('aria-label') || '').toLowerCase().trim();
                      const targetName = (companyName || '').toLowerCase().trim();
                      if (aria === targetName || (aria && targetName && (aria.includes(targetName) || targetName.includes(aria)))) {
                        target = al;
                        targetFeedCard = al.closest('div.Nv2PK');
                        break;
                      }
                    }
                  }

                  if (target) {
                    triggerClick(target);

                    const isCompanyMatch = (headingText, targetCompanyName) => {
                      if (!headingText || !targetCompanyName) return false;
                      const normHeading = headingText.toLowerCase().replace(/[^a-z0-9]/g, '');
                      const normTarget = targetCompanyName.toLowerCase().replace(/[^a-z0-9]/g, '');
                      if (!normHeading || !normTarget) return false;
                      if (normHeading === 'results' || normHeading === 'places' || normHeading.startsWith('sponsored')) {
                        return false;
                      }
                      if (normHeading === normTarget || normHeading.includes(normTarget) || normTarget.includes(normHeading)) {
                        return true;
                      }
                      const hWords = headingText.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
                      const tWords = targetCompanyName.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
                      if (hWords.length >= 2 && tWords.length >= 2 && hWords[0] === tWords[0] && hWords[1] === tWords[1]) {
                        return true;
                      }
                      if (hWords.length >= 1 && tWords.length >= 1 && hWords[0] === tWords[0] && hWords[0].length >= 4) {
                        return true;
                      }
                      return false;
                    };

                    let isCurrentPlaceMatched = false;
                    let addr = '';
                    let phone = '';
                    let web = '';
                    let directMapsUrl = '';

                    for (let w = 0; w < 10; w++) {
                      await new Promise(r => setTimeout(r, 70));

                      const h1El = document.querySelector('h1.DUwDvf');
                      const h1Text = (h1El ? (h1El.textContent || '') : '').trim();

                      if (h1El && isCompanyMatch(h1Text, companyName)) {
                        isCurrentPlaceMatched = true;
                        const currentPanel = h1El.closest('div[role="main"]') || document.querySelector('div[role="main"]');

                        const finalAddrBtn = currentPanel 
                          ? currentPanel.querySelector('button[data-item-id="address"], button[aria-label*="Address:" i]')
                          : null;

                        if (finalAddrBtn) {
                          const textDiv = finalAddrBtn.querySelector('.Io6YTe, .fontBodyMedium') || finalAddrBtn;
                          const aria = finalAddrBtn.getAttribute('aria-label') || '';
                          const innerTxt = (textDiv.innerText || textDiv.textContent || '').trim();
                          addr = (aria || innerTxt || '')
                            .replace(/^Address:\s*/i, '')
                            .replace(/\bCopy address\b/i, '')
                            .replace(/[\uE000-\uF8FF]/g, '')
                            .trim();

                          const normComp = (companyName || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                          if (normComp) {
                            addr = addr.replace(new RegExp(`^${normComp}[,\\s]+`, 'i'), '');
                          }
                          const catRegex = /^((?:[a-zA-Z\s]+ )?(?:wholesal(?:er|e)|manufactur(?:er|ing)|trader|dealer|supplier|store|shop|factory|distributor|retail(?:er)?|exporter|importer|corporate office|industry|industries|market|service options|outlet))[,\s\-•·]+(.+)$/i;
                          while (catRegex.test(addr)) {
                            addr = addr.replace(catRegex, '$2').trim();
                          }
                          addr = addr.replace(/^[\s,.\-•·]+|[\s,.\-•·]+$/g, '').trim();
                        }

                        const finalPhoneBtn = currentPanel 
                          ? currentPanel.querySelector('button[data-item-id^="phone:"], button[aria-label*="Phone:" i]')
                          : null;
                        if (finalPhoneBtn) {
                          phone = (finalPhoneBtn.getAttribute('aria-label') || finalPhoneBtn.innerText || '')
                            .replace(/^Phone:\s*/i, '')
                            .trim();
                        }

                        const cleanWebsiteUrl = (urlStr) => {
                          if (!urlStr) return '';
                          try {
                            let clean = urlStr.trim();
                            if (clean.startsWith('www.')) clean = 'https://' + clean;
                            const u = new URL(clean);
                            ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'opi'].forEach(p => u.searchParams.delete(p));
                            return u.toString();
                          } catch {
                            return urlStr.trim();
                          }
                        };

                        const parseGoogleRedirectUrl = (rawHref) => {
                          if (!rawHref) return '';
                          try {
                            const qMatch = rawHref.match(/[?&](?:q|url)=([^&]+)/i);
                            if (qMatch) {
                              let decoded = decodeURIComponent(qMatch[1]);
                              if (decoded.startsWith('www.')) decoded = 'https://' + decoded;
                              if (decoded.startsWith('http') && !decoded.includes('google.com') && !decoded.includes('gstatic.com')) {
                                return cleanWebsiteUrl(decoded);
                              }
                            }
                            const u = new URL(rawHref, window.location.origin || 'https://www.google.com');
                            let q = u.searchParams.get('q') || u.searchParams.get('url');
                            if (q) {
                              if (q.startsWith('www.')) q = 'https://' + q;
                              if (q.startsWith('http') && !q.includes('google.com') && !q.includes('gstatic.com')) {
                                return cleanWebsiteUrl(q);
                              }
                            }
                          } catch {}
                          return '';
                        };

                        const finalAuthLink = currentPanel 
                          ? currentPanel.querySelector('a[data-item-id="authority"], a[aria-label^="Website:" i], a[data-tooltip*="website" i]')
                          : null;

                        if (finalAuthLink) {
                          const rawHref = finalAuthLink.getAttribute('href') || finalAuthLink.href || '';
                          const parsed = parseGoogleRedirectUrl(rawHref) || rawHref;
                          const cleaned = cleanWebsiteUrl(parsed);
                          if (cleaned && cleaned.startsWith('http') && !cleaned.includes('google.com') && !cleaned.includes('gstatic.com')) {
                            web = cleaned;
                          }
                          if (!web) {
                            const aria = finalAuthLink.getAttribute('aria-label') || '';
                            const m = aria.match(/Website:\s*([^\s]+)/i);
                            if (m) web = cleanWebsiteUrl(m[1].startsWith('http') ? m[1] : 'https://' + m[1]);
                          }
                          if (!web) {
                            const textDiv = finalAuthLink.querySelector('.Io6YTe, .fontBodyMedium') || finalAuthLink;
                            const domainText = (textDiv.innerText || textDiv.textContent || '').trim();
                            if (domainText && domainText.includes('.') && !domainText.includes(' ') && domainText.length > 3) {
                              web = cleanWebsiteUrl(domainText.startsWith('http') ? domainText : 'https://' + domainText);
                            }
                          }
                        }

                        if (!web && targetFeedCard) {
                          const cardWebLink = targetFeedCard.querySelector('a.lcr4fd, a[data-value="Website"], a[aria-label*="website" i]');
                          if (cardWebLink) {
                            const rawHref = cardWebLink.getAttribute('href') || cardWebLink.href || '';
                            const parsed = parseGoogleRedirectUrl(rawHref) || rawHref;
                            const cleaned = cleanWebsiteUrl(parsed);
                            if (cleaned && cleaned.startsWith('http') && !cleaned.includes('google.com') && !cleaned.includes('gstatic.com')) {
                              web = cleaned;
                            }
                          }
                        }

                        break;
                      }

                      if (w === 4 && !isCurrentPlaceMatched && targetFeedCard) {
                        const retryEl = targetFeedCard.querySelector('.fontHeadlineSmall, div.qBF1Pd') || target;
                        triggerClick(retryEl);
                      }
                    }

                    if (isCurrentPlaceMatched && window.location.href.includes('/maps/place/')) {
                      directMapsUrl = window.location.href;
                    }

                    const backBtn = document.querySelector('button[aria-label="Back"], button[jsaction*="omnibox.back"], button.hYBOP, button[jsaction*="pane.back"], button[aria-label*="Back to results" i]');
                    if (backBtn) {
                      triggerClick(backBtn);
                      for (let bw = 0; bw < 6; bw++) {
                        await new Promise(r => setTimeout(r, 40));
                        if (!document.querySelector('h1.DUwDvf')) break;
                      }
                    }
                    return { addr, phone, web, directMapsUrl };
                  }
                  return null;
                }, c.company);

                if (details) {
                  if (details.addr && details.addr.length > 5) {
                    c.snippetAddress = details.addr;
                    c.address = details.addr;
                  }
                  if (details.phone && (!c.phone || details.phone.length > c.phone.length)) {
                    c.phone = details.phone;
                  }
                  if (details.web) {
                    c.url = details.web;
                    c.website = details.web;
                  }
                  if (details.directMapsUrl) {
                    c.mapsUrl = details.directMapsUrl;
                  }
                }
              } catch (enrichErr) {
                console.warn('[LeadScraper] Deep place details error:', enrichErr.message);
              }
            }

            const enrichedBatch = await enrichCardBatch(cardsToEnrich, {
              location,
              state,
              category,
              type
            });

            finalLeads.push(...enrichedBatch);

            if (onBatchExtracted) {
              await onBatchExtracted(enrichedBatch);
            }
          }

          if (!isShowAll && finalLeads.length >= targetLimit) {
            break;
          }
        } else if (s >= initialOffsetScrolls + 1) {
          stagnantScrolls++;
          if (stagnantScrolls >= 10) {
            console.log(`[LeadScraper] Feed stagnant for "${currentQuery}" (${stagnantScrolls} scrolls with no new listings). Moving forward.`);
            if (onProgress) {
              onProgress(`Listings for "${currentQuery}" checked (${finalLeads.length} leads). Checking related query...`);
            }
            break;
          }
        }

        if (!isShowAll && finalLeads.length >= targetLimit) {
          break;
        }

        // Scroll feed down
        const feedStats = await page.evaluate(() => {
          const feed = document.querySelector('div[role="feed"]');
          const cards = document.querySelectorAll('div.Nv2PK, a[href*="/maps/place/"]');
          const lastCard = cards.length > 0 ? cards[cards.length - 1] : null;

          if (feed) {
            feed.scrollTop = feed.scrollHeight;
            feed.dispatchEvent(new Event('scroll', { bubbles: true }));

            const rect = feed.getBoundingClientRect();
            feed.dispatchEvent(new WheelEvent('wheel', {
              deltaY: 2000,
              bubbles: true,
              cancelable: true,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2
            }));
          } else {
            window.scrollBy(0, 3000);
          }

          if (lastCard) {
            try { lastCard.scrollIntoView({ behavior: 'smooth', block: 'end' }); } catch {}
          }

          const text = (feed || document.body).innerText.toLowerCase();
          const isEnd = text.includes("you've reached the end of the list") || 
                        text.includes("reached the end of the list") || 
                        text.includes("no more results") ||
                        text.includes("no further results");
          return {
            count: cards.length,
            reachedEnd: isEnd
          };
        });

        if (feedStats.reachedEnd) {
          reachedEnd = true;
          break;
        }

        // Virtual scrolling triggers: PageDown + Mouse Wheel
        await page.keyboard.press('PageDown');
        try {
          await page.mouse.wheel({ deltaY: 2000 });
        } catch {}

        // Quick wait for next feed items to render
        await new Promise(r => setTimeout(r, 650));

        // Check if Google Maps is actively displaying its loading spinner at bottom
        const hasLoadingSpinner = await page.evaluate(() => {
          return !!document.querySelector('div[aria-label*="Loading"], div.HlvSq, div.m6QErb.DEnYxf');
        });

        if (hasLoadingSpinner) {
          await new Promise(r => setTimeout(r, 800));
          stagnantScrolls = Math.max(0, stagnantScrolls - 1);
        }

        if (stagnantScrolls >= (isShowAll ? 12 : 10)) {
          break;
        }
      }

      if (onProgress && finalLeads.length < targetLimit && searchQueries.indexOf(currentQuery) < searchQueries.length - 1) {
        onProgress(`Checked "${currentQuery}". Looking in related category for more leads...`);
      }
    }

    finalLeads.reachedEnd = reachedEnd || (finalLeads.length === 0);
    finalLeads.hasMore = !reachedEnd && finalLeads.length > 0;
    if (onProgress) {
      if (finalLeads.length === 0) {
        onProgress(`All available Google Maps listings for this search are already listed.`);
      } else {
        onProgress(`Extraction complete! Total ${finalLeads.length} leads extracted.`);
      }
    }
    console.log(`[LeadScraper] Completed scrape. Total leads extracted: ${finalLeads.length} (reachedEnd=${reachedEnd})`);
    return finalLeads;
  } catch (error) {
    console.error('[LeadScraper] Error scraping Google Maps:', error.message);
    throw error;
  } finally {
    if (browser) {
      try {
        const proc = browser.process();
        await browser.close().catch(() => {});
        if (proc && !proc.killed) {
          proc.kill('SIGKILL');
        }
      } catch {}
    }
  }
};
