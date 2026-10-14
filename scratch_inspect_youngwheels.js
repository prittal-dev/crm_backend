import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { Project } from './src/models/Project.js';
import { Task } from './src/models/Task.js';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const p = await Project.findOne({
    $or: [{ name: /youngwheels/i }, { brandName: /youngwheels/i }, { companyName: /youngwheels/i }]
  }).lean();

  console.log('Project youngwheels:', {
    _id: p._id,
    customId: p.customId,
    name: p.name,
    brandName: p.brandName,
    handoverDate: p.handoverDate,
    startDate: p.startDate,
    renewalDate: p.renewalDate,
    nextRenewalDate: p.nextRenewalDate,
    planDuration: p.planDuration,
    deliverablesQuota: p.deliverablesQuota,
    content: p.content
  });

  const pIds = [p.customId, p._id.toString()].filter(Boolean);
  const tasks = await Task.find({ projectId: { $in: pIds } }).lean();
  console.log(`Total tasks for youngwheels in DB: ${tasks.length}`);

  // Group tasks by monthNumber and weekNumber
  const byMonthAndWeek = {};
  tasks.forEach(t => {
    const m = t.monthNumber || 'no_m';
    const w = t.weekNumber || 'no_w';
    const key = `M${m}_W${w}`;
    if (!byMonthAndWeek[key]) byMonthAndWeek[key] = [];
    byMonthAndWeek[key].push({
      name: t.name,
      dueDate: t.dueDate,
      status: t.status,
      customId: t.customId,
      id: t.id
    });
  });

  console.log('Task distribution by Month and Week:');
  Object.keys(byMonthAndWeek).sort().forEach(k => {
    console.log(`  ${k}: ${byMonthAndWeek[k].length} tasks (sample due: ${byMonthAndWeek[k][0]?.dueDate})`);
  });

  console.log('\nAll Month 1 tasks:');
  const m1Tasks = tasks.filter(t => Number(t.monthNumber) === 1 || t.dueDate?.startsWith('2026-06') || t.dueDate?.startsWith('2026-05'));
  m1Tasks.forEach(t => {
    console.log(`  - Name: "${t.name}" | M: ${t.monthNumber} | W: ${t.weekNumber} | Due: ${t.dueDate} | Status: ${t.status}`);
  });

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
