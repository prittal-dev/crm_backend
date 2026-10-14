import fs from 'fs';

const rawData = fs.readFileSync('e:\\crm\\xml\\detailed_seed_dataset.json', 'utf8');
const projects = JSON.parse(rawData);

const cleanProjects = projects.map((p, idx) => {
  return {
    customId: p.customId || `proj_${idx + 1}`,
    name: p.name || `${p.brandName || p.companyName} Campaign`,
    companyName: p.companyName || 'Client Company',
    brandName: p.brandName || p.companyName || 'Brand',
    whatsappGroupName: `${p.brandName || p.companyName} Official Group`,
    client: p.companyName || 'Client Company',
    services: p.services || ['SMO'],
    salesTeam: p.salesTeam || ['Manish'],
    accountManager: p.accountManager || 'Tushar',
    graphicDesigner: p.graphicDesigner || 'Yash',
    videoEditor: p.videoEditor || 'Ayush',
    productionManager: p.productionManager || 'Tushar',
    handoverDate: p.handoverDate || '2026-05-18',
    startDate: p.startDate || '2026-05-19',
    renewalDate: p.renewalDate || '2026-08-29',
    nextRenewalDate: p.nextRenewalDate || '2026-09-29',
    renewalStatus: p.renewalStatus || 'YES',
    planDuration: p.planDuration || 'MONTHLY',
    budget: p.planDuration === 'YEARLY' ? '₹60,000' : p.planDuration === 'QUARTERLY' ? '₹40,000' : '₹35,000',
    progress: p.renewalStatus === 'NEW' ? 25 : 85,
    const rawLogs = p.dailyLogs || [];
    const postedLogs = rawLogs.filter(l => l.status && !l.status.toUpperCase().includes('PENDING') && !l.status.toUpperCase().includes('HOLIDAY') && !l.status.toUpperCase().includes('OFF') && !l.status.toUpperCase().includes('—'));
    const festivalsCount = postedLogs.filter(l => l.postType === 'festival' || (l.status && l.status.toUpperCase().includes('FESTIVAL'))).length;
    const creativesCount = postedLogs.filter(l => (l.postType === 'creative' || (l.status && l.status.toUpperCase().includes('CREATIVE') && !l.status.toUpperCase().includes('FESTIVAL'))) && l.postType !== 'festival').length;
    const reelsCount = postedLogs.filter(l => l.postType === 'reel' || (l.status && (l.status.toUpperCase().includes('REEL') || l.status.toUpperCase().includes('VIDEO')))).length;
    const blogsCount = postedLogs.filter(l => l.postType === 'blog' || (l.status && l.status.toUpperCase().includes('BLOG'))).length;

    const hasFest = p.deliverablesQuota?.festival !== false && (p.content?.festivalContent !== 0);
    const quotaCreatives = parseInt(p.deliverablesQuota?.creatives ?? p.content?.creatives, 10) || 4;
    const quotaReels = parseInt(p.deliverablesQuota?.aiReels ?? p.content?.shorts, 10) || 4;

    return {
      customId: p.customId || `proj_${idx + 1}`,
      name: p.name || `${p.brandName || p.companyName} Campaign`,
      companyName: p.companyName || 'Client Company',
      brandName: p.brandName || p.companyName || 'Brand',
      whatsappGroupName: `${p.brandName || p.companyName} Official Group`,
      client: p.companyName || 'Client Company',
      services: p.services || ['SMO'],
      salesTeam: p.salesTeam || ['Manish'],
      accountManager: p.accountManager || 'Tushar',
      graphicDesigner: p.graphicDesigner || 'Yash',
      videoEditor: p.videoEditor || 'Ayush',
      productionManager: p.productionManager || 'Tushar',
      handoverDate: p.handoverDate || '2026-05-18',
      startDate: p.startDate || '2026-05-19',
      renewalDate: p.renewalDate || '2026-08-29',
      nextRenewalDate: p.nextRenewalDate || '2026-09-29',
      renewalStatus: p.renewalStatus || 'YES',
      planDuration: p.planDuration || 'MONTHLY',
      budget: p.planDuration === 'YEARLY' ? '₹60,000' : p.planDuration === 'QUARTERLY' ? '₹40,000' : '₹35,000',
      progress: p.renewalStatus === 'NEW' ? 25 : 85,
      deliverablesQuota: {
        creatives: quotaCreatives,
        carousels: parseInt(p.deliverablesQuota?.carousels || 0, 10) || 0,
        aiReels: quotaReels,
        basicReels: 0,
        longVideos: parseInt(p.deliverablesQuota?.longVideos || 0, 10) || 0,
        festival: hasFest,
        blogs: parseInt(p.deliverablesQuota?.blogs || 0, 10) || 0,
        gmb: p.companyName?.includes('VINAYAK') || p.companyName?.includes('PRITTAL')
      },
      content: {
        creatives: quotaCreatives,
        carousels: parseInt(p.content?.carousels ?? p.deliverablesQuota?.carousels, 10) || 0,
        shorts: quotaReels,
        aiVideos: 0,
        longVideos: parseInt(p.content?.longVideos ?? p.deliverablesQuota?.longVideos, 10) || 0,
        festivalContent: hasFest ? 1 : 0,
        blogs: parseInt(p.content?.blogs ?? p.deliverablesQuota?.blogs, 10) || 0,
      },
      deliveredCounts: {
        creatives: Math.max(p.deliveredCounts?.creatives || 0, creativesCount),
        reels: Math.max(p.deliveredCounts?.reels || 0, reelsCount),
        festivals: Math.max(p.deliveredCounts?.festivals || 0, festivalsCount),
        blogs: Math.max(p.deliveredCounts?.blogs || 0, blogsCount)
      },
      social: {
        facebook: p.social?.facebook || '',
        instagram: p.social?.instagram || '',
        linkedin: p.social?.linkedin || '',
        twitter: p.social?.twitter || '',
        youtube: p.social?.youtube || '',
        whatsapp: '+91 98765 43210'
      },
      dailyLogs: (p.dailyLogs || []).map(l => {
        const lStatus = l.status || 'N/A';
        const isLFest = l.postType === 'festival' || lStatus.toUpperCase().includes('FESTIVAL');
        const isLReel = !isLFest && (l.postType === 'reel' || lStatus.toUpperCase().includes('REEL') || lStatus.toUpperCase().includes('VIDEO'));
        const lPostType = isLFest ? 'festival' : (isLReel ? 'reel' : (l.postType || 'creative'));
        return {
          date: l.date,
          dayName: '',
          status: lStatus,
          postType: lPostType,
          postUrl: '',
          remarks: l.remarks || '',
          pendingReason: lStatus.includes('PENDING') ? l.remarks : '',
          loggedBy: p.graphicDesigner || 'Team Member',
          updatedAt: new Date()
        };
      }),
      weeklyDeliveries: p.weeklyDeliveries || [],
      monthlyReportStatus: creativesCount >= quotaCreatives ? 'DELIVERED' : 'PENDING'
    };
  });

const teamMembers = [
  { customId: 'tm_tushar', name: 'Tushar', department: 'Production', role: 'Account Manager & Designer', workload: 8, availability: 'Available', performance: 96 },
  { customId: 'tm_laxmi', name: 'Laxmi', department: 'Production', role: 'Account Manager & Designer', workload: 5, availability: 'Available', performance: 94 },
  { customId: 'tm_yash', name: 'Yash', department: 'Design', role: 'Senior Graphic Designer', workload: 8, availability: 'Busy', performance: 95 },
  { customId: 'tm_ayush', name: 'Ayush', department: 'Video & Animation', role: 'Lead Video Editor', workload: 10, availability: 'Busy', performance: 98 },
  { customId: 'tm_manish', name: 'Manish', department: 'Sales', role: 'Sales Lead & Client Relations', workload: 12, availability: 'Available', performance: 98 },
  { customId: 'tm_mahesh', name: 'Mahesh', department: 'Sales', role: 'Business Development Executive', workload: 3, availability: 'Available', performance: 92 }
];

const fileContent = `import { Project } from '../models/Project.js';
import { Client } from '../models/Client.js';
import { TeamMember } from '../models/TeamMember.js';

export const liveTeamMembers = ${JSON.stringify(teamMembers, null, 2)};

export const liveProjectsData = ${JSON.stringify(cleanProjects, null, 2)};

export async function seedLiveAgencyData() {
  try {
    console.log('Seeding Live Agency dataset into MongoDB...');

    // 1. Seed Team Members
    for (const tm of liveTeamMembers) {
      await TeamMember.findOneAndUpdate(
        { customId: tm.customId },
        { $set: tm },
        { upsert: true, new: true }
      );
    }

    // 2. Seed Clients
    for (const proj of liveProjectsData) {
      await Client.findOneAndUpdate(
        { customId: 'cl_' + proj.customId.replace('proj_', '') },
        {
          $set: {
            customId: 'cl_' + proj.customId.replace('proj_', ''),
            name: proj.companyName,
            company: proj.companyName,
            email: \`contact@\${proj.companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com\`,
            phone: '+91 98765 43210',
            status: 'active',
            dealValue: proj.budget,
            category: proj.services[0] || 'SMO',
            source: 'Inbound Sales',
            assignedRep: proj.salesTeam[0] || 'Manish'
          }
        },
        { upsert: true, new: true }
      );
    }

    // 3. Seed Projects
    for (const proj of liveProjectsData) {
      await Project.findOneAndUpdate(
        { customId: proj.customId },
        { $set: proj },
        { upsert: true, new: true }
      );
    }
    console.log('✓ Successfully seeded ' + liveProjectsData.length + ' Projects with exact Daily Logs & Handover details.');
    return { success: true, count: liveProjectsData.length };
  } catch (err) {
    console.error('Error seeding agency data:', err);
    throw err;
  }
}
`;

fs.writeFileSync('e:\\crm\\backend\\src\\utils\\seedLiveAgencyData.js', fileContent, 'utf8');
console.log('Updated backend/src/utils/seedLiveAgencyData.js successfully with all detailed records!');
