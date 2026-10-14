import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
dotenv.config();

import { Project } from './src/models/Project.js';
import { Task } from './src/models/Task.js';

async function scanDuplicates() {
  const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/prittal_crm';
  await mongoose.connect(mongoURI);

  const projects = await Project.find({}).lean();
  console.log(`Scanning ${projects.length} projects for duplicate tasks...\n`);

  let totalDuplicateTasks = 0;
  const projectDupes = [];

  for (const p of projects) {
    const pIds = [p.customId, p._id?.toString()].filter(Boolean);
    const tasks = await Task.find({ projectId: { $in: pIds } }).lean();
    if (!tasks || tasks.length === 0) continue;

    const taskGroups = new Map();

    for (const t of tasks) {
      const cleanName = (t.name || '').toLowerCase().trim();
      const m = t.monthNumber || 1;
      const w = t.weekNumber || 1;
      const type = t.taskType || '';
      
      const key = `${m}_${w}_${type}_${cleanName}`;
      if (!taskGroups.has(key)) {
        taskGroups.set(key, []);
      }
      taskGroups.get(key).push(t);
    }

    const duplicatesInProject = [];
    for (const [k, group] of taskGroups.entries()) {
      if (group.length > 1) {
        duplicatesInProject.push({ key: k, tasks: group });
        totalDuplicateTasks += (group.length - 1);
      }
    }

    if (duplicatesInProject.length > 0) {
      projectDupes.push({
        projectName: p.brandName || p.name || p.customId,
        projectId: p.customId || p._id,
        dupeGroups: duplicatesInProject
      });
    }
  }

  console.log(`=== SUMMARY: FOUND ${totalDuplicateTasks} DUPLICATE TASKS ACROSS ${projectDupes.length} PROJECTS ===\n`);

  for (const pd of projectDupes) {
    console.log(`Project: ${pd.projectName} (${pd.projectId}) — ${pd.dupeGroups.length} duplicate sets:`);
    for (const dg of pd.dupeGroups) {
      console.log(`  - Set [${dg.key}] count: ${dg.tasks.length}`);
      dg.tasks.forEach(t => {
        console.log(`      * id: ${t._id}, customId: ${t.customId}, status: ${t.status}, due: ${t.dueDate}, link: "${t.deliveryLink || ''}", created: ${t.createdAt}`);
      });
    }
    console.log('');
  }

  await mongoose.disconnect();
}

scanDuplicates().catch(console.error);
