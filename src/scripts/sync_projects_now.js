import dotenv from 'dotenv';
dotenv.config();
import { connectDB } from '../config/db.js';
import SalesContract from '../models/SalesContract.js';
import { syncContractToLinkedEntities } from '../controllers/salesController.js';

async function runSync() {
  await connectDB();
  console.log('Starting full synchronization of SalesContracts to Projects...');
  const contracts = await SalesContract.find({ isDeleted: { $ne: true } });
  console.log(`Found ${contracts.length} active sales contracts.`);
  let synced = 0;
  for (const c of contracts) {
    await syncContractToLinkedEntities(c);
    synced++;
    console.log(`[${synced}/${contracts.length}] Synced contract: ${c.companyName} (${c.brandName || 'No Brand'})`);
  }
  console.log('SUCCESS: All contracts synced to projects properly!');
  process.exit(0);
}

runSync().catch(err => {
  console.error('Error during sync script:', err);
  process.exit(1);
});
