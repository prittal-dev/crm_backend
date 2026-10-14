import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import { Project } from '../src/models/Project.js';
import { Task } from '../src/models/Task.js';

const normalize = (value) => String(value || '').toLowerCase().replace(/[_-]+/g, ' ').trim();

const isWebsiteOrSeoTask = (task) => {
  if (!task) return false;
  const type = normalize(task.taskType || task.type);
  const name = String(task.name || '').toLowerCase();

  // Website
  if (type.startsWith('web') || ['content_upload', 'website_qa', 'deployment', 'content upload', 'website qa'].includes(type)) return true;
  if (type === 'website' || /ui\/ux|website development|catalog & content|testing & revisions|domain, hosting|website qa|website/i.test(name)) return true;

  // SEO
  if (type.includes('seo') || type === 'keyword_research' || type === 'keyword research' || type === 'seo_audit' || type === 'on_page_seo' || type === 'off_page_seo' || type === 'seo_reporting') return true;
  if (/technical seo|on-page seo|off-page seo|ranking report|keyword research|competitor research|\bseo\b/i.test(name)) return true;

  return false;
};

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const projects = await Project.find({}).lean();
  console.log('Total projects:', projects.length);

  for (const project of projects) {
    const pIds = [String(project.customId || ''), String(project._id || '')].filter(Boolean);
    const dbTasks = await Task.find({ projectId: { $in: pIds } }).lean();
    if (!dbTasks.length) continue;

    const monthsInDb = Array.from(new Set(dbTasks.map(t => Number(t.monthNumber) || 1))).sort((a,b) => a-b);
    let projHeaderPrinted = false;

    for (const mIdx of monthsInDb) {
      const monthDbTasks = dbTasks.filter(t => (Number(t.monthNumber) || 1) === mIdx);
      
      const rawWithFilter = monthDbTasks.filter(t => !isWebsiteOrSeoTask(t));
      const excludedWebsiteOrSeo = monthDbTasks.filter(t => isWebsiteOrSeoTask(t));

      const seenMonthSlotKeys = new Set();
      const droppedByDeduplication = [];
      const keptAfterSlotDedup = rawWithFilter.filter(t => {
        const isFest = t.taskType === 'festival' || (t.name || '').toLowerCase().includes('festival');
        const isReel = !isFest && (t.taskType === 'reel' || (t.name || '').toLowerCase().includes('reel') || (t.name || '').toLowerCase().includes('short'));
        const typeCat = isFest ? 'festival' : isReel ? 'reel' : 'creative';
        
        if (isFest) {
          const festName = String(t.name || '').toLowerCase().replace(/^(festival\s*post\s*:?|festival\s*:?)\s*/i, '').trim();
          const festDate = t.dueDate || t.completedDate || '';
          const k = `m${mIdx}_fest_${festName || festDate}`;
          if (seenMonthSlotKeys.has(k)) {
            droppedByDeduplication.push({ task: t, reason: `Duplicate festival slot key ${k}` });
            return false;
          }
          seenMonthSlotKeys.add(k);
          return true;
        }

        let w = (t.weekNumber !== undefined && t.weekNumber !== null && t.weekNumber !== '') ? Number(t.weekNumber) : 1;
        let slotIdx = 1;
        const customIdStr = String(t.customId || '');
        const slotMatch = customIdStr.match(/_[cr]_(\d+)/);
        if (slotMatch && slotMatch[1]) {
          slotIdx = parseInt(slotMatch[1], 10);
        } else {
          const nameMatch = String(t.name || '').match(/#(\d+)/);
          if (nameMatch && nameMatch[1]) {
            slotIdx = parseInt(nameMatch[1], 10);
          }
        }

        const k = `m${mIdx}_w${w}_${typeCat}_${slotIdx}`;
        if (seenMonthSlotKeys.has(k)) {
          droppedByDeduplication.push({ task: t, reason: `Duplicate slot key ${k}` });
          return false;
        }
        seenMonthSlotKeys.add(k);
        return true;
      });

      if (excludedWebsiteOrSeo.length > 0 || droppedByDeduplication.length > 0) {
        if (!projHeaderPrinted) {
          console.log(`\n========================================`);
          console.log(`Project: "${project.brandName || project.name}" (customId: ${project.customId})`);
          console.log(`  Total tasks in DB: ${dbTasks.length}`);
          projHeaderPrinted = true;
        }
        console.log(`  Month ${mIdx}: DB has ${monthDbTasks.length} tasks.`);
        if (excludedWebsiteOrSeo.length > 0) {
          console.log(`    -> ${excludedWebsiteOrSeo.length} tasks EXCLUDED by isWebsiteOrSeoTask:`, excludedWebsiteOrSeo.map(t => t.name));
        }
        if (droppedByDeduplication.length > 0) {
          console.log(`    -> ${droppedByDeduplication.length} tasks DROPPED by seenMonthSlotKeys:`, droppedByDeduplication.map(d => `${d.task.name} (${d.reason})`));
        }
      }
    }
  }
  process.exit(0);
}

main().catch(console.error);
