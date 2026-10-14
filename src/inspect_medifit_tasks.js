import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
dotenv.config();

import { Project } from './models/Project.js';
import { Task } from './models/Task.js';
import { generateDeliverablesForProjectBackend } from './utils/taskGenerator.js';

async function run() {
  const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/prittal_crm';
  await mongoose.connect(mongoURI);

  const p = await Project.findOne({ brandName: /medifit/i });
  console.log('Project:', p._id, p.customId, p.name, 'handover:', p.handoverDate, 'startDate:', p.startDate);

  const projIds = [p._id.toString(), p.customId].filter(Boolean);
  const tasksBefore = await Task.find({ projectId: { $in: projIds } });
  console.log(`--- TASKS BEFORE REGEN (${tasksBefore.length} tasks) ---`);
  tasksBefore.forEach(t => console.log(JSON.stringify({
    id: t._id,
    customId: t.customId,
    name: t.name,
    taskType: t.taskType,
    monthNumber: t.monthNumber,
    weekNumber: t.weekNumber,
    dueDate: t.dueDate,
    status: t.status
  }, null, 2)));

  // Regenerate with forceRegen = true to clear stale / mismatched tasks
  console.log('\n--- CALLING generateDeliverablesForProjectBackend(p, true) ---');
  const result = await generateDeliverablesForProjectBackend(p, true);
  console.log(`Generated/Updated ${result.length} tasks.`);

  const tasksAfter = await Task.find({ projectId: { $in: projIds } });
  console.log(`--- TASKS AFTER REGEN (${tasksAfter.length} tasks) ---`);
  tasksAfter.forEach(t => console.log(JSON.stringify({
    id: t._id,
    customId: t.customId,
    name: t.name,
    taskType: t.taskType,
    monthNumber: t.monthNumber,
    weekNumber: t.weekNumber,
    dueDate: t.dueDate,
    status: t.status
  }, null, 2)));

  await mongoose.disconnect();
}

run().catch(console.error);
