import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
import mongoose from 'mongoose';
import { Project } from '../models/Project.js';
import { SalesContract } from '../models/SalesContract.js';

const escapeRegExp = (str) => String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function syncProjectsWithSalesContracts() {
  const projects = await Project.find({});
  const contracts = await SalesContract.find({ isDeleted: { $ne: true }, isActive: { $ne: false } });

  console.log(`Checking ${projects.length} projects against ${contracts.length} active sales contracts...`);

  let updatedCount = 0;

  for (const prj of projects) {
    const pComp = (prj.companyName || prj.client || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    const pBrand = (prj.brandName || prj.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

    const matchedContracts = contracts.filter(c => {
      if (c.projectId && (c.projectId === prj.customId || c.projectId === prj._id.toString())) return true;
      if (prj.clientId && c.clientId === prj.clientId) return true;
      const cComp = (c.companyName || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
      const cBrand = (c.brandName || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
      return (
        (pComp && cComp && (pComp.includes(cComp) || cComp.includes(pComp))) ||
        (pBrand && cBrand && (pBrand.includes(cBrand) || cBrand.includes(pBrand)))
      );
    });

    if (matchedContracts.length > 0) {
      // Ensure all matched contracts have the projectId set
      const pId = prj.customId || prj._id.toString();
      for (const c of matchedContracts) {
        if (!c.projectId || c.projectId !== pId) {
          await SalesContract.updateOne({ _id: c._id }, { $set: { projectId: pId } });
        }
      }

      const servicesSet = new Set(Array.isArray(prj.services) ? prj.services : [prj.services].filter(Boolean));
      const plansList = [];
      let totalValue = 0;

      // Sort contracts chronologically
      matchedContracts.sort((a, b) => {
        const da = new Date(a.dateOfSales || a.createdAt);
        const db = new Date(b.dateOfSales || b.createdAt);
        return da.getTime() - db.getTime();
      });

      matchedContracts.forEach(c => {
        if (c.typeOfServices) {
          servicesSet.add(c.typeOfServices.trim());
        }
        if (c.plan && !plansList.includes(c.plan.trim())) {
          plansList.push(c.plan.trim());
        } else if (c.typeOfServices && !plansList.includes(c.typeOfServices.trim())) {
          plansList.push(c.typeOfServices.trim());
        }
        totalValue += Number(c.fullContractValue || c.saleAmount || 0);
      });

      const updatedServices = Array.from(servicesSet);
      const updatedSoldPlanName = plansList.length > 0 ? plansList.join(' + ') : prj.soldPlanName;
      const latestContract = matchedContracts[matchedContracts.length - 1];

      const updates = {
        services: updatedServices,
        soldPlanName: updatedSoldPlanName
      };

      if (totalValue > 0) {
        updates.budget = `₹${totalValue.toLocaleString('en-IN')}`;
      }
      if (latestContract.renewalDate && (!prj.renewalDate || prj.renewalDate === 'N/A')) {
        updates.renewalDate = latestContract.renewalDate;
        updates.nextRenewalDate = latestContract.renewalDate;
      }

      await Project.updateOne({ _id: prj._id }, { $set: updates });
      updatedCount++;
      console.log(`Updated project "${prj.name || prj.brandName}": services = [${updatedServices.join(', ')}], plans = "${updatedSoldPlanName}"`);
    }
  }

  console.log(`Successfully synced ${updatedCount} projects with sales sheet contracts.`);
}

if (process.argv[1]?.includes('sync_contracts_to_projects')) {
  await mongoose.connect(process.env.MONGODB_URI);
  await syncProjectsWithSalesContracts();
  process.exit(0);
}
