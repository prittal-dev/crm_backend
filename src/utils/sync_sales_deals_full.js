import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import dns from 'dns';
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch (e) {}

import { SalesContract } from '../models/SalesContract.js';
import { Deal } from '../models/Deal.js';
import { Client } from '../models/Client.js';
import { Project } from '../models/Project.js';
import { Payment } from '../models/Payment.js';
import { AuditLog } from '../models/AuditLog.js';
import { Plan } from '../models/Plan.js';
import { syncProjectsWithSalesContracts } from './sync_contracts_to_projects.js';

export function parseContractDate(dateStr, month, year) {
  if (!dateStr || dateStr === 'N/A' || dateStr === 'NA') {
    if (month && year) {
      const mIdx = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(
        month.toLowerCase().slice(0, 3)
      );
      if (mIdx !== -1) return new Date(year, mIdx, 1);
    }
    return new Date(2026, 0, 1);
  }
  const str = String(dateStr).trim();
  if (str.includes('/')) {
    const parts = str.split('/');
    if (parts.length === 3) {
      let d = parseInt(parts[0], 10);
      let m = parseInt(parts[1], 10) - 1;
      let y = parseInt(parts[2], 10);
      if (y < 100) y += 2000;
      if (y === 2016) y = 2026; // Fix Croslite Footwear year typo in sheet
      return new Date(y, m, d, 10, 0, 0);
    }
  } else if (str.includes('-')) {
    const parts = str.split('-');
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 10, 0, 0);
      } else {
        return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10), 10, 0, 0);
      }
    }
  }
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? new Date(2026, 0, 1, 10, 0, 0) : parsed;
}

const normalize = (str) =>
  String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();

function mapPaymentMode(mode) {
  const m = String(mode || '').toUpperCase().trim();
  if (m.includes('UPI')) return 'UPI';
  if (m.includes('CHEQUE') || m.includes('CHECK')) return 'Cheque';
  if (m.includes('NEFT') || m.includes('RTGS') || m.includes('IMPS') || m.includes('BANK')) return 'NEFT';
  if (m.includes('CASH')) return 'Cash';
  if (m.includes('RAZORPAY')) return 'Razorpay';
  return 'Other';
}

export function cleanPersonName(val) {
  if (!val) return 'Manish';
  let s = String(val).trim();
  s = s.replace(/man(?:eesh|ish)\s*sir/gi, 'Manish');
  s = s.replace(/maneesh/gi, 'Manish');
  if (s.toLowerCase() === 'manish') return 'Manish';
  return s;
}

export async function executeFullSalesSheetSync() {
  const contracts = await SalesContract.find({ isDeleted: { $ne: true } });
  const clients = await Client.find({ isDeleted: { $ne: true } });
  const projects = await Project.find({});
  const plans = await Plan.find({});

  console.log(`Executing full sync: ${contracts.length} active contracts, ${clients.length} clients, ${projects.length} projects.`);

  // 1. Sort contracts chronologically by dateOfSales
  const sorted = contracts
    .map((c) => {
      const d = parseContractDate(c.dateOfSales, c.month, c.year);
      return { contract: c, date: d };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Keep Prittal creative agency test deal at DL-2026-0046 if needed
  await Deal.updateOne(
    { dealCode: 'DL-2026-0001', clientName: { $regex: /prittal/i } },
    { $set: { dealCode: 'DL-2026-0046' } }
  );

  const syncedDeals = [];
  const clientRevenueMap = {};
  const clientServicesMap = {};
  const clientProjectsMap = {};

  for (let idx = 0; idx < sorted.length; idx++) {
    const { contract: c, date: salesDateObj } = sorted[idx];
    const dealSeq = String(idx + 1).padStart(4, '0');
    const dealCode = `DL-2026-${dealSeq}`;
    const isoDate = salesDateObj.toISOString().split('T')[0];
    const rawSalesDate = c.dateOfSales || isoDate;
    const sellerName = cleanPersonName(c.soldBy);

    // --- A. Match or Create Client ---
    const normCompany = normalize(c.companyName);
    const normBrand = normalize(c.brandName);

    let matchedClient = clients.find((cl) => {
      const clComp = normalize(cl.companyName || cl.company);
      const clGst = (cl.gstin || '').toUpperCase().trim();
      const rowGst = (c.gstNumber || '').toUpperCase().trim();
      return (
        (rowGst && clGst && rowGst === clGst) ||
        (normCompany && (clComp.includes(normCompany) || normCompany.includes(clComp)))
      );
    });

    if (!matchedClient && c.companyName) {
      const customClientId = `c_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 4)}`;
      matchedClient = await Client.create({
        customId: customClientId,
        companyName: c.companyName.trim(),
        company: c.companyName.trim(),
        brandName: c.brandName || '',
        contact: c.customerName || 'Primary Contact',
        phone: c.customerPhone || '',
        email: c.email || '',
        status: 'Customer',
        type: 'Company',
        industry: c.vertical || 'Digital Retainer',
        gstin: c.gstNumber || '',
        pan: c.tanNumber || '',
        contacts: [
          {
            name: c.customerName || 'Primary Contact',
            phone: c.customerPhone || '',
            email: c.email || '',
            roleTitle: 'Key Decision Maker',
            isPrimary: true
          }
        ],
        billingAddress: {
          street: c.companyAddress || '',
          city: c.branch || 'Rohini',
          state: '',
          postalCode: '',
          country: 'India'
        },
        ownerName: sellerName,
        createdAt: salesDateObj
      });
      clients.push(matchedClient);
    }

    const clientId = matchedClient ? matchedClient.customId || matchedClient._id.toString() : `c_unknown_${idx}`;
    const clientName = matchedClient ? matchedClient.companyName || matchedClient.company : c.companyName;

    // --- B. Match or Create Project ---
    let matchedProject = projects.find((p) => {
      if (c.projectId && (p.customId === c.projectId || p._id.toString() === c.projectId)) return true;
      const pComp = normalize(p.companyName || p.client);
      const pBrand = normalize(p.brandName || p.name);
      return (
        (normCompany && (pComp.includes(normCompany) || normCompany.includes(pComp))) ||
        (normBrand && (pBrand.includes(normBrand) || normBrand.includes(pBrand) || pComp.includes(normBrand)))
      );
    });

    const totalVal = Number(c.fullContractValue || c.amountReleasedWithGst || c.saleAmount || 10000);
    const paidVal = Number(c.amountReleasedWithGst || c.fullContractValue || c.saleAmount || 10000);
    const balVal = Number(c.balancePayment || Math.max(0, totalVal - paidVal));

    if (!matchedProject) {
      const customProjId = `proj_${Math.random().toString(36).substring(2, 9)}`;
      matchedProject = await Project.create({
        customId: customProjId,
        name: `${c.brandName || c.companyName} Project`,
        client: c.companyName,
        companyName: c.companyName,
        brandName: c.brandName || '',
        clientId: clientId,
        sourceDealId: dealCode,
        startDate: isoDate,
        deadline: c.renewalDate ? parseContractDate(c.renewalDate).toISOString().split('T')[0] : '',
        renewalDate: c.renewalDate || '',
        soldPlanName: c.plan || c.typeOfServices || 'Social Media Basic',
        budget: `₹${totalVal.toLocaleString('en-IN')}`,
        progress: 60,
        status: 'active',
        handoffStatus: 'In Production',
        accountManager: 'Tushar',
        finalRemarks: c.servicesBrief || c.remarks || '',
        createdAt: salesDateObj,
        activity: [
          {
            date: rawSalesDate,
            event: `Project onboarded from Sales Deal ${dealCode} (${c.plan || c.typeOfServices || 'Service'}). Sales: ${sellerName}.`
          }
        ]
      });
      projects.push(matchedProject);
    } else {
      // Update existing project linkage & add datewise activity log
      const existingPlans = (matchedProject.soldPlanName || '').split('+').map(p => p.trim()).filter(Boolean);
      const newPlan = (c.plan || c.typeOfServices || '').trim();
      if (newPlan && !existingPlans.includes(newPlan) && !existingPlans.some(ep => ep.toLowerCase() === newPlan.toLowerCase())) {
        existingPlans.push(newPlan);
      }
      const aggregatedPlanName = existingPlans.length > 0 ? existingPlans.join(' + ') : (newPlan || matchedProject.soldPlanName);

      const existingServices = new Set(Array.isArray(matchedProject.services) ? matchedProject.services : []);
      if (c.typeOfServices) existingServices.add(c.typeOfServices.trim());
      if (c.plan) existingServices.add(c.plan.trim());

      const updates = {
        sourceDealId: dealCode,
        clientId: clientId,
        budget: '',
        soldPlanName: aggregatedPlanName,
        services: Array.from(existingServices).filter(Boolean)
      };
      if (c.renewalDate && (!matchedProject.renewalDate || matchedProject.renewalDate === 'N/A')) {
        updates.renewalDate = c.renewalDate;
      }
      if (c.servicesBrief && !matchedProject.finalRemarks) {
        updates.finalRemarks = c.servicesBrief;
      }

      // Check if activity already logged for this dealCode
      const hasLog = (matchedProject.activity || []).some(
        (a) => a.event && a.event.includes(dealCode)
      );
      if (!hasLog) {
        if (!Array.isArray(matchedProject.activity)) matchedProject.activity = [];
        matchedProject.activity.unshift({
          date: rawSalesDate,
          event: `Sales Deal ${dealCode} linked (${c.plan || c.typeOfServices || 'Retainer'}). Date of Sale: ${rawSalesDate}.`
        });
        updates.activity = matchedProject.activity;
      }

      await Project.updateOne({ _id: matchedProject._id }, { $set: updates });
    }

    const projectId = matchedProject ? matchedProject.customId || matchedProject._id.toString() : null;

    // --- C. Match Plan Snapshot & Category ---
    const planText = String(c.plan || c.typeOfServices || 'Social Media Basic');
    const matchedPlan = plans.find((pl) => {
      const plName = normalize(pl.name);
      const pText = normalize(planText);
      return plName && (pText.includes(plName) || plName.includes(pText));
    }) || plans.find((pl) => pl.customId === 'PLN-SMO-001-M') || plans[0];

    const isRenewal =
      (c.contractType && c.contractType.toLowerCase().includes('renewal')) ||
      (c.customId && c.customId.includes('rnw')) ||
      c.srNo > 20 && c.typeOfServices === 'SMO';

    const dealTitle = `${c.plan || c.typeOfServices || 'Social Media Basic'} ${isRenewal ? 'Renewal' : 'Agreement'}`;
    const gstPercent = Number(c.gstPercent || 18);
    const subtotal = Math.round(totalVal / (1 + gstPercent / 100));
    const gstAmount = totalVal - subtotal;

    // --- D. Upsert Deal Datewise ---
    const dealCustomId = `d_${dealCode.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

    const dealActivity = [
      {
        action: 'Deal Created & Converted',
        actor: sellerName,
        from: 'Proposal Sent',
        to: 'Converted',
        time: salesDateObj,
        timestamp: salesDateObj,
        note: `Deal signed & converted from Sales Sheet (${c.invoiceNumber || c.customId}) on ${rawSalesDate}. Value: ₹${totalVal.toLocaleString('en-IN')}. Payment Mode: ${c.modeOfPayment || 'UPI'}.`
      }
    ];

    if (paidVal > 0) {
      dealActivity.push({
        action: 'Payment Received',
        actor: sellerName,
        from: 'Payment Pending',
        to: 'Paid',
        time: salesDateObj,
        timestamp: salesDateObj,
        note: `Payment of ₹${paidVal.toLocaleString('en-IN')} received via ${c.modeOfPayment || 'UPI'} (Ref: ${c.paymentRefNo || c.invoiceNumber || 'Sales Sheet'}).`
      });
    }

    const dealData = {
      customId: dealCustomId,
      dealCode: dealCode,
      clientId: clientId,
      clientName: clientName,
      title: dealTitle,
      ownerId: 'u_g58h21s',
      ownerName: sellerName,
      planId: matchedPlan?.customId || 'PLN-SMO-001-M',
      planSnapshot: {
        planId: matchedPlan?.customId || 'PLN-SMO-001-M',
        name: c.plan || matchedPlan?.name || 'Social Media Basic',
        category: matchedPlan?.category || 'Social Media',
        billingType: c.paymentCycle || 'Monthly',
        basePrice: subtotal,
        gstPercent: gstPercent,
        includes: matchedPlan?.includes || ['Meta Platforms (FB + IG)', 'Weekly Activities', 'Monthly Reports']
      },
      customLineItems: [
        {
          description: c.servicesBrief || `${c.plan || c.typeOfServices || 'Service'} Retainer Scope`,
          quantity: 1,
          unitPrice: subtotal,
          amount: subtotal
        }
      ],
      discountType: 'fixed',
      discountValue: 0,
      discountAmount: 0,
      subtotal: subtotal,
      gstPercent: gstPercent,
      gstAmount: gstAmount,
      total: totalVal,
      currency: 'INR',
      expectedCloseDate: isoDate,
      status: 'Converted',
      projectId: projectId,
      activity: dealActivity,
      createdAt: salesDateObj,
      updatedAt: salesDateObj
    };

    const savedDeal = await Deal.findOneAndUpdate(
      { dealCode: dealCode },
      { $set: dealData },
      { upsert: true, new: true }
    );
    syncedDeals.push(savedDeal);

    // --- E. Record Payment Datewise ---
    if (paidVal > 0) {
      const paymentCustomId = `pay_${dealCode.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      await Payment.findOneAndUpdate(
        { customId: paymentCustomId },
        {
          $set: {
            customId: paymentCustomId,
            dealId: savedDeal.customId || savedDeal._id.toString(),
            dealCode: dealCode,
            clientId: clientId,
            clientName: clientName,
            amount: paidVal,
            mode: mapPaymentMode(c.modeOfPayment),
            reference: c.paymentRefNo || c.invoiceNumber || `PAY-${dealCode}`,
            paidOn: isoDate,
            recordedBy: sellerName,
            recordedById: 'u_g58h21s',
            notes: c.remarks || `Payment recorded from Sales Sheet on ${rawSalesDate}`,
            createdAt: salesDateObj,
            updatedAt: salesDateObj
          }
        },
        { upsert: true, new: true }
      );
    }

    // --- F. Record AuditLog Datewise ---
    const auditCustomId = `audit_${dealCode.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    await AuditLog.findOneAndUpdate(
      { customId: auditCustomId },
      {
        $set: {
          customId: auditCustomId,
          action: 'Deal Converted & Project Initialized',
          category: 'Sales & Commercial',
          performedBy: sellerName,
          performedByRole: 'sales_admin',
          targetUser: clientName,
          targetUserId: clientId,
          details: `Deal ${dealCode} (${dealTitle}) converted for ${clientName} on ${rawSalesDate}. Total Value: ₹${totalVal.toLocaleString('en-IN')}. Linked Project: ${matchedProject.name}.`,
          timestamp: salesDateObj,
          createdAt: salesDateObj
        }
      },
      { upsert: true, new: true }
    );

    // --- G. Update SalesContract linkages ---
    await SalesContract.updateOne(
      { _id: c._id },
      {
        $set: {
          dealId: dealCode,
          projectId: projectId,
          clientId: clientId
        }
      }
    );

    // Accumulate Client aggregates
    clientRevenueMap[clientId] = (clientRevenueMap[clientId] || 0) + totalVal;
    if (!clientServicesMap[clientId]) clientServicesMap[clientId] = new Set();
    clientServicesMap[clientId].add(c.plan || c.typeOfServices || 'SMO');
    if (!clientProjectsMap[clientId]) clientProjectsMap[clientId] = new Set();
    if (matchedProject?.name) clientProjectsMap[clientId].add(matchedProject.name);
  }

  // --- H. Final Client Totals Update ---
  for (const client of clients) {
    const cId = client.customId || client._id.toString();
    const rev = clientRevenueMap[cId];
    if (rev !== undefined) {
      const svcs = Array.from(clientServicesMap[cId] || []).join(', ');
      const projs = Array.from(clientProjectsMap[cId] || []).join(', ');
      await Client.updateOne(
        { _id: client._id },
        {
          $set: {
            revenue: `₹${rev.toLocaleString('en-IN')}`,
            services: svcs,
            projects: projs,
            status: 'Active',
            paymentStatus: 'paid'
          }
        }
      );
    }
  }

  try {
    await syncProjectsWithSalesContracts();
  } catch (syncProjErr) {
    console.warn('[SyncDeals] Auto project sync notice:', syncProjErr.message);
  }

  console.log(`✅ Successfully synchronized ${syncedDeals.length} deals, projects, clients, and activity logs datewise!`);
  return {
    dealsCount: syncedDeals.length,
    projectsCount: projects.length,
    clientsCount: clients.length
  };
}

if (process.argv[1]?.endsWith('sync_sales_deals_full.js')) {
  (async () => {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      const res = await executeFullSalesSheetSync();
      console.log('Result:', res);
      await mongoose.disconnect();
      process.exit(0);
    } catch (err) {
      console.error('Sync failed:', err);
      process.exit(1);
    }
  })();
}
