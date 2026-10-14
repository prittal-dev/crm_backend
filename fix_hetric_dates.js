import dns from 'dns';
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch {}
import mongoose from 'mongoose';
import 'dotenv/config';

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const db = mongoose.connection.db;
  await db.collection('salescontracts').updateOne(
    { customId: 'contract_14_hetricfootwe_split_1' },
    { $set: { dateOfSales: '01/07/2026', dateOfLogin: '02/07/2026', renewalDate: '01/08/2026', month: 'July' } }
  );
  await db.collection('salescontracts').updateOne(
    { customId: 'contract_14_hetricfootwe_split_2' },
    { $set: { dateOfSales: '01/08/2026', dateOfLogin: '01/08/2026', renewalDate: '01/09/2026', month: 'August' } }
  );
  await db.collection('salescontracts').updateOne(
    { customId: 'contract_14_hetricfootwe_split_3' },
    { $set: { dateOfSales: '01/09/2026', dateOfLogin: '01/09/2026', renewalDate: '01/10/2026', month: 'September' } }
  );
  console.log('Fixed Hetric Footwear exact renewal dates');
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
