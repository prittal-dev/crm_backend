import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
dotenv.config();

import { Project } from './src/models/Project.js';
import { Task } from './src/models/Task.js';

export async function deduplicateProjectTasksInDb(project, dryRun = true) {
  const pIds = [project.customId, project._id?.toString()].filter(Boolean);
  const tasks = await Task.find({ projectId: { $in: pIds } });
  if (!tasks || tasks.length === 0) return { deletedCount: 0, preservedCount: 0 };

  const brand = project.brandName || project.name || 'Project';

  // Group tasks by deliverable slot:
  // Slot key: m{month}_w{week}_{type}_{index}
  // For festival: m{month}_fest_{festivalName}
  const slotGroups = new Map();

  for (const t of tasks) {
    const rawName = t.name || '';
    const lowerName = rawName.toLowerCase();
    const m = Number(t.monthNumber) || 1;
    const w = Number(t.weekNumber) || 1;
    
    let type = t.taskType || '';
    if (!type || type === 'creative') {
      if (lowerName.includes('reel') || lowerName.includes('short')) type = 'reel';
      else if (lowerName.includes('carousel')) type = 'carousel';
      else if (lowerName.includes('festival')) type = 'festival';
      else type = 'creative';
    }

    let slotKey = '';
    if (type === 'festival') {
      const festName = lowerName
        .replace(/^festival post:\s*/i, '')
        .split('-')[0]
        .split(':')[0]
        .trim();
      slotKey = `m${m}_fest_${festName}`;
    } else {
      const numMatch = rawName.match(/#(\d+)/);
      const slotNum = numMatch ? numMatch[1] : '1';
      slotKey = `m${m}_w${w}_${type}_${slotNum}`;
    }

    if (!slotGroups.has(slotKey)) {
      slotGroups.set(slotKey, []);
    }
    slotGroups.get(slotKey).push(t);
  }

  const toDeleteIds = [];
  const toUpdate = [];

  for (const [slotKey, group] of slotGroups.entries()) {
    if (group.length <= 1) continue;

    // Rank tasks to keep the best one:
    // 1. Done status + delivery link
    // 2. Done status + completedDate
    // 3. Done status
    // 4. In progress / review
    // 5. User edited / custom moved
    // 6. Has remarks
    // 7. Oldest created (original)
    group.sort((a, b) => {
      const aDone = a.status === 'done' || a.status === 'completed' || a.status === 'published';
      const bDone = b.status === 'done' || b.status === 'completed' || b.status === 'published';
      const aLink = Boolean(a.deliveryLink && a.deliveryLink.trim());
      const bLink = Boolean(b.deliveryLink && b.deliveryLink.trim());

      if (aDone && aLink && (!bDone || !bLink)) return -1;
      if (bDone && bLink && (!aDone || !aLink)) return 1;

      if (aDone && !bDone) return -1;
      if (bDone && !aDone) return 1;

      const aComp = Boolean(a.completedDate);
      const bComp = Boolean(b.completedDate);
      if (aComp && !bComp) return -1;
      if (bComp && !aComp) return 1;

      const aEdit = Boolean(a.isUserEdited || a.isCustomMoved);
      const bEdit = Boolean(b.isUserEdited || b.isCustomMoved);
      if (aEdit && !bEdit) return -1;
      if (bEdit && !aEdit) return 1;

      const aRem = Boolean(a.remarks);
      const bRem = Boolean(b.remarks);
      if (aRem && !bRem) return -1;
      if (bRem && !aRem) return 1;

      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    });

    const bestTask = group[0];
    const duplicates = group.slice(1);

    console.log(`  [${slotKey}] Keeping: "${bestTask.name}" (${bestTask._id}, status: ${bestTask.status}, link: "${bestTask.deliveryLink || ''}")`);
    duplicates.forEach(dup => {
      console.log(`    -> Deleting duplicate: "${dup.name}" (${dup._id}, status: ${dup.status}, link: "${dup.deliveryLink || ''}")`);
      toDeleteIds.push(dup._id);
    });
  }

  if (!dryRun && toDeleteIds.length > 0) {
    await Task.deleteMany({ _id: { $in: toDeleteIds } });
  }

  return {
    deletedCount: toDeleteIds.length,
    preservedCount: tasks.length - toDeleteIds.length
  };
}

async function run() {
  const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/prittal_crm';
  await mongoose.connect(mongoURI);

  const projects = await Project.find({}).lean();
  let totalDeleted = 0;

  console.log(`Starting duplicate tasks cleanup across ${projects.length} projects...\n`);

  for (const p of projects) {
    const res = await deduplicateProjectTasksInDb(p, false); // execute real cleanup
    if (res.deletedCount > 0) {
      console.log(`✓ Cleaned ${res.deletedCount} duplicate tasks from "${p.brandName || p.name}"\n`);
      totalDeleted += res.deletedCount;
    }
  }

  console.log(`\n=== COMPLETED: Auto-fixed and deleted ${totalDeleted} duplicate tasks across all projects! ===`);

  await mongoose.disconnect();
}

run().catch(console.error);
