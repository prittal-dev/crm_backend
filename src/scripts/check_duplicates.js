import dotenv from 'dotenv';
dotenv.config();
import { connectDB } from '../config/db.js';
import SalesContract from '../models/SalesContract.js';
import { Project } from '../models/Project.js';
import { Client } from '../models/Client.js';

async function checkAll() {
  await connectDB();
  const projects = await Project.find({});
  console.log(`=== TOTAL PROJECTS: ${projects.length} ===`);
  projects.forEach((p, i) => {
    console.log(`[${i+1}] Project: '${p.name}' | Company: '${p.companyName}' | ID: ${p.customId} | Status: ${p.status} | Renewal: ${p.renewalDate}`);
  });

  const contracts = await SalesContract.find({ isDeleted: { $ne: true } });
  console.log(`\n=== TOTAL CONTRACTS: ${contracts.length} ===`);
  contracts.forEach((c, i) => {
    console.log(`[${i+1}] Contract: '${c.companyName}' | Brand: '${c.brandName}' | ID: ${c.customId} | SalesDate: ${c.dateOfSales} | RenewalDate: ${c.renewalDate} | Duration: ${c.durationOfContract} | Service: ${c.typeOfServices}`);
  });

  process.exit(0);
}

checkAll().catch(e => {
  console.error(e);
  process.exit(1);
});
