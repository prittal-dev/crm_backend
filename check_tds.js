import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch {}
dotenv.config();
const contractSchema = new mongoose.Schema({}, { strict: false, collection: 'salescontracts' });
const Contract = mongoose.model('SalesContract', contractSchema);
async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const tdsContracts = await Contract.find({ amountReleasedAfterTds: { $exists: true, $ne: null, $gt: 0 } }).limit(5).lean();
  console.log(JSON.stringify(tdsContracts.map(c => ({
    val: c.fullContractValue, 
    withGst: c.amountReleasedWithGst, 
    withoutGst: c.amountReleasedWithoutGst, 
    afterTds: c.amountReleasedAfterTds, 
    tds: c.tds
  })), null, 2));
  process.exit(0);
}
run();
