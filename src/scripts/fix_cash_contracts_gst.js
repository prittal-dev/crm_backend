import dns from 'dns';
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch {}
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { SalesContract } from '../models/SalesContract.js';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // Find all contracts where modeOfPayment is cash/m-cash/p-cash/m-upi and has no GSTIN
  const contracts = await SalesContract.find({
    isDeleted: { $ne: true }
  });

  console.log(`Checking ${contracts.length} contracts...`);
  let fixedCount = 0;

  for (const c of contracts) {
    const payMode = String(c.modeOfPayment || '').toLowerCase();
    const isCashLike = (payMode.includes('cash') || payMode.includes('m-upi')) && !payMode.includes('gst');
    const hasGstin = Boolean(c.gstNumber && String(c.gstNumber).trim().length >= 15 && String(c.gstNumber).trim().toUpperCase() !== 'NA');
    const hasExplicitGst = c.hasGst === true;

    if (isCashLike && !hasGstin && !hasExplicitGst) {
      let needsFix = false;

      // If gstPercent > 0 or gstAmount > 0 or amountReleasedWithoutGst < amountReleasedWithGst
      if (c.gstPercent !== 0 || c.gstAmount !== 0 || (c.amountReleasedWithGst > 0 && c.amountReleasedWithoutGst !== c.amountReleasedWithGst)) {
        needsFix = true;
      }

      if (needsFix) {
        console.log(`Fixing contract ${c.customId} (${c.invoiceNumber}) - ${c.companyName}:`);
        console.log(`  Prev: fullVal=${c.fullContractValue}, gst%=${c.gstPercent}, gstAmt=${c.gstAmount}, totPay=${c.totalPayable}, relWithGst=${c.amountReleasedWithGst}, relWithoutGst=${c.amountReleasedWithoutGst}, bal=${c.balancePayment}`);

        const baseVal = Number(c.fullContractValue || c.saleAmount || 0);
        const tdsVal = Number(c.tdsAmount || 0);
        const totPay = Math.max(0, baseVal - tdsVal);
        const rel = Number(c.amountReleasedWithGst || 0);
        const bal = Math.max(0, totPay - rel);

        c.gstPercent = 0;
        c.gstAmount = 0;
        c.totalPayable = totPay;
        c.amountReleasedWithoutGst = rel;
        c.balancePayment = bal;
        c.paymentType = bal === 0 ? 'Full' : 'Partial';

        await c.save();

        console.log(`  Fixed: fullVal=${c.fullContractValue}, gst%=0, gstAmt=0, totPay=${c.totalPayable}, relWithGst=${c.amountReleasedWithGst}, relWithoutGst=${c.amountReleasedWithoutGst}, bal=${c.balancePayment}`);
        fixedCount++;
      }
    }
  }

  console.log(`Migration complete. Fixed ${fixedCount} contracts.`);
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
