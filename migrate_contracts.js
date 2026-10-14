import 'dotenv/config';
import mongoose from 'mongoose';
import dns from 'dns';

// Bypass Atlas DNS issues in this env
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch {}

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/prittal_crm';

const salesContractSchema = new mongoose.Schema({}, { strict: false });
const SalesContract = mongoose.model('SalesContract', salesContractSchema, 'salescontracts');

async function run() {
  try {
    await mongoose.connect(uri);
    console.log('Connected to DB');

    // Find all Quarterly and Half Yearly contracts
    const contractsToSplit = await SalesContract.find({
      $or: [
        { paymentCycle: { $regex: /quarter/i } },
        { paymentCycle: { $regex: /half/i } },
        { paymentCycle: { $regex: /6/i } },
        { contractType: { $regex: /quarter/i } },
        { contractType: { $regex: /half/i } }
      ]
    });

    console.log(`Found ${contractsToSplit.length} contracts to split.`);

    for (const sc of contractsToSplit) {
      const originalDoc = sc.toObject();
      const pCycle = String(originalDoc.paymentCycle || '').toUpperCase();
      const cType = String(originalDoc.contractType || '').toUpperCase();
      
      const isQuarterly = pCycle.includes('QUARTER') || cType.includes('QUARTER');
      const isHalfYearly = pCycle.includes('HALF') || pCycle.includes('6') || cType.includes('HALF');

      let slices = 1;
      if (isQuarterly) slices = 3;
      else if (isHalfYearly) slices = 6;

      if (slices <= 1) continue;

      console.log(`Splitting Contract ${originalDoc.customId} into ${slices} slices...`);
      
      const fcv = (Number(originalDoc.fullContractValue) || 0) / slices;
      const amtwGst = (Number(originalDoc.amountReleasedWithGst) || 0) / slices;
      const amtWoGst = (Number(originalDoc.amountReleasedWithoutGst) || 0) / slices;
      const amtAftTds = (Number(originalDoc.amountReleasedAfterTds) || 0) / slices;
      const balPay = (Number(originalDoc.balancePayment) || 0) / slices;
      const planPr = (Number(originalDoc.planPrice) || 0) / slices;

      let baseDateStr = originalDoc.dateOfSales || originalDoc.dateOfLogin || new Date().toISOString().split('T')[0];
      
      let baseDate;
      if (baseDateStr.includes('/')) {
        const parts = baseDateStr.split('/');
        if (parts[0].length === 2 && parts[2].length === 4) {
          // dd/mm/yyyy
          baseDateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
      }
      baseDate = new Date(baseDateStr);
      if (isNaN(baseDate.getTime())) {
        baseDate = new Date();
      }

      // Create new slices
      for (let i = 0; i < slices; i++) {
        const sliceDoc = { ...originalDoc };
        delete sliceDoc._id; // Ensure new ID is generated

        const sliceDate = new Date(baseDate);
        sliceDate.setMonth(sliceDate.getMonth() + i);
        const sliceDateStr = sliceDate.toISOString().split('T')[0];
        
        sliceDoc.customId = `${originalDoc.customId}_split_${i+1}`;
        sliceDoc.srNo = originalDoc.srNo; // Keep srNo or generate new? Keep it same so it groups together
        sliceDoc.month = sliceDate.toLocaleString('default', { month: 'long' });
        sliceDoc.year = sliceDate.getFullYear();
        sliceDoc.dateOfSales = sliceDateStr;
        sliceDoc.dateOfLogin = sliceDateStr;

        sliceDoc.fullContractValue = fcv;
        sliceDoc.amountReleasedWithGst = amtwGst;
        sliceDoc.amountReleasedWithoutGst = amtWoGst;
        sliceDoc.amountReleasedAfterTds = amtAftTds;
        sliceDoc.balancePayment = balPay;
        sliceDoc.planPrice = planPr;
        sliceDoc.paymentCycle = 'Monthly';
        
        if (i === 0) {
          sliceDoc.contractType = 'NEW';
        } else {
          sliceDoc.contractType = 'RENEWAL';
          sliceDoc.paymentRefNo = ''; // Subsequent payments aren't received yet
          // Keep amountReleased as 0 for renewals? The user said "with the price equally for monthly so that the total grand doesnt change". We divided the paid amount as well to keep the accounting balanced, but ideally renewals should be marked unpaid. I will divide amount paid for now as per instructions.
        }

        // Renewal date for THIS contract slice
        const nextRenDate = new Date(sliceDate);
        nextRenDate.setMonth(nextRenDate.getMonth() + 1);
        sliceDoc.renewalDate = nextRenDate.toISOString().split('T')[0];

        await SalesContract.create(sliceDoc);
      }

      // Delete the original contract
      await SalesContract.deleteOne({ _id: sc._id });
      console.log(`Successfully split and deleted original ${originalDoc.customId}`);
    }

    console.log('Migration complete.');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
