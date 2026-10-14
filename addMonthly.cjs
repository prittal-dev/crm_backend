const fs = require('fs');

const additionalPlans = `  ,
  // ================= NEW MONTHLY PLANS =================
  {
    customId: 'PLN-SMO-001-M',
    name: 'Social Media Basic',
    code: 'SMO_BASIC_MO',
    category: 'Social Media',
    popular: false,
    description: 'Essential multi-channel social presence with weekly posts & AI reels',
    billingType: 'Monthly',
    basePrice: 15000,
    gstPercent: 18,
    includes: [
      'Account Setup & Audit',
      'Meta Platforms (FB + IG)',
      'Bio & Linktree Optimization',
      'Organic Reach Enhancement',
      'Relevant Group Sharing',
      'Meta Keywords',
      'Monthly Performance Report'
    ],
    deliverablesQuota: {
      creatives: 4,
      aiReels: 4,
      carousels: 0,
      festival: false,
      summary: '4 Creatives + 4 AI Reels'
    },
    isActive: true
  },
  {
    customId: 'PLN-SMO-002-M',
    name: 'Social Media Standard',
    code: 'SMO_STD_MO',
    category: 'Social Media',
    popular: true,
    description: 'Active engagement, AI-assisted video strategy & Ad campaign setup',
    billingType: 'Monthly',
    basePrice: 30000,
    gstPercent: 18,
    includes: [
      'Account Setup & Audit',
      'Meta Platforms (FB + IG)',
      'Bio & Linktree Optimization',
      'Organic Reach Enhancement',
      'Relevant Group Sharing',
      'Ad Campaign Setup',
      'Audience Targeting Config',
      'Meta Keywords',
      'Monthly Performance Report',
      'Reach & Engagement Insights',
      'Strategic Recommendations'
    ],
    deliverablesQuota: {
      creatives: 8,
      aiReels: 8,
      carousels: 2,
      festival: true,
      summary: '8 Creatives + 8 Reels + Ads Setup'
    },
    isActive: true
  },
  {
    customId: 'PLN-SMO-003-M',
    name: 'Social Media Premium',
    code: 'SMO_PREM_MO',
    category: 'Social Media',
    popular: false,
    description: 'Complete brand takeover with Meta Ads, Community & DM Care',
    billingType: 'Monthly',
    basePrice: 50000,
    gstPercent: 18,
    includes: [
      'Account Setup & Audit',
      'Meta Platforms (FB + IG)',
      'Bio & Linktree Optimization',
      'Organic Reach Enhancement',
      'Relevant Group Sharing',
      'Ad Campaign Setup',
      'Audience Targeting Config',
      'Meta Keywords',
      'Monthly Performance Report',
      'Reach & Engagement Insights',
      'Strategic Recommendations'
    ],
    deliverablesQuota: {
      creatives: 15,
      aiReels: 10,
      carousels: 4,
      festival: true,
      summary: '15 Creatives + 10 Reels + Ads Mgmt'
    },
    isActive: true
  },
  {
    customId: 'PLN-SEO-001-M',
    name: 'SEO Starter',
    code: 'SEO_START_MO',
    category: 'SEO',
    popular: false,
    description: 'Foundational SEO for local and emerging businesses',
    billingType: 'Monthly',
    basePrice: 15000,
    gstPercent: 18,
    includes: [
      'Website SEO Audit',
      'Competitor Analysis',
      'Keyword Research',
      'On-Page Optimization',
      'Image Optimization',
      'Local Citation (GMB)',
      'High DA Backlinks (30)',
      'Article Submission',
      'Blog Commenting',
      'Profile Creation',
      'PDF Submission',
      'Social Bookmarking',
      'Country Targeting (1)',
      'Monthly Report'
    ],
    deliverablesQuota: {
      creatives: 0,
      aiReels: 0,
      carousels: 0,
      festival: false,
      blogs: 1,
      gmb: false,
      keywords: 10,
      platforms: 1,
      summary: '10 Keywords + Monthly Report'
    },
    isActive: true
  },
  {
    customId: 'PLN-SEO-002-M',
    name: 'SEO Standard',
    code: 'SEO_STD_MO',
    category: 'SEO',
    popular: true,
    description: 'Advanced organic growth targeting broader markets',
    billingType: 'Monthly',
    basePrice: 30000,
    gstPercent: 18,
    includes: [
      'Website SEO Audit',
      'Competitor Analysis',
      'Keyword Research',
      'On-Page Optimization',
      'Image Optimization',
      'Local Citation (GMB)',
      'High DA Backlinks (100)',
      'Article Submission',
      'Blog Commenting',
      'Profile Creation',
      'PDF Submission',
      'Social Bookmarking',
      'Country Targeting (1)',
      'Monthly Report',
      'Title Tag Optimization',
      'Meta Tag Optimization',
      'Site Map Creation',
      'Robots.txt Optimization',
      'Google Analytics Setup',
      'Search Console Setup'
    ],
    deliverablesQuota: {
      creatives: 0,
      aiReels: 0,
      carousels: 0,
      festival: false,
      blogs: 2,
      gmb: true,
      keywords: 30,
      platforms: 1,
      summary: '30 Keywords + Core Setup'
    },
    isActive: true
  },
  {
    customId: 'PLN-SEO-003-M',
    name: 'SEO Business',
    code: 'SEO_BIZ_MO',
    category: 'SEO',
    popular: false,
    description: 'Enterprise grade SEO dominating national/global search',
    billingType: 'Monthly',
    basePrice: 50000,
    gstPercent: 18,
    includes: [
      'Website SEO Audit',
      'Competitor Analysis',
      'Keyword Research',
      'On-Page Optimization',
      'Image Optimization',
      'Local Citation (GMB)',
      'High DA Backlinks (200+)',
      'Article Submission',
      'Blog Commenting',
      'Profile Creation',
      'PDF Submission',
      'Social Bookmarking',
      'Country Targeting (1)',
      'Monthly Report',
      'Title Tag Optimization',
      'Meta Tag Optimization',
      'Site Map Creation',
      'Robots.txt Optimization',
      'Google Analytics Setup',
      'Search Console Setup',
      'Schema Markup',
      'Page Speed Insights',
      'Content Strategy',
      'Weekly Strategy Calls'
    ],
    deliverablesQuota: {
      creatives: 0,
      aiReels: 0,
      carousels: 0,
      festival: false,
      blogs: 4,
      gmb: true,
      keywords: 50,
      platforms: 1,
      summary: '50 Keywords + Full Analytics'
    },
    isActive: true
  }
`;

let code = fs.readFileSync('e:/crm/backend/src/utils/seedPlans.js', 'utf8');
code = code.replace('];\r\n\r\nexport', additionalPlans + '\r\n];\r\n\r\nexport');
code = code.replace('];\n\nexport', additionalPlans + '\n];\n\nexport');
fs.writeFileSync('e:/crm/backend/src/utils/seedPlans.js', code);
console.log('Done!');
