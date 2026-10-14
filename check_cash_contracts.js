import dns from 'dns';
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch {}
import mongoose from 'mongoose';
import 'dotenv/config';

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const db = mongoose.connection.db;
  const docs = await db.collection('salescontracts').find({}).toArray();
  const modes = {};
  docs.forEach(d => {
    const m = d.modeOfPayment || d.paymentMode || 'None';
    modes[m] = (modes[m] || 0) + 1;
    if (String(m).toLowerCase().includes('cash')) {
      console.log(`Cash contract: [${d.companyName}] mode=${m} gstPercent=${d.gstPercent} val=${d.fullContractValue} relWithGst=${d.amountReleasedWithGst}`);
    }
  });
  console.log('Payment modes summary:', modes);
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
