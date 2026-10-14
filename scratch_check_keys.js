import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { Project } from './src/models/Project.js';
import { Task } from './src/models/Task.js';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const p = await Project.findOne({ brandName: /youngwheels/i }).lean();
  const pIds = [p.customId, p._id.toString()].filter(Boolean);
  
  const tasks = await Task.find({ projectId: { $in: pIds } }).lean();
  console.log('Project found:', p.name, 'Existing tasks count:', tasks.length);

  // Check what existingMap keys exist
  const existingMap = new Map();
  tasks.forEach(t => {
    const m = t.monthNumber || 1;
    const w = t.weekNumber || 1;
    const cleanName = (t.name || '').toLowerCase().trim();
    existingMap.set(`m${m}_w${w}_${cleanName}`, t);
    if (t.originalWeekNumber || t.originalMonthNumber) {
      const origM = t.originalMonthNumber || m;
      const origW = t.originalWeekNumber || w;
      existingMap.set(`m${origM}_w${origW}_${cleanName}`, t);
    }
  });

  console.log('Has m1_w1_creative: youngwheels?', Boolean(existingMap.get('m1_w1_creative: youngwheels')));
  console.log('Has m1_w2_creative: youngwheels?', Boolean(existingMap.get('m1_w2_creative: youngwheels')));
  console.log('Has m1_w3_creative: youngwheels?', Boolean(existingMap.get('m1_w3_creative: youngwheels')));
  console.log('Has m1_w4_creative: youngwheels?', Boolean(existingMap.get('m1_w4_creative: youngwheels')));

  if (existingMap.get('m1_w2_creative: youngwheels')) {
    const t = existingMap.get('m1_w2_creative: youngwheels');
    console.log('Matched M1_W2 task:', { id: t.id || t._id, name: t.name, m: t.monthNumber, w: t.weekNumber, origW: t.originalWeekNumber, origM: t.originalMonthNumber });
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
