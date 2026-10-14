import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Project } from '../models/Project.js';
import { Client } from '../models/Client.js';
import { TeamMember } from '../models/TeamMember.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const liveTeamMembers = [
  { customId: 'tm_tushar', name: 'Tushar', department: 'Production', role: 'Account Manager Head & Designer', workload: 8, availability: 'Available', performance: 96 },
  { customId: 'tm_laxmi', name: 'Laxmi', department: 'Production', role: 'Account Manager & Designer', workload: 5, availability: 'Available', performance: 94 },
  { customId: 'tm_yash', name: 'Yash', department: 'Design', role: 'Senior Graphic Designer', workload: 8, availability: 'Busy', performance: 95 },
  { customId: 'tm_ayush', name: 'Ayush', department: 'Video & Animation', role: 'Lead Video Editor', workload: 10, availability: 'Busy', performance: 98 },
  { customId: 'tm_manish', name: 'Manish', department: 'Sales', role: 'Sales Lead & Client Relations', workload: 12, availability: 'Available', performance: 98 },
  { customId: 'tm_mahesh', name: 'Mahesh', department: 'Sales', role: 'Business Development Executive', workload: 3, availability: 'Available', performance: 92 }
];

export async function seedLiveAgencyData() {
  try {
    const existingCount = await TeamMember.countDocuments();
    if (existingCount === 0) {
      console.log('Seeding initial team members...');
      for (const tm of liveTeamMembers) {
        await TeamMember.create(tm);
      }
    }

    // 2. Load detailed dataset from JSON
    const jsonPath = path.resolve(__dirname, '../../../xml/detailed_seed_dataset.json');
    let rawProjects = [];
    if (fs.existsSync(jsonPath)) {
      const buffer = fs.readFileSync(jsonPath);
      let fileData = '';
      
      // Detect UTF-16 LE BOM (FF FE) or UTF-16 BE (FE FF)
      if (buffer[0] === 0xff && buffer[1] === 0xfe) {
        fileData = buffer.toString('utf16le');
      } else if (buffer[0] === 0xfe && buffer[1] === 0xff) {
        fileData = buffer.swap16().toString('utf16le');
      } else {
        fileData = buffer.toString('utf8');
      }
      
      // Strip UTF-8 / UTF-16 BOM and trim leading/trailing whitespace
      fileData = fileData.replace(/^\uFEFF/, '').trim();
      
      rawProjects = JSON.parse(fileData);
    }

    let seededCount = 0;
    for (const p of rawProjects) {
      const company = p.companyName || p.client || 'Client';
      const brand = p.brandName || company;
      const cleanCompanyId = company.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 14);

      // Create / Update Client
      await Client.findOneAndUpdate(
        { customId: `cl_${cleanCompanyId}` },
        {
          $set: {
            customId: `cl_${cleanCompanyId}`,
            name: company,
            company: company,
            contact: p.accountManager ? `${p.accountManager} (AM)` : (p.salesTeam?.[0] ? `${p.salesTeam[0]} (Sales)` : 'Manish (Sales)'),
            projects: `${brand} Campaign`,
            services: Array.isArray(p.services) ? p.services.join(', ') : (p.services || 'SMO & Content'),
            revenue: p.planDuration === 'YEARLY' ? '₹60,000' : p.planDuration === 'QUARTERLY' ? '₹40,000' : '₹35,000',
            manager: p.accountManager || p.productionManager || 'Tushar',
            paymentStatus: p.renewalStatus === 'NEW' ? 'pending' : 'paid',
            email: `contact@${cleanCompanyId || 'client'}.com`,
            phone: '+91 98765 43210',
            status: 'active',
            dealValue: p.planDuration === 'YEARLY' ? '₹60,000' : p.planDuration === 'QUARTERLY' ? '₹40,000' : '₹35,000',
            category: p.services?.[0] || 'SMO',
            source: 'Inbound Sales',
            assignedRep: p.salesTeam?.[0] || 'Manish'
          }
        },
        { upsert: true, new: true }
      );

      const rawLogs = p.dailyLogs || [];
      const postedLogs = rawLogs.filter(l => l.status && !l.status.toUpperCase().includes('PENDING') && !l.status.toUpperCase().includes('HOLIDAY') && !l.status.toUpperCase().includes('OFF') && !l.status.toUpperCase().includes('—'));
      const festivalsCount = postedLogs.filter(l => l.postType === 'festival' || (l.status && l.status.toUpperCase().includes('FESTIVAL'))).length;
      const creativesCount = postedLogs.filter(l => (l.postType === 'creative' || (l.status && l.status.toUpperCase().includes('CREATIVE') && !l.status.toUpperCase().includes('FESTIVAL'))) && l.postType !== 'festival').length;
      const reelsCount = postedLogs.filter(l => l.postType === 'reel' || (l.status && (l.status.toUpperCase().includes('REEL') || l.status.toUpperCase().includes('VIDEO')))).length;
      const blogsCount = postedLogs.filter(l => l.postType === 'blog' || (l.status && l.status.toUpperCase().includes('BLOG'))).length;

      const hasFest = p.deliverablesQuota?.festival !== false && (p.content?.festivalContent !== 0);
      const quotaCreatives = parseInt(p.deliverablesQuota?.creatives ?? p.content?.creatives, 10) || 4;
      const quotaReels = parseInt(p.deliverablesQuota?.aiReels ?? p.content?.shorts, 10) || 4;

      // Create / Update Project with all handover and delivery fields
      const projectData = {
        customId: p.customId,
        name: p.name || `${brand} Campaign`,
        companyName: company,
        brandName: brand,
        whatsappGroupName: `${brand} Official Group`,
        client: company,
        services: p.services || ['SMO'],
        salesTeam: p.salesTeam || ['Manish'],
        accountManager: p.accountManager || 'Tushar',
        graphicDesigner: p.graphicDesigner || 'Yash',
        videoEditor: p.videoEditor || 'Ayush',
        productionManager: p.productionManager || 'Tushar',
        handoverDate: p.handoverDate || '18/05/2026',
        startDate: p.startDate || '19/05/2026',
        renewalDate: p.renewalDate || '29/08/2026',
        nextRenewalDate: p.nextRenewalDate || '29/09/2026',
        renewalStatus: p.renewalStatus || 'YES',
        planDuration: p.planDuration || 'MONTHLY',
        budget: p.planDuration === 'YEARLY' ? '₹60,000' : p.planDuration === 'QUARTERLY' ? '₹40,000' : '₹35,000',
        progress: p.renewalStatus === 'NEW' ? 25 : 85,
        deliverablesQuota: {
          creatives: quotaCreatives,
          carousels: parseInt(p.deliverablesQuota?.carousels, 10) || 0,
          aiReels: quotaReels,
          basicReels: 0,
          longVideos: parseInt(p.deliverablesQuota?.longVideos, 10) || 0,
          festival: hasFest,
          blogs: parseInt(p.deliverablesQuota?.blogs, 10) || 0,
          gmb: company.toUpperCase().includes('VINAYAK') || company.toUpperCase().includes('PRITTAL')
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

      await Project.findOneAndUpdate(
        { customId: p.customId },
        { $set: projectData },
        { upsert: true, new: true }
      );
      seededCount++;
    }

    console.log(`✓ Successfully seeded ${seededCount} live projects with complete daily logs and handover dates.`);
    return { success: true, count: seededCount };
  } catch (err) {
    console.error('Error seeding live agency data:', err);
    throw err;
  }
}
