import dotenv from 'dotenv';
dotenv.config();
import { connectDB } from '../config/db.js';
import SalesContract from '../models/SalesContract.js';
import { Project } from '../models/Project.js';
import { Client } from '../models/Client.js';
import { syncContractToLinkedEntities } from '../controllers/salesController.js';

function normalizeComp(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/bioscieces/g, 'biosciences')
    .replace(/ayodha/g, 'ayodhya')
    .replace(/pvt/g, '')
    .replace(/ltd/g, '')
    .trim();
}

async function fixAndSync() {
  await connectDB();
  console.log('--- Cleaning Duplicate Projects & Setting Website Renewal Dates ---');

  // 1. Fix PADMA CABLES renewal date to 1 year (23/06/2027)
  const padmaContracts = await SalesContract.find({ companyName: /padma/i });
  for (const c of padmaContracts) {
    c.renewalDate = '23/06/2027';
    c.durationOfContract = '1 year';
    await c.save();
    console.log('Updated PADMA contract renewal date to 23/06/2027');
  }

  // 2. Fix ELECTWELL ENGINEERS renewal date to 1 year (22/06/2027)
  const electContracts = await SalesContract.find({ companyName: /electwell/i });
  for (const c of electContracts) {
    c.renewalDate = '22/06/2027';
    c.durationOfContract = '1 year';
    await c.save();
    console.log('Updated ELECTWELL contract renewal date to 22/06/2027');
  }

  // 3. Deduplicate LYFENZO BIOSCIENCES projects
  const lyfProjects = await Project.find({ companyName: /lyfenzo/i });
  console.log(`Found ${lyfProjects.length} Lyfenzo projects.`);
  if (lyfProjects.length > 1) {
    // Keep the active contract-linked project and delete the duplicate legacy project
    const activeProject = lyfProjects.find(p => p.soldPlanName || p.status === 'active') || lyfProjects[1];
    const ghostProject = lyfProjects.find(p => p._id.toString() !== activeProject._id.toString());
    
    activeProject.companyName = 'LYFENZO BIOSCIENCES';
    activeProject.status = 'active';
    await activeProject.save();

    if (ghostProject) {
      await Project.deleteOne({ _id: ghostProject._id });
      console.log(`Deleted duplicate ghost Lyfenzo project: ${ghostProject._id} (${ghostProject.customId})`);
    }
  }

  // Also standardize Lyfenzo contract name
  await SalesContract.updateMany({ companyName: /lyfenzo/i }, { $set: { companyName: 'LYFENZO BIOSCIENCES' } });
  await Client.updateMany({ companyName: /lyfenzo/i }, { $set: { companyName: 'LYFENZO BIOSCIENCES', company: 'LYFENZO BIOSCIENCES' } });

  // 4. Deduplicate Ayodhya Surgical projects if any
  const ayoProjects = await Project.find({ companyName: /ayodh/i });
  console.log(`Found ${ayoProjects.length} Ayodhya projects.`);
  if (ayoProjects.length > 1) {
    const activeProject = ayoProjects.find(p => p.customId.startsWith('prj_')) || ayoProjects[1];
    const ghostProject = ayoProjects.find(p => p._id.toString() !== activeProject._id.toString());

    activeProject.companyName = 'Ayodha Surgicals';
    activeProject.status = 'active';
    await activeProject.save();

    if (ghostProject) {
      await Project.deleteOne({ _id: ghostProject._id });
      console.log(`Deleted duplicate ghost Ayodhya project: ${ghostProject._id} (${ghostProject.customId})`);
    }
  }

  // 5. Run full sync for all contracts
  const allContracts = await SalesContract.find({ isDeleted: { $ne: true } });
  for (const c of allContracts) {
    await syncContractToLinkedEntities(c);
  }

  console.log('=== SYNC & DEDUPLICATION COMPLETE ===');
  process.exit(0);
}

fixAndSync().catch(err => {
  console.error('Error fixing projects:', err);
  process.exit(1);
});
