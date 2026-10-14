import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
import mongoose from 'mongoose';
import { Project } from './src/models/Project.js';
import { Task } from './src/models/Task.js';
import { generateDeliverablesForProjectBackend } from './src/utils/taskGenerator.js';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const p = await Project.findOne({ brandName: /youngwheels/i });
  console.log(`Generating deliverables for project ${p.name} (services: ${JSON.stringify(p.services)})...`);

  const tasks = await generateDeliverablesForProjectBackend(p, true);
  console.log(`Generated/Retrieved ${tasks.length} tasks for youngwheels:`);

  const taskTypes = {};
  tasks.forEach(t => {
    taskTypes[t.taskType] = (taskTypes[t.taskType] || 0) + 1;
  });
  console.log('Task Types Breakdown:', taskTypes);

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
