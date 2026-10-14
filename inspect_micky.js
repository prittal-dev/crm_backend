import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const mongoUri = process.env.MONGODB_URI;

await mongoose.connect(mongoUri);
const db = mongoose.connection.db;

const contracts = await db.collection('salescontracts').find({
  $or: [
    { customId: 'DL-2026-0003' },
    { companyName: /Micky/i },
    { brandName: /Micky/i }
  ]
}).toArray();

console.log('CONTRACTS FOUND:', JSON.stringify(contracts.map(c => ({
  customId: c.customId,
  companyName: c.companyName,
  brandName: c.brandName,
  dateOfSales: c.dateOfSales,
  renewalFromDate: c.renewalFromDate,
  renewalDate: c.renewalDate,
  nextRenewalDate: c.nextRenewalDate,
  createdAt: c.createdAt
})), null, 2));

const projects = await db.collection('projects').find({
  $or: [
    { customId: 'DL-2026-0003' },
    { name: /Micky/i },
    { brandName: /Micky/i }
  ]
}).toArray();

console.log('PROJECTS FOUND:', JSON.stringify(projects.map(p => ({
  customId: p.customId,
  name: p.name,
  startDate: p.startDate,
  taskStartDate: p.taskStartDate,
  renewalDate: p.renewalDate,
  nextRenewalDate: p.nextRenewalDate
})), null, 2));

await mongoose.disconnect();
