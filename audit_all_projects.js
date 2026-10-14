import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import { Project } from './src/models/Project.js';
import { SalesContract } from './src/models/SalesContract.js';
import { Task } from './src/models/Task.js';
import { syncProjectsWithSalesContracts } from './src/utils/sync_contracts_to_projects.js';

async function audit() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('--- RUNNING FULL SYNC FIRST ---');
  await syncProjectsWithSalesContracts();

  console.log('\n--- AUDITING ALL PROJECTS & TASKS ---');
  const projects = await Project.find({});
  console.log(`Found ${projects.length} total projects in DB.`);

  for (const p of projects) {
    const pId = p.customId || p._id.toString();
    const tasks = await Task.find({ projectId: { $in: [p.customId, p._id.toString()] } });
    const contracts = await SalesContract.find({
      $or: [
        { projectId: p.customId },
        { projectId: p._id.toString() },
        ...(p.clientId ? [{ clientId: p.clientId }] : [])
      ],
      isActive: { $ne: false },
      isDeleted: { $ne: true }
    });

    console.log(`\n[Project] "${p.brandName || p.name}" (${pId})`);
    console.log(`  Client: ${p.companyName || p.client}`);
    console.log(`  Services: [${(p.services || []).join(', ')}]`);
    console.log(`  SoldPlan: "${p.soldPlanName}"`);
    console.log(`  Contracts Linked: ${contracts.length} (${contracts.map(c => c.plan || c.typeOfServices).join(', ')})`);
    console.log(`  Total Tasks: ${tasks.length}`);

    if (tasks.length > 0) {
      const byMonth = {};
      const byStatus = {};
      tasks.forEach(t => {
        const m = t.monthNumber || 'unknown';
        byMonth[m] = (byMonth[m] || 0) + 1;
        byStatus[t.status || 'unknown'] = (byStatus[t.status || 'unknown'] || 0) + 1;
      });
      console.log(`  Tasks by Month:`, byMonth);
      console.log(`  Tasks by Status:`, byStatus);
    }
  }

  process.exit(0);
}

audit();
