import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import { Project } from '../src/models/Project.js';
import { SalesContract } from '../src/models/SalesContract.js';
import { Task } from '../src/models/Task.js';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const p = await Project.findOne({ brandName: /plaza/i }).lean();
  console.log('Project:', {
    _id: p._id,
    customId: p.customId,
    name: p.name,
    brandName: p.brandName,
    startDate: p.startDate,
    handoverDate: p.handoverDate,
    renewalDate: p.renewalDate,
    nextRenewalDate: p.nextRenewalDate,
    planDuration: p.planDuration,
    services: p.services,
    soldPlanName: p.soldPlanName,
    deliverablesQuota: p.deliverablesQuota,
    content: p.content
  });

  const contracts = await SalesContract.find({
    $or: [{ projectId: p.customId }, { projectId: p._id.toString() }, { brandName: /plaza/i }]
  }).lean();
  console.log('Contracts count:', contracts.length);
  contracts.forEach(c => {
    console.log('Contract:', {
      _id: c._id,
      brandName: c.brandName,
      companyName: c.companyName,
      typeOfServices: c.typeOfServices,
      plan: c.plan,
      dateOfSales: c.dateOfSales,
      handoverDate: c.handoverDate,
      renewalDate: c.renewalDate,
      durationOfContract: c.durationOfContract,
      status: c.status
    });
  });

  process.exit(0);
}

main().catch(console.error);
