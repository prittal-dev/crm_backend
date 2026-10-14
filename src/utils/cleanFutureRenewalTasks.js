import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { Project } from '../models/Project.js';
import { Task } from '../models/Task.js';

async function cleanup() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const projects = await Project.find({}).lean();
  let totalDeleted = 0;

  for (const p of projects) {
    const cutoff = p.nextRenewalDate || p.renewalDate;
    if (!cutoff) continue;

    const projIds = [p.customId, p._id.toString()].filter(Boolean);
    const deleteRes = await Task.deleteMany({
      projectId: { $in: projIds },
      dueDate: { $gt: cutoff },
      status: { $ne: 'done' }
    });

    if (deleteRes.deletedCount > 0) {
      console.log(`[Cleaned] Project: ${p.brandName || p.name} (${cutoff}) -> Deleted ${deleteRes.deletedCount} future tasks`);
      totalDeleted += deleteRes.deletedCount;
    }
  }

  console.log(`\nTotal unrenewed future tasks cleaned: ${totalDeleted}`);

  // Specifically check LYFENZO
  const lyf = await Project.findOne({ brandName: /lyfenzo/i }).lean();
  if (lyf) {
    const lyfCutoff = lyf.nextRenewalDate || lyf.renewalDate;
    const lyfIds = [lyf.customId, lyf._id.toString()].filter(Boolean);
    const remainingFuture = await Task.find({ projectId: { $in: lyfIds }, dueDate: { $gt: lyfCutoff } }).lean();
    console.log(`LYFENZO check: remaining tasks past ${lyfCutoff}: ${remainingFuture.length}`);
    const validTasks = await Task.find({ projectId: { $in: lyfIds } }).lean();
    console.log(`LYFENZO total valid tasks within contract cycle: ${validTasks.length}`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

cleanup().catch(err => {
  console.error('Error during cleanup:', err);
  process.exit(1);
});
