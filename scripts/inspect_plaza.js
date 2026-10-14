import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import { Project } from '../src/models/Project.js';
import { Task } from '../src/models/Task.js';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const p = await Project.findOne({ brandName: /plaza/i }).lean();
  console.log('Project:', p.brandName, p.customId, p._id);
  const pIds = [p.customId, p._id.toString()];
  const tasks = await Task.find({ projectId: { $in: pIds } }).lean();
  console.log('Total tasks:', tasks.length);
  tasks.forEach(t => {
    console.log(`id: ${t.customId || t._id} | name: "${t.name}" | type: ${t.taskType} | m: ${t.monthNumber} | w: ${t.weekNumber} | due: ${t.dueDate} | status: ${t.status}`);
  });
  process.exit(0);
}

main().catch(console.error);
