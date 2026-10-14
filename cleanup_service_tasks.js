import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}
dotenv.config();

import { Task } from './src/models/Task.js';
import { Project } from './src/models/Project.js';
import { generateDeliverablesForProjectBackend } from './src/utils/taskGenerator.js';

async function cleanup() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // 1. Delete all non-creative, non-reel, non-festival tasks
  const deleteResult = await Task.deleteMany({
    $or: [
      { taskType: { $nin: ['creative', 'reel', 'festival', 'carousel'] } },
      { name: /audience\s*targeting/i },
      { name: /ad\s*creatives\s*&\s*copywriting/i },
      { name: /campaign\s*launch/i },
      { name: /weekly\s*ad\s*optimization/i }
    ]
  });
  console.log(`Deleted ${deleteResult.deletedCount} non-deliverable / service tasks.`);

  // 2. Regenerate & verify Young Wheels deliverables
  const yw = await Project.findOne({ name: /young\s*wheels/i });
  if (yw) {
    console.log(`Regenerating deliverables for Young Wheels (${yw.customId || yw._id})...`);
    const deliverables = await generateDeliverablesForProjectBackend(yw, true);
    console.log(`Young Wheels now has ${deliverables.length} total deliverables.`);
    const remainingTypes = {};
    for (const d of deliverables) {
      remainingTypes[d.taskType] = (remainingTypes[d.taskType] || 0) + 1;
    }
    console.log('Young Wheels deliverables by type:', remainingTypes);
  }

  // 3. Check overall tasks in database by taskType
  const allCounts = await Task.aggregate([
    { $group: { _id: '$taskType', count: { $sum: 1 } } }
  ]);
  console.log('All remaining task types in database:', allCounts);

  await mongoose.disconnect();
  console.log('Done!');
}

cleanup().catch(err => {
  console.error('Cleanup error:', err);
  process.exit(1);
});
