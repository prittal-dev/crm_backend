import { Task } from '../models/Task.js';
import { User } from '../models/User.js';

const normalize = (value) => String(value || '').toLowerCase().replace(/[_-]+/g, ' ').trim();

export const getProjectServiceProfile = (project) => {
  const planName = normalize(project?.soldPlanName || project?.planSnapshot?.name || project?.name);
  const category = normalize(project?.planSnapshot?.category || project?.serviceType);
  const rawServices = Array.isArray(project?.services) ? project.services.map(normalize) : [normalize(project?.services)].filter(Boolean);
  const servicesStr = rawServices.join(' ');
  const combined = [category, planName, servicesStr].join(' ');

  const hasProductShoot = /product\s*(shoot|photo)|photoshoot|photography|catalog(ue)?|brochure/.test(combined);
  const hasWebsite = /(website|web development|web design|e commerce site|wordpress|web portal|shopify|\bweb\b)/.test(combined);
  const hasSeo = /(^|\s)(seo|search engine optimization|technical seo|on page seo|off page seo)(\s|$)/.test(combined);
  const hasMetaAds = /(meta\s*ad|facebook\s*ad|performance marketing|google\s*ad|ppc)/.test(combined);

  // Check if social media / SMO is genuinely opted
  const planMentionsSocial = /(social media|\bsmo\b|creative package|reels? package|growth retainer|digital retainer|content marketing)/.test(`${category} ${planName}`);
  const servicesMentionSocial = rawServices.some(s => /^(smo|social media|creative|reels)/.test(s) || (s.includes('smo') && !s.includes('website')));
  
  const isPureOtherPlan = (hasWebsite || hasSeo || hasProductShoot || hasMetaAds) && !planMentionsSocial && !servicesMentionSocial;
  const hasMultipleExplicitServices = rawServices.filter(s => s && s !== 'smo').length > 0 && servicesMentionSocial;

  const hasSocial = planMentionsSocial || hasMultipleExplicitServices || (!isPureOtherPlan && (servicesMentionSocial || (!hasWebsite && !hasSeo && !hasProductShoot && !hasMetaAds)));

  const otherServices = [];
  if (hasWebsite) otherServices.push('website');
  if (hasSeo) otherServices.push('seo');
  if (hasProductShoot) otherServices.push('product_shoot');
  if (hasMetaAds) otherServices.push('meta_ads');

  const isServiceOnly = !hasSocial && otherServices.length > 0;
  const isHybrid = hasSocial && otherServices.length > 0;
  const isSocialOnly = hasSocial && otherServices.length === 0;

  const primaryType = otherServices.length > 0 ? otherServices[0] : 'social';

  return {
    primaryType,
    hasSocial,
    hasWebsite,
    hasSeo,
    hasProductShoot,
    hasMetaAds,
    isServiceOnly,
    isHybrid,
    isSocialOnly,
    otherServices
  };
};

const templates = {
  website: [
    ['web_design', 'Website UI/UX & Sitemap', 'Web Designer'],
    ['web_development', 'Website Development', 'Web Developer'],
    ['content_upload', 'Website Content & Product Upload', 'Content Executive'],
    ['website_qa', 'Responsive Testing, QA & Revisions', 'QA Specialist'],
    ['deployment', 'Domain, Hosting & Website Launch', 'Web Developer']
  ],
  seo: [
    ['keyword_research', 'SEO Keyword Research & Competitor Review', 'SEO Specialist'],
    ['seo_audit', 'Technical SEO Audit', 'SEO Specialist'],
    ['on_page_seo', 'On-Page SEO Optimization', 'SEO Specialist'],
    ['off_page_seo', 'Off-Page SEO & Backlink Work', 'SEO Executive'],
    ['seo_reporting', 'SEO Ranking & Performance Report', 'SEO Analyst']
  ],
  product_shoot: [
    ['shoot_planning', 'Product / Catalogue Planning & Shot List', 'Shoot Producer'],
    ['photography', 'Product Photography & Image Capture', 'Photographer'],
    ['photo_editing', 'Retouching & Catalogue Page Layout', 'Photo Editor'],
    ['video_shoot', 'Product Video Shoot', 'Videographer'],
    ['video_editing', 'Product Video Editing', 'Video Editor'],
    ['shoot_delivery', 'Proofing & Final Asset Delivery', 'Production Specialist']
  ],
  meta_ads: [
    ['ad_setup', 'Audience Targeting & Ad Account Setup', 'Media Buyer'],
    ['ad_creative', 'Ad Creatives & Copywriting', 'Graphic Designer'],
    ['ad_launch', 'Campaign Launch & Tracking Verification', 'Media Buyer'],
    ['ad_optimization', 'Weekly Ad Optimization & Performance Report', 'Performance Specialist']
  ]
};

const toYmd = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const generateServiceProjectTasks = async (project, serviceType = null, forceRegen = false, baseStartDate = null) => {
  // Service milestones (website, SEO, meta ads, product shoot) are tracked within project details / stage tracking,
  // NOT as production task board cards. Production tasks must strictly be creative, reel, and festival only.
  return [];
};
