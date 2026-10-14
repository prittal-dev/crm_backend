import dns from 'dns';
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch {}
import mongoose from 'mongoose';
import 'dotenv/config';

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const db = mongoose.connection.db;
  const docs = await db.collection('salescontracts').find({}).toArray();
  console.log(`Total contracts: ${docs.length}`);
  docs.forEach((d, i) => {
    console.log(`${i+1}. [${d.companyName}] month=${d.month} sales=${d.dateOfSales} login=${d.dateOfLogin} ren=${d.renewalDate}`);
  });
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
