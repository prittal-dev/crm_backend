import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}
dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Task = mongoose.model('Task', new mongoose.Schema({}, { strict: false }));

  const tasks = await Task.find({
    $or: [
      { taskType: { $nin: ['creative', 'reel', 'festival'] } },
      { name: /audience\s*targeting/i },
      { name: /ad\s*creatives\s*&\s*copywriting/i },
      { name: /campaign\s*launch/i },
      { name: /weekly\s*ad\s*optimization/i }
    ]
  });
  console.log('Found matching tasks count:', tasks.length);
  tasks.forEach(t => console.log(t._id.toString(), '|', t.projectId, '|', t.taskType, '|', t.name));

  await mongoose.disconnect();
}

run().catch(console.error);
