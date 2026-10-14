import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import mongoose from 'mongoose';

async function main() {
  await mongoose.connect('mongodb+srv://developmentprittal_db_user:nkYIoOAlkkBPGqXX@crm.xrqpczu.mongodb.net/prittal_crm?retryWrites=true&w=majority&appName=crm');
  const project = await mongoose.connection.db.collection('projects').findOne({ brandName: /youngwheels/i });
  console.log('Project:', {
    _id: project._id,
    brandName: project.brandName,
    deliverablesQuota: project.deliverablesQuota,
    deliveredCounts: project.deliveredCounts,
    progress: project.progress
  });

  const pIds = [project.customId, project._id.toString()].filter(Boolean);
  const tasks = await mongoose.connection.db.collection('tasks').find({ projectId: { $in: pIds } }).toArray();
  console.log('Total tasks in DB:', tasks.length);
  const m5Tasks = tasks.filter(t => (t.dueDate && t.dueDate.startsWith('2026-09')) || t.monthNumber === 5);
  console.log('Month 5 tasks:', m5Tasks.map(t => ({ customId: t.customId, name: t.name, status: t.status, taskType: t.taskType, dueDate: t.dueDate })));

  const septLogs = (project.dailyLogs || []).filter(l => l.date && l.date.startsWith('2026-09'));
  console.log('September logs:', septLogs);

  // Recalculate progress
  const postedLogs = (project.dailyLogs || []).filter(l => l.status && !l.status.toUpperCase().includes('PENDING') && !l.status.toUpperCase().includes('HOLIDAY') && !l.status.toUpperCase().includes('OFF'));
  const creativesCount = postedLogs.filter(l => (l.postType === 'creative' || (l.status && l.status.toUpperCase().includes('CREATIVE') && !l.status.toUpperCase().includes('FESTIVAL'))) && l.postType !== 'festival').length;
  const reelsCount = postedLogs.filter(l => l.postType === 'reel' || (l.status && l.status.toUpperCase().includes('REEL'))).length;
  const festivalsCount = postedLogs.filter(l => l.postType === 'festival' || (l.status && l.status.toUpperCase().includes('FESTIVAL'))).length;
  const blogsCount = postedLogs.filter(l => l.postType === 'blog' || (l.status && l.status.toUpperCase().includes('BLOG'))).length;

  const deliveredCounts = {
    creatives: creativesCount,
    reels: reelsCount,
    festivals: festivalsCount,
    blogs: blogsCount
  };

  const festivalTarget = project.deliverablesQuota?.festival ? Math.max(1, festivalsCount) : 0;
  const blogsTarget = Number(project.deliverablesQuota?.blogs || 0);
  const totalTarget = (Number(project.deliverablesQuota?.creatives) || 0) + (Number(project.deliverablesQuota?.aiReels) || 0) + festivalTarget + blogsTarget;
  const totalDelivered = creativesCount + reelsCount + festivalsCount + blogsCount;
  const progress = totalTarget > 0 ? Math.min(100, Math.round((totalDelivered / totalTarget) * 100)) : 0;

  await mongoose.connection.db.collection('projects').updateOne(
    { _id: project._id },
    { $set: { deliveredCounts, progress } }
  );
  console.log('Updated project progress to:', progress, 'deliveredCounts:', deliveredCounts);

  process.exit(0);
}

main().catch(console.error);
