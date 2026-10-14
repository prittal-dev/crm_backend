import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
dotenv.config();

import { Project } from './models/Project.js';
import { Task } from './models/Task.js';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/prittal_crm');
  const p = await Project.findOne({ name: /micky/i });
  console.log('--- MICKY TOYS PROJECT ---');
  console.log('ID:', p._id, 'customId:', p.customId, 'handover:', p.handoverDate, 'startDate:', p.startDate, 'renewal:', p.renewalDate, 'nextRenewal:', p.nextRenewalDate);
  console.log('deliverablesQuota:', p.deliverablesQuota);
  console.log('content:', p.content);

  const projIds = [p._id.toString(), p.customId].filter(Boolean);
  const tasks = await Task.find({ projectId: { $in: projIds } }).sort({ monthNumber: 1, weekNumber: 1, dueDate: 1 });
  console.log(`\n--- ALL MICKY TOYS TASKS (${tasks.length} total) ---`);
  tasks.forEach(t => console.log(JSON.stringify({
    id: t._id,
    customId: t.customId,
    name: t.name,
    taskType: t.taskType,
    monthNumber: t.monthNumber,
    weekNumber: t.weekNumber,
    dueDate: t.dueDate,
    assignedTo: t.assignedTo,
    assignedToId: t.assignedToId,
    status: t.status
  }, null, 2)));

  await mongoose.disconnect();
}

run().catch(console.error);
