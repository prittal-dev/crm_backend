import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import { Task } from './src/models/Task.js';
import { Project } from './src/models/Project.js';

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const p = await Project.findOne({ brandName: /youngwheels/i });
  console.log('Project:', p.name, 'customId:', p.customId, '_id:', p._id);
  const tasks = await Task.find({ projectId: { $in: [p.customId, p._id.toString()] } });
  console.log('Total tasks count:', tasks.length);
  const byMonth = {};
  const byWeek = {};
  const byType = {};
  tasks.forEach(t => {
    byMonth[t.monthNumber] = (byMonth[t.monthNumber] || 0) + 1;
    byWeek[t.weekNumber] = (byWeek[t.weekNumber] || 0) + 1;
    byType[t.taskType] = (byType[t.taskType] || 0) + 1;
  });
  console.log('Types of monthNumber:');
  const typeSet = new Set(tasks.map(t => typeof t.monthNumber + ':' + t.monthNumber));
  console.log(Array.from(typeSet));
  const sampleJune = tasks.filter(t => t.dueDate && t.dueDate.includes('2026-06'));
  console.log('June tasks count:', sampleJune.length);
  sampleJune.forEach(t => console.log('June task:', t.customId, '|', t.name, '| m:', t.monthNumber, typeof t.monthNumber, '| w:', t.weekNumber, '| due:', t.dueDate));
  process.exit(0);
}
check();
