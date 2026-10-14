import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import { Project } from './src/models/Project.js';
import { Task } from './src/models/Task.js';
import { syncProjectsWithSalesContracts } from './src/utils/sync_contracts_to_projects.js';
import { realignAllProjectsDeliverables, deduplicateProjectTasksInDb } from './src/utils/deliverableHealer.js';

async function healAll() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('1. Syncing all projects with contracts...');
  await syncProjectsWithSalesContracts();

  console.log('2. Realigning deliverable dates and deduplicating for all projects...');
  const healRes = await realignAllProjectsDeliverables();
  console.log('Heal results:', JSON.stringify(healRes, null, 2));

  console.log('3. Checking tasks marked done without completedDate...');
  const doneTasksWithoutDate = await Task.find({
    status: { $in: ['done', 'completed', 'published'] },
    $or: [{ completedDate: { $exists: false } }, { completedDate: '' }, { completedDate: null }]
  });
  console.log(`Found ${doneTasksWithoutDate.length} done tasks without completedDate. Fixing...`);
  for (const t of doneTasksWithoutDate) {
    t.completedDate = t.dueDate || new Date().toISOString().split('T')[0];
    await t.save();
  }

  console.log('4. Checking youngwheels tasks specifically...');
  const p = await Project.findOne({ brandName: /youngwheels/i });
  const ywTasks = await Task.find({ projectId: { $in: [p.customId, p._id.toString()] } });
  console.log(`Youngwheels now has ${ywTasks.length} tasks.`);
  for (let m = 1; m <= 6; m++) {
    const mTasks = ywTasks.filter(t => t.monthNumber === m);
    const doneCount = mTasks.filter(t => ['done', 'completed', 'published'].includes(t.status) || t.deliveryLink).length;
    console.log(`  Month ${m}: Total ${mTasks.length} tasks (${doneCount} done, ${mTasks.length - doneCount} pending)`);
  }

  console.log('\nAll projects and tasks successfully repaired and synchronized!');
  process.exit(0);
}

healAll().catch(err => {
  console.error('Error during healAll:', err);
  process.exit(1);
});
