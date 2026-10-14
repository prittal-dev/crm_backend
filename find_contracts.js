import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: 'e:/crm/backend/.env' });

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const contracts = await mongoose.connection.db.collection('salescontracts').find({
    companyName: /sharda/i
  }).toArray();
  console.log('SHARDA contracts count:', contracts.length);
  contracts.forEach((c, idx) => {
    console.log(`--- Contract #${idx + 1} ---`);
    console.log(JSON.stringify(c, null, 2));
  });
  process.exit(0);
}
run();
