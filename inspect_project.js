import mongoose from 'mongoose';

async function check() {
  await mongoose.connect('mongodb+srv://developmentprittal_db_user:nkYIoOAlkkBPGqXX@crm.xrqpczu.mongodb.net/prittal_crm?retryWrites=true&w=majority&appName=crm');
  const p = await mongoose.connection.db.collection('projects').findOne({ brandName: /youngwheels/i });
  console.log('Project:', JSON.stringify({
    id: p._id,
    customId: p.customId,
    brandName: p.brandName,
    startDate: p.startDate,
    handoverDate: p.handoverDate,
    renewalDate: p.renewalDate,
    deliverablesQuota: p.deliverablesQuota,
    deliveredCounts: p.deliveredCounts,
    progress: p.progress,
    dailyLogs: p.dailyLogs
  }, null, 2));

  const pIds = [p.customId, p._id.toString()].filter(Boolean);
  const tasks = await mongoose.connection.db.collection('tasks').find({ projectId: { $in: pIds } }).toArray();
  console.log('Total tasks:', tasks.length);
  const doneTasks = tasks.filter(t => t.status === 'done');
  console.log('Done tasks count:', doneTasks.length);
  doneTasks.forEach(t => console.log('Done task:', {
    name: t.name,
    monthNumber: t.monthNumber,
    weekNumber: t.weekNumber,
    dueDate: t.dueDate,
    completedDate: t.completedDate,
    taskType: t.taskType,
    assignedTo: t.assignedTo
  }));
  process.exit(0);
}

check().catch(console.error);
