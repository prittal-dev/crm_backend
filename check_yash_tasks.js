import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const allTasks = await db.collection('tasks').find({}).toArray();
  console.log('Total tasks in DB:', allTasks.length);
  const yashTasks = allTasks.filter(t => (t.assignedTo || '').toLowerCase().includes('yash'));
  console.log('Tasks assigned to yash:', yashTasks.length);
  yashTasks.forEach(t => console.log('Yash Task:', {
    name: t.name,
    projectId: t.projectId,
    dueDate: t.dueDate,
    status: t.status,
    monthNumber: t.monthNumber,
    weekNumber: t.weekNumber
  }));
  process.exit(0);
}
main();
