import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { SalesContract } from './src/models/SalesContract.js';
import { Project } from './src/models/Project.js';
import { Task } from './src/models/Task.js';
import { generateDeliverablesForProjectBackend } from './src/utils/taskGenerator.js';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  // 1. Find contracts
  const baseContract = await SalesContract.findOne({ customId: 'contract_33_mickytoys' });
  const renewalContract = await SalesContract.findOne({ customId: 'sc_b64tbu7' });

  if (baseContract && renewalContract) {
    renewalContract.contractType = 'RENEWAL';
    renewalContract.renewalFromDate = '2026-09-14';
    renewalContract.renewalDate = '2026-10-14';
    renewalContract.durationOfContract = '1 month';
    renewalContract.autoRenewalConfig = {
      active: false,
      parentContractId: baseContract._id.toString()
    };
    await renewalContract.save();
    console.log('✅ Updated sc_b64tbu7 to RENEWAL linked to contract_33_mickytoys');
  }

  // 2. Find Micky Toys project
  const project = await Project.findOne({ brandName: /micky/i });
  if (project) {
    project.renewalDate = '2026-09-14';
    project.nextRenewalDate = '2026-10-14';
    project.renewalStatus = 'RENEWED';
    project.status = 'active';
    await project.save();
    console.log('✅ Updated project to RENEWED, renewalDate: 2026-09-14, nextRenewalDate: 2026-10-14');

    // 3. Run task generator
    const tasks = await generateDeliverablesForProjectBackend(project, false, project.handoverDate || '2026-08-12');
    console.log(`✅ Deliverables generated count: ${tasks.length}`);
    const allTasks = await Task.find({ projectId: { $in: [project.customId, project._id.toString()] } }).lean();
    console.log(`Total tasks in DB for Micky Toys: ${allTasks.length}`);
    allTasks.forEach(t => console.log('  Task:', t.name, '|', t.dueDate, '| status:', t.status, '| m:', t.monthNumber, 'w:', t.weekNumber));
  }

  process.exit(0);
}

main().catch(console.error);
