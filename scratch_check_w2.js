import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { Project } from './src/models/Project.js';
import { Task } from './src/models/Task.js';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const p = await Project.findOne({ brandName: /youngwheels/i }).lean();
  const pIds = [p.customId, p._id.toString()].filter(Boolean);
  
  // Find all tasks for youngwheels
  const allTasks = await Task.find({ projectId: { $in: pIds } }).lean();
  console.log(`Total youngwheels tasks: ${allTasks.length}`);

  // Find any task with weekNumber 2 across all months
  const w2Tasks = allTasks.filter(t => Number(t.weekNumber) === 2);
  console.log(`Total W2 tasks across all months: ${w2Tasks.length}`);
  w2Tasks.slice(0, 5).forEach(t => {
    console.log(`M${t.monthNumber}_W${t.weekNumber}: ${t.name} (Due: ${t.dueDate}, Status: ${t.status})`);
  });

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
