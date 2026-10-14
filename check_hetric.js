import dns from 'dns';
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch {}
import mongoose from 'mongoose';
import 'dotenv/config';

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const db = mongoose.connection.db;
  const collections = ['salescontracts', 'invoices', 'projects', 'clients'];
  for (const col of collections) {
    const docs = await db.collection(col).find({
      $or: [
        { renewalDate: { $regex: /2026-06-07|2026-07-06|07\/06\/2026|06\/07\/2026/ } },
        { dateOfSales: { $regex: /2026-06-07|2026-07-06|07\/06\/2026|06\/07\/2026/ } }
      ]
    }).toArray();
    if (docs.length) {
      console.log(`--- ${col} ---`);
      docs.forEach(d => console.log(d.companyName || d.client || d.name, d.renewalDate, d.dateOfSales));
    }
  }
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
