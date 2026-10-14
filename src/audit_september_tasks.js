import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
dotenv.config();

import { Project } from './models/Project.js';
import { Task } from './models/Task.js';
import { FESTIVALS_AND_HOLIDAYS } from './utils/festivalConstants.js';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/prittal_crm');
  const projects = await Project.find({ status: { $ne: 'cancelled' } });
  console.log(`Auditing September tasks for ${projects.length} active projects...\n`);

  const sepFestivals = FESTIVALS_AND_HOLIDAYS.filter(f => f.date.startsWith('2026-09'));
  console.log('September 2026 Festivals in Constants:', sepFestivals.map(f => `${f.name} (${f.date})`).join(', '));

  for (const p of projects) {
    const isWeb = String(p.soldPlanName || p.planSnapshot?.name || p.name || '').toLowerCase().includes('website');
    if (isWeb) continue;

    const projIds = [p._id.toString(), p.customId].filter(Boolean);
    const tasks = await Task.find({
      projectId: { $in: projIds },
      dueDate: { $gte: '2026-09-01', $lte: '2026-09-30' }
    });

    const festTasks = tasks.filter(t => t.taskType === 'festival' || (t.name || '').toLowerCase().includes('festival'));
    const creativeTasks = tasks.filter(t => t.taskType === 'creative' || (t.name || '').toLowerCase().includes('creative'));
    const reelTasks = tasks.filter(t => t.taskType === 'reel' || (t.name || '').toLowerCase().includes('reel') || (t.name || '').toLowerCase().includes('short'));

    console.log(`\nProject: ${p.name} (${p.brandName || p.companyName}) | handover: ${p.handoverDate}`);
    console.log(`  September Total Tasks: ${tasks.length} (Creatives: ${creativeTasks.length}, Reels: ${reelTasks.length}, Festivals: ${festTasks.length})`);
    if (festTasks.length > 0) {
      festTasks.forEach(f => console.log(`    Festival Task: "${f.name}" | Due: ${f.dueDate} | Status: ${f.status} | Assigned: ${f.assignedTo}`));
    } else {
      console.log(`    ⚠️ NO FESTIVAL TASKS FOUND IN SEPTEMBER!`);
    }
  }

  await mongoose.disconnect();
}

run().catch(console.error);
