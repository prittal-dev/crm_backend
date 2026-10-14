import cron from 'node-cron';
import SalesContract from '../models/SalesContract.js';

export const initRenewalCronJob = () => {
  // Run every day at 12:01 AM
  cron.schedule('1 0 * * *', async () => {
    console.log('[Cron] Checking for automated contract renewals...');
    try {
      const todayStr = getFormattedDate(new Date());

      const dueContracts = await SalesContract.find({
        'autoRenewalConfig.active': true,
        renewalDate: todayStr
      });

      if (!dueContracts || dueContracts.length === 0) {
        console.log(`[Cron] No automated renewals due for ${todayStr}.`);
        return;
      }

      console.log(`[Cron] Found ${dueContracts.length} automated renewals for ${todayStr}. Processing...`);

      for (const contract of dueContracts) {
        const config = contract.autoRenewalConfig;
        
        // Stop if max cycles reached
        if (config.currentCycle >= config.maxCycles) {
          contract.autoRenewalConfig.active = false;
          await contract.save();
          continue;
        }

        // Duplicate the contract for the next cycle
        const now = new Date();
        const maxDoc = await SalesContract.findOne({}).sort({ srNo: -1 }).select('srNo');
        const nextSrNo = (maxDoc?.srNo || 0) + 1;
        const customId = `SC-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${nextSrNo}`;

        const nextRenewalDateObj = new Date();
        nextRenewalDateObj.setMonth(nextRenewalDateObj.getMonth() + 1);
        const nextRenewalStr = `${String(nextRenewalDateObj.getDate()).padStart(2, '0')}/${String(nextRenewalDateObj.getMonth() + 1).padStart(2, '0')}/${nextRenewalDateObj.getFullYear()}`;

        const newContractData = contract.toObject();
        delete newContractData._id;
        delete newContractData.createdAt;
        delete newContractData.updatedAt;
        delete newContractData.__v;

        newContractData.customId = customId;
        newContractData.srNo = nextSrNo;
        newContractData.month = now.toLocaleString('en-US', { month: 'long' });
        newContractData.year = now.getFullYear();
        newContractData.dateOfSales = todayStr;
        newContractData.renewalDate = nextRenewalStr;

        newContractData.autoRenewalConfig = {
          active: true,
          originalDuration: config.originalDuration,
          maxCycles: config.maxCycles,
          currentCycle: config.currentCycle + 1,
          parentContractId: contract._id.toString()
        };

        await SalesContract.create(newContractData);
        
        // Disable auto-renewal on the old contract
        contract.autoRenewalConfig.active = false;
        await contract.save();
        
        console.log(`[Cron] Successfully created renewal contract ${customId} for original ${contract.customId}`);
      }
    } catch (error) {
      console.error('[Cron] Error processing renewals:', error);
    }
  });

  console.log('✅ Automated Renewal Service Initialized (node-cron)');
};

function getFormattedDate(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}
