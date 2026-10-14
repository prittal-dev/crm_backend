import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
dotenv.config();

import { Project } from './src/models/Project.js';
import { Task } from './src/models/Task.js';

async function detailedScan() {
  const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/prittal_crm';
  await mongoose.connect(mongoURI);

  const projects = await Project.find({}).lean();
  console.log(`Analyzing tasks across ${projects.length} projects...`);

  for (const p of projects) {
    const pIds = [p.customId, p._id?.toString()].filter(Boolean);
    const tasks = await Task.find({ projectId: { $in: pIds } }).lean();
    if (!tasks || tasks.length === 0) continue;

    // Check duplicate by name + month + week
    const byName = new Map();
    const byDateAndType = new Map();

    for (const t of tasks) {
      const cleanName = (t.name || '').toLowerCase().replace(/\s+#\d+/, '').trim();
      const m = t.monthNumber || 1;
      const w = t.weekNumber || 1;
      const type = t.taskType || '';
      const nameKey = `${m}_${w}_${cleanName}`;
      
      if (!byName.has(nameKey)) byName.set(nameKey, []);
      byName.get(nameKey).push(t);

      const d = String(t.dueDate || '').split('T')[0];
      if (d && type) {
        const dateKey = `${d}_${type}_${cleanName}`;
        if (!byDateAndType.has(dateKey)) byDateAndType.set(dateKey, []);
        byDateAndType.get(dateKey).push(t);
      }
    }

    const dupesByName = Array.from(byName.entries()).filter(([k, list]) => list.length > 1);
    if (dupesByName.length > 0) {
      console.log(`\n=== PROJECT: ${p.brandName || p.name} (${p.customId || p._id}) ===`);
      console.log(`Total tasks: ${tasks.length}, Duplicate name groups: ${dupesByName.length}`);
      dupesByName.forEach(([k, list]) => {
        console.log(`  Group [${k}]:`);
        list.forEach(t => {
          console.log(`    - ID: ${t._id}, customId: ${t.customId}, Name: "${t.name}", Status: ${t.status}, Due: ${t.dueDate}, Link: "${t.deliveryLink || ''}"`);
        });
      });
    }
  }

  await mongoose.disconnect();
}

detailedScan().catch(console.error);
