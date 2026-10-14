require('dns').setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Contract = mongoose.model('SalesContract', new mongoose.Schema({}, { strict: false }));
  const contracts = await Contract.find({ $or: [{ companyName: /micky/i }, { brandName: /micky/i }] }).lean();
  console.log('Micky Toys Contracts:', contracts.length);
  for (const c of contracts) {
    console.log(c.customId, '|', c.companyName, '|', c.brandName, '|', c.typeOfServices, '|', c.plan, '|', c.contractType, '| dateOfSales:', c.dateOfSales, '| renewalDate:', c.renewalDate, '| autoRenewalConfig:', c.autoRenewalConfig);
  }
  process.exit(0);
}

main().catch(console.error);
