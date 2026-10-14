import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import { Project } from '../src/models/Project.js';
import { Task } from '../src/models/Task.js';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const p = await Project.findOne({ brandName: /Kids Care/i }).lean();
  console.log('Project:', p.brandName, 'customId:', p.customId, '_id:', p._id);
  const tasks = await Task.find({ projectId: { $in: [p.customId, p._id.toString()] } }).lean();
  console.log('Total tasks for Kids Care:', tasks.length);
  tasks.slice(0, 15).forEach(t => {
    console.log(`id: ${t.customId} | projId: ${t.projectId} | m: ${t.monthNumber} (${typeof t.monthNumber}) | w: ${t.weekNumber} (${typeof t.weekNumber}) | name: "${t.name}" | type: ${t.taskType}`);
  });
  process.exit(0);
}

main().catch(console.error);
