import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

// Clean glyphs, icons and trailing commas from addresses
const cleanAddressText = (val) => {
  if (!val) return '';
  return String(val)
    .replace(/[\uE000-\uF8FF]/g, '') // Google font private-use icons (e.g. )
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '') // Unicode surrogate glyphs (e.g. 🖈)
    .replace(/[•·]/g, ', ')
    .replace(/^[\s,.\-🖈•·]+|[\s,.\-🖈•·]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Automatically determine the proper Service to Pitch, Category, and Remark
 * based on digital presence (website, social activity, ratings & reviews)
 * Matches the exact service catalog of existing leads in the CRM.
 */
export const calculateSmartPitch = ({
  websiteExist = 'No',
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

  let service = '';
  let serviceCategory = 'Lead Generation';
  let remark = '';
  let chances = 'High';

  if (!hasWebsite && !hasSocial) {
    service = 'Website Design + Social Media Management + GMB Optimization + Review Generation';
    serviceCategory = 'Website Design';
    remark = 'No website or social presence found. Pitch complete online identity setup, responsive website and Google review generation.';
    chances = 'High';
  } else if (!hasWebsite && hasSocial) {
    service = 'Website Design + Social Media Setup + Paid Promotions + Review Generation';
    serviceCategory = 'Website Design';
    remark = 'Active on social channels but has no official website. High opportunity for business catalogue website and lead funnels.';
    chances = 'High';
  } else if (hasWebsite && !hasSocial) {
    service = 'Social Media Setup + Paid Promotions + Review Generation';
    serviceCategory = 'SMO & Social Media';
    remark = 'Website exists but social platforms are missing. Pitch social media branding, Meta ad campaigns, and Google review generation.';
    chances = 'High';
  } else if (hasWebsite && hasSocial && reviewCount < 30) {
    service = 'Social Media Setup + Paid Promotions + GMB Optimization + Review Generation';
    serviceCategory = 'Lead Generation';
    remark = 'Digital presence exists. High value in pitching Google Maps ranking, review acceleration and local lead generation.';
    chances = 'High';
  } else {
    service = 'Paid Promotions + Review Generation';
    serviceCategory = 'Lead Generation';
    remark = 'Established brand presence. Pitch performance ads, review generation and scale-up marketing.';
    chances = 'Medium';
  }

  return { service, serviceCategory, remark, chances };
};

async function fixAllLeads() {
  console.log('[Script] Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('[Script] Connected successfully.');

  const col = mongoose.connection.collection('leads');
  const leads = await col.find({}).toArray();
  console.log(`[Script] Found ${leads.length} total leads in database. Checking for inconsistencies...`);

  let updatedCount = 0;

  for (const lead of leads) {
    let changed = false;
    const updates = {};

    // 1. Social Presence Check
    const hasSocial = ['instagram', 'facebook', 'linkedin', 'youtube'].some(
      key => String(lead[key] || '').toLowerCase() === 'yes'
    );

    // If no social platforms exist, socialActivities MUST be "Not Active"
    if (!hasSocial && (lead.socialActivities || '').toLowerCase() !== 'not active') {
      updates.socialActivities = 'Not Active';
      changed = true;
    } else if (hasSocial && (!lead.socialActivities || lead.socialActivities.toLowerCase() === 'not active')) {
      updates.socialActivities = 'Active';
      changed = true;
    }

    // 2. Service to Pitch Check
    const currentService = (lead.service || '').trim();
    const needsSmartPitch = !currentService || currentService.toLowerCase() === 'lead generation' || currentService === '--';

    if (needsSmartPitch) {
      const pitch = calculateSmartPitch({
        websiteExist: lead.websiteExist || (lead.url ? 'Yes' : 'No'),
        socialActivities: updates.socialActivities || lead.socialActivities,
        reviews: lead.reviews || '0',
        instagram: lead.instagram,
        facebook: lead.facebook,
        linkedin: lead.linkedin,
        youtube: lead.youtube
      });

      updates.service = pitch.service;
      updates.serviceCategory = pitch.serviceCategory;
      if (!lead.remark || lead.remark.trim() === '') {
        updates.remark = pitch.remark;
      }
      changed = true;
    }

    // 3. Clean address glyphs (like , T, 1/81, 1/81)
    if (lead.address && (/[\uE000-\uF8FF]/.test(lead.address) || /[\uD800-\uDBFF]/.test(lead.address) || /^[\s,.\-🖈•·]/.test(lead.address))) {
      const cleaned = cleanAddressText(lead.address);
      if (cleaned !== lead.address) {
        updates.address = cleaned;
        changed = true;
      }
    }

    if (changed) {
      await col.updateOne({ _id: lead._id }, { $set: updates });
      updatedCount++;
      console.log(`[FIXED] "${lead.company}" (ID: ${lead.customId || lead._id})`);
      if (updates.socialActivities) {
        console.log(`   ↳ Social: "${lead.socialActivities}" -> "${updates.socialActivities}"`);
      }
      if (updates.service) {
        console.log(`   ↳ Pitch: "${lead.service || '(empty)'}" -> "${updates.service}" (Cat: ${updates.serviceCategory})`);
      }
      if (updates.address) {
        console.log(`   ↳ Address: "${lead.address}" -> "${updates.address}"`);
      }
    }
  }

  console.log(`\n======================================================`);
  console.log(`[Script Complete] Updated ${updatedCount} leads successfully.`);
  console.log(`======================================================`);

  await mongoose.disconnect();
}

fixAllLeads().catch(err => {
  console.error('[Script Error]:', err);
  process.exit(1);
});
