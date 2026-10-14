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
  const m1Tasks = await Task.find({
    projectId: { $in: pIds },
    monthNumber: 1
  }).lean();

  console.log('Detailed Month 1 tasks:');
  m1Tasks.forEach(t => {
    console.log({
      id: t.customId || t._id,
      name: t.name,
      monthNumber: t.monthNumber,
      weekNumber: t.weekNumber,
      dueDate: t.dueDate,
      status: t.status,
      completedDate: t.completedDate,
      deliveryLink: t.deliveryLink,
      createdAt: t.createdAt
    });
  });

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
