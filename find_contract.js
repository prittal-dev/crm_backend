import dns from 'dns';
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch {}
import mongoose from 'mongoose';
import 'dotenv/config';
import SalesContract from './src/models/SalesContract.js';

async function find() {
  await mongoose.connect(process.env.MONGODB_URI);
  const c = await SalesContract.findOne({
    $or: [
      { invoiceNumber: 'PRI26IN0028' },
      { renewalDate: '25/08/2027' }
    ]
  });
  console.log('Contract:', JSON.stringify(c, null, 2));
  process.exit(0);
}

find().catch(console.error);
