import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
dotenv.config();

import { Project } from './src/models/Project.js';
import { Task } from './src/models/Task.js';

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const projects = await Project.find({}).lean();
  console.log(`Checking all ${projects.length} projects for duplicate tasks by slot...`);

  let totalDupes = 0;

  for (const p of projects) {
    const pIds = [p.customId, p._id?.toString()].filter(Boolean);
    const tasks = await Task.find({ projectId: { $in: pIds } }).lean();
    if (!tasks || tasks.length === 0) continue;

    // Group tasks by (monthNumber, weekNumber, taskType, slotNumber)
    // For creative #1, #2 etc:
    // Extract taskType: creative, reel, carousel, festival
    // If festival: match by festival name
    // If creative/reel: match by slot number (#1, #2) or single (1)
    const slotMap = new Map();

    for (const t of tasks) {
      const type = t.taskType || (t.name?.toLowerCase().includes('reel') ? 'reel' : (t.name?.toLowerCase().includes('festival') ? 'festival' : 'creative'));
      const m = t.monthNumber || 1;
      const w = t.weekNumber || 1;
      let slotKey = '';

      if (type === 'festival') {
        const festName = t.name?.toLowerCase().replace(/^festival post:\s*/i, '').split('-')[0].trim();
        slotKey = `m${m}_w${w}_fest_${festName}`;
      } else {
        const numMatch = t.name?.match(/#(\d+)/);
        const slotNum = numMatch ? numMatch[1] : '1';
        slotKey = `m${m}_w${w}_${type}_${slotNum}`;
      }

      if (!slotMap.has(slotKey)) {
        slotMap.set(slotKey, []);
      }
      slotMap.get(slotKey).push(t);
    }

    const dupes = [];
    for (const [key, group] of slotMap.entries()) {
      if (group.length > 1) {
        dupes.push({ key, group });
        totalDupes += (group.length - 1);
      }
    }

    if (dupes.length > 0) {
      console.log(`\n========================================`);
      console.log(`PROJECT: "${p.brandName || p.name}" (${p.customId})`);
      console.log(`Total tasks: ${tasks.length}, Duplicate slots: ${dupes.length}`);
      dupes.forEach(d => {
        console.log(`  Slot [${d.key}] has ${d.group.length} tasks:`);
        d.group.forEach(t => {
          console.log(`    - ID: ${t._id}, Name: "${t.name}", Status: ${t.status}, Due: ${t.dueDate}, Link: "${t.deliveryLink || ''}"`);
        });
      });
    }
  }

  console.log(`\n\nTotal duplicate tasks across entire database: ${totalDupes}`);
  await mongoose.disconnect();
}

check().catch(console.error);
