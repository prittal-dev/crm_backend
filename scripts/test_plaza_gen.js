import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import { Project } from '../src/models/Project.js';
import { Task } from '../src/models/Task.js';
import { generateDeliverablesForProjectBackend } from '../src/utils/taskGenerator.js';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const p = await Project.findOne({ brandName: /plaza/i });
  console.log('Generating deliverables for Plaza clock...');
  const res = await generateDeliverablesForProjectBackend(p, false);
  console.log('Returned tasks count:', res.length);
  const byM = {};
  res.forEach(t => {
    byM[t.monthNumber] = (byM[t.monthNumber] || 0) + 1;
  });
  console.log('Tasks by month after generate:', byM);
  process.exit(0);
}

main().catch(console.error);
