import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { Project } from './src/models/Project.js';
import { SalesContract } from './src/models/SalesContract.js';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const p = await Project.findOne({ brandName: /youngwheels/i }).lean();
  const contracts = await SalesContract.find({
    $or: [
      { client: /youngwheels/i },
      { company: /youngwheels/i },
      { companyName: /youngwheels/i },
      { projectId: p.customId },
      { projectId: p._id.toString() }
    ]
  }).lean();

  console.log('Contracts for youngwheels:');
  contracts.forEach(c => {
    console.log({
      id: c.customId || c._id,
      dateOfSales: c.dateOfSales,
      salesDate: c.salesDate,
      renewalDate: c.renewalDate,
      renewalFromDate: c.renewalFromDate,
      duration: c.durationOfContract || c.contractDuration,
      services: c.services || c.typeOfServices
    });
  });

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
