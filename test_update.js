import dns from 'dns';
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch {}
import mongoose from 'mongoose';
import 'dotenv/config';
import SalesContract from './src/models/SalesContract.js';

const findByIdOrCustomId = (id) => {
  if (mongoose.isValidObjectId(id)) {
    return { $or: [{ _id: id }, { customId: id }] };
  }
  return { customId: id };
};

async function testUpdate() {
  await mongoose.connect(process.env.MONGODB_URI);
  const id = '6aa399295a5c1215a3809bbc';
  console.log('Query:', findByIdOrCustomId(id));
  const doc = await SalesContract.findOne(findByIdOrCustomId(id));
  console.log('Found doc by query?', !!doc);

  const updates = {
    fullContractValue: 27500,
    amountReleasedWithGst: 32450,
    amountReleasedWithoutGst: 27500,
    amountReleasedAfterTds: 32450,
    tds: '0%',
    tdsPercent: 0,
    tdsAmount: 0,
    totalPayable: 32450,
    paymentType: 'Full',
    balancePayment: 0,
    invoiceNumber: 'PRI26IN0028',
    paymentMode: 'Bank Transfer (NEFT)',
    modeOfPayment: 'Bank Transfer (NEFT)',
    gstPercent: 18,
    gstAmount: 4950
  };

  const updated = await SalesContract.findOneAndUpdate(
    findByIdOrCustomId(id),
    { $set: updates },
    { new: true }
  );

  console.log('Updated result:', updated?.fullContractValue, updated?.amountReleasedWithGst);
  process.exit(0);
}

testUpdate().catch(console.error);
