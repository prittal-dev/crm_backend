import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
dotenv.config();

import { Task } from './models/Task.js';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/prittal_crm');
  const t = await Task.findById('6aab971a5bcfbdd594eae766');
  console.log('Task Details:', JSON.stringify(t, null, 2));
  await mongoose.disconnect();
}

run().catch(console.error);
