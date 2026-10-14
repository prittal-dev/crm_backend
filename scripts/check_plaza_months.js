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
  console.log('Project:', p.brandName, 'customId:', p.customId, 'startDate:', p.startDate, 'handoverDate:', p.handoverDate);
  const tasks = await Task.find({ projectId: { $in: [p.customId, p._id.toString()] } }).lean();
  console.log('Total tasks in DB:', tasks.length);
  for (let m = 1; m <= 6; m++) {
    const mTasks = tasks.filter(t => Number(t.monthNumber) === m);
    console.log(`Month ${m} in DB: ${mTasks.length} tasks:`, mTasks.map(t => `${t.name} (w${t.weekNumber}, due:${t.dueDate}, status:${t.status})`));
  }
  process.exit(0);
}

main().catch(console.error);
