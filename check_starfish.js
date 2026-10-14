import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { Task } from './src/models/Task.js';
import { Project } from './src/models/Project.js';

async function check() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://developer:developer@cluster0.p7whi.mongodb.net/cts_crm?retryWrites=true&w=majority');
  const projects = await Project.find({ name: /STAR/i });
  console.log('Projects:', projects.map(p => ({ customId: p.customId, _id: p._id, name: p.name, brandName: p.brandName, handoverDate: p.handoverDate, createdAt: p.createdAt })));
  
  if (projects.length > 0) {
    const p = projects[0];
    const pIds = [p.customId, String(p._id)];
    const tasks = await Task.find({ projectId: { $in: pIds } });
    console.log('Tasks for project (' + tasks.length + '):');
    tasks.forEach(t => console.log({ id: t.customId, _id: t._id, name: t.name, dueDate: t.dueDate, weekNumber: t.weekNumber, monthNumber: t.monthNumber, status: t.status, isCustomMoved: t.isCustomMoved }));
  }
  process.exit(0);
}
check().catch(console.error);
