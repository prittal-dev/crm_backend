import mongoose from 'mongoose';
import { Lead } from '../models/Lead.js';
import { Client } from '../models/Client.js';
import { Plan } from '../models/Plan.js';
import { Deal } from '../models/Deal.js';
import { Payment } from '../models/Payment.js';
import { Project } from '../models/Project.js';
import { Task } from '../models/Task.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { TeamMember } from '../models/TeamMember.js';
import { Document } from '../models/Document.js';
import bcrypt from 'bcryptjs';
import { seedDefaultPlans, DEFAULT_PLANS } from '../utils/seedPlans.js';
import { sendPaymentAndPIDocumentEmail } from '../utils/emailService.js';
import { generateDocumentPdfBuffer } from '../utils/pdfGenerator.js';
import { broadcastRealtimeUpdate } from '../services/realtimeService.js';
import { generateDeliverablesForProjectBackend } from '../utils/taskGenerator.js';
import { SalesContract } from '../models/SalesContract.js';
import { Invoice } from '../models/Invoice.js';
import { syncSalesContractsFromExcel } from '../services/salesSheetService.js';
import { parseContractDate } from '../utils/sync_sales_deals_full.js';
import { scrapeGoogleMapsLeads, normalizePhone, normalizeCompanyName, generateSmartPitch, cleanText, analyzeWebsiteDetails } from '../services/leadScraperService.js';

export const normalizeToYMD = (val) => {
  if (!val) return '';
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const p = parseContractDate(s);
  if (p && !isNaN(p.getTime())) {
    const y = p.getFullYear();
    const m = String(p.getMonth() + 1).padStart(2, '0');
    const d = String(p.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return s;
};

export const normalizeToDDMMYYYY = (val) => {
  if (!val) return '';
  const s = String(val).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const p = parseContractDate(s);
  if (p && !isNaN(p.getTime())) {
    const y = p.getFullYear();
    const m = String(p.getMonth() + 1).padStart(2, '0');
    const d = String(p.getDate()).padStart(2, '0');
    return `${d}/${m}/${y}`;
  }
  return s;
};

export const computeNextRenewalDateFromStart = (startDateStr, durationStr = '1 month') => {
  const p = parseContractDate(startDateStr);
  if (!p || isNaN(p.getTime())) return '';
  const dur = String(durationStr || '').toLowerCase();
  const dt = new Date(p);
  if (dur.includes('annual') || dur.includes('year') || dur.includes('12 month')) {
    dt.setFullYear(dt.getFullYear() + 1);
  } else if (dur.includes('half') || dur.includes('6 month')) {
    dt.setMonth(dt.getMonth() + 6);
  } else if (dur.includes('quarter') || dur.includes('3 month')) {
    dt.setMonth(dt.getMonth() + 3);
  } else {
    dt.setMonth(dt.getMonth() + 1);
  }
  const d = String(dt.getDate()).padStart(2, '0');
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const y = dt.getFullYear();
  return `${d}/${m}/${y}`;
};

const findByIdOrCustomId = (id) => {
  if (!id) return { _id: null };
  const strId = String(id).trim();
  const conds = [];
  if (mongoose.isValidObjectId(strId)) {
    conds.push({ _id: strId });
  }
  conds.push({ customId: strId });
  const num = Number(strId);
  if (!isNaN(num) && strId !== '') {
    conds.push({ srNo: num });
  }
  return conds.length === 1 ? conds[0] : { $or: conds };
};

// Format currency helper
const formatINR = (val) => `₹${Number(val || 0).toLocaleString('en-IN')}`;

// Computes applied discount amount and label reliably
export const computeDealDiscount = (deal) => {
  if (!deal) return { discountAmount: 0, discountLabel: '' };
  let disc = Number(deal.discountAmount) || 0;
  const rawSubtotal = Number(deal.subtotal) || 0;
  const discVal = Number(deal.discountValue || deal.discount || 0);

  if (!disc && discVal > 0) {
    if (deal.discountType === 'percentage') {
      disc = Math.round((rawSubtotal * discVal) / 100);
    } else {
      disc = discVal;
    }
  }

  // If still 0, infer from subtotal - taxableBase (deal.total - deal.gstAmount)
  if (!disc && rawSubtotal > 0 && deal.total !== undefined && deal.gstAmount !== undefined) {
    const impliedTaxable = Math.round(Number(deal.total) - Number(deal.gstAmount));
    if (impliedTaxable < rawSubtotal) {
      disc = rawSubtotal - impliedTaxable;
    }
  }

  let label = '';
  if (disc > 0) {
    if (deal.discountType === 'percentage' && discVal > 0) {
      label = `${discVal}% off (-₹${disc.toLocaleString('en-IN')})`;
    } else {
      label = `-₹${disc.toLocaleString('en-IN')}`;
    }
  }

  return { discountAmount: disc, discountLabel: label };
};

// Helper to escape regex special characters
const escapeRegExp = (string) => {
  return string ? String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
};

// Helper to normalize names for loose comparison
const normalizeName = (str) => {
  if (!str) return '';
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, '').trim();
};

/**
 * Synchronize Client updates across linked SalesContracts, Projects, Deals, Payments, and Invoices.
 */
export const syncClientToLinkedEntities = async (client, updates = {}, prevCompanyName = '') => {
  if (!client) return;
  try {
    const clientCustomId = client.customId || client._id.toString();
    const mongoId = client._id.toString();
    const newCompName = (client.companyName || client.company || '').trim();
    const prevCompName = (prevCompanyName || '').trim();
    const brandName = client.displayName || '';
    const primary = (client.contacts || []).find(c => c.isPrimary) || client.contacts?.[0] || {};
    const primaryName = primary.name || client.contact || '';
    const primaryPhone = primary.phone || '';
    const primaryEmail = primary.email || '';
    const gstin = (client.gstin || '').toUpperCase().trim();

    const bill = client.billingAddress || {};
    const addrParts = [bill.street, bill.city, bill.state, bill.postalCode, bill.country].filter(Boolean);
    const formattedAddress = addrParts.join(', ');

    // 1. Find and update all matching SalesContracts
    const contractConditions = [
      { clientId: { $in: [clientCustomId, mongoId] } }
    ];
    if (newCompName) {
      contractConditions.push({ companyName: new RegExp('^' + escapeRegExp(newCompName) + '$', 'i') });
    }
    if (prevCompName && prevCompName.toLowerCase() !== newCompName.toLowerCase()) {
      contractConditions.push({ companyName: new RegExp('^' + escapeRegExp(prevCompName) + '$', 'i') });
    }

    const linkedContracts = await SalesContract.find({ $or: contractConditions });
    for (const contract of linkedContracts) {
      let contractChanged = false;
      if (contract.clientId !== clientCustomId) {
        contract.clientId = clientCustomId;
        contractChanged = true;
      }
      if (newCompName && contract.companyName !== newCompName) {
        contract.companyName = newCompName;
        contractChanged = true;
      }
      if (brandName && contract.brandName !== brandName) {
        contract.brandName = brandName;
        contractChanged = true;
      }
      if (primaryName && contract.customerName !== primaryName) {
        contract.customerName = primaryName;
        contractChanged = true;
      }
      if (primaryPhone && contract.customerPhone !== primaryPhone) {
        contract.customerPhone = primaryPhone;
        contractChanged = true;
      }
      if (primaryEmail && contract.email !== primaryEmail) {
        contract.email = primaryEmail;
        contractChanged = true;
      }
      if (gstin && contract.gstNumber !== gstin) {
        contract.gstNumber = gstin;
        contractChanged = true;
      }
      if (formattedAddress && contract.companyAddress !== formattedAddress) {
        contract.companyAddress = formattedAddress;
        contractChanged = true;
      }

      if (contractChanged) {
        await contract.save();
        broadcastRealtimeUpdate('CONTRACT_UPDATED', { contract });
      }
    }

    // 2. Update matching Deals
    const dealConditions = [
      { clientId: { $in: [clientCustomId, mongoId] } }
    ];
    if (newCompName) {
      dealConditions.push({ clientName: new RegExp('^' + escapeRegExp(newCompName) + '$', 'i') });
    }
    if (prevCompName && prevCompName.toLowerCase() !== newCompName.toLowerCase()) {
      dealConditions.push({ clientName: new RegExp('^' + escapeRegExp(prevCompName) + '$', 'i') });
    }
    if (newCompName) {
      await Deal.updateMany(
        { $or: dealConditions },
        { $set: { clientName: newCompName, clientId: clientCustomId } }
      );
    }

    // 3. Update matching Projects
    const projectConditions = [
      { clientId: { $in: [clientCustomId, mongoId] } }
    ];
    if (newCompName) {
      projectConditions.push({ companyName: new RegExp('^' + escapeRegExp(newCompName) + '$', 'i') });
    }
    if (prevCompName && prevCompName.toLowerCase() !== newCompName.toLowerCase()) {
      projectConditions.push({ companyName: new RegExp('^' + escapeRegExp(prevCompName) + '$', 'i') });
    }
    const projectUpdates = {};
    if (newCompName) {
      projectUpdates.companyName = newCompName;
      projectUpdates.clientId = clientCustomId;
    }
    if (brandName) projectUpdates.brandName = brandName;
    if (primaryName) projectUpdates.clientName = primaryName;
    if (primaryPhone) projectUpdates.clientPhone = primaryPhone;
    if (primaryEmail) projectUpdates.clientEmail = primaryEmail;
    if (Object.keys(projectUpdates).length > 0) {
      await Project.updateMany({ $or: projectConditions }, { $set: projectUpdates });
    }

    // 4. Update matching Payments
    if (newCompName) {
      await Payment.updateMany(
        { clientId: { $in: [clientCustomId, mongoId] } },
        { $set: { clientName: newCompName } }
      );
    }

    // 5. Update matching Invoices
    if (newCompName && prevCompName && prevCompName.toLowerCase() !== newCompName.toLowerCase()) {
      await Invoice.updateMany(
        { client: new RegExp('^' + escapeRegExp(prevCompName) + '$', 'i') },
        { $set: { client: newCompName } }
      );
    }

    // 6. Recalculate Client Revenue and Payment Status
    const activeContracts = await SalesContract.find({
      $or: [
        { clientId: { $in: [clientCustomId, mongoId] } },
        { companyName: new RegExp('^' + escapeRegExp(newCompName) + '$', 'i') }
      ],
      isActive: true
    });
    if (activeContracts.length > 0) {
      const contractPaid = activeContracts.reduce((sum, c) => sum + (Number(c.amountReleasedWithGst) || 0), 0);
      const anyPending = activeContracts.some(c => (Number(c.balancePayment) || 0) > 0);
      const revenueStr = `₹${contractPaid.toLocaleString('en-IN')}`;
      const statusStr = anyPending ? 'pending' : (contractPaid > 0 ? 'paid' : 'pending');
      client.revenue = revenueStr;
      client.paymentStatus = statusStr;
      await Client.updateOne(
        { _id: client._id },
        { $set: { revenue: revenueStr, paymentStatus: statusStr } }
      );
    }
  } catch (syncErr) {
    console.error('Error in syncClientToLinkedEntities:', syncErr);
  }
};

/**
 * Synchronize SalesContract updates back to Client, sibling contracts, Projects, Deals, and Payments.
 */
export const syncContractToLinkedEntities = async (contract, prevCompanyName = '') => {
  if (!contract) return;
  try {
    const compName = (contract.companyName || '').trim();
    const prevCompName = (prevCompanyName || '').trim();
    if (!compName) return;

    // 1. Find or create matching Client
    const clientConditions = [];
    if (contract.clientId) {
      const cCond = findByIdOrCustomId(contract.clientId);
      if (cCond && cCond.$or) {
        clientConditions.push(...cCond.$or);
      } else if (cCond) {
        clientConditions.push(cCond);
      }
    }
    clientConditions.push({ companyName: new RegExp('^' + escapeRegExp(compName) + '$', 'i') });
    clientConditions.push({ company: new RegExp('^' + escapeRegExp(compName) + '$', 'i') });
    if (prevCompName && prevCompName.toLowerCase() !== compName.toLowerCase()) {
      clientConditions.push({ companyName: new RegExp('^' + escapeRegExp(prevCompName) + '$', 'i') });
      clientConditions.push({ company: new RegExp('^' + escapeRegExp(prevCompName) + '$', 'i') });
    }

    let client = await Client.findOne({ $or: clientConditions });

    if (!client) {
      const customClientId = `c_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 4)}`;
      client = await Client.create({
        customId: customClientId,
        companyName: compName,
        company: compName,
        displayName: contract.brandName || '',
        contact: contract.customerName || 'Primary Contact',
        phone: contract.customerPhone || '',
        email: contract.email || '',
        status: 'Active',
        type: 'Company',
        industry: contract.vertical || 'Digital Retainer',
        gstin: contract.gstNumber || '',
        pan: contract.tanNumber || '',
        contacts: [
          {
            name: contract.customerName || 'Primary Contact',
            phone: contract.customerPhone || '',
            email: contract.email || '',
            roleTitle: 'Key Decision Maker',
            isPrimary: true
          }
        ],
        area: contract.area || '',
        billingAddress: {
          street: contract.companyAddress || '',
          area: contract.area || '',
          city: contract.city || contract.branch || '',
          state: contract.state || '',
          postalCode: contract.pinCode || '',
          country: 'India'
        },
        ownerName: contract.soldBy || 'Sales Team'
      });
    }

    const clientCustomId = client.customId || client._id.toString();
    if (contract.clientId !== clientCustomId) {
      contract.clientId = clientCustomId;
      await SalesContract.updateOne({ _id: contract._id }, { $set: { clientId: clientCustomId } });
    }

    // Update Client details from contract
    client.companyName = compName;
    client.company = compName;
    if (contract.brandName) client.displayName = contract.brandName;
    if (contract.gstNumber) client.gstin = contract.gstNumber;

    if (contract.area) {
      client.area = contract.area;
      if (!client.billingAddress) client.billingAddress = {};
      client.billingAddress.area = contract.area;
    }
    if (contract.city) {
      if (!client.billingAddress) client.billingAddress = {};
      client.billingAddress.city = contract.city;
    }
    if (contract.state) {
      if (!client.billingAddress) client.billingAddress = {};
      client.billingAddress.state = contract.state;
    }
    if (contract.pinCode) {
      if (!client.billingAddress) client.billingAddress = {};
      client.billingAddress.postalCode = contract.pinCode;
    }

    if (contract.customerName || contract.customerPhone || contract.email) {
      if (!client.contacts) client.contacts = [];
      let primaryContact = client.contacts.find(c => c.isPrimary) || client.contacts[0];
      if (primaryContact) {
        if (contract.customerName) primaryContact.name = contract.customerName;
        if (contract.customerPhone) primaryContact.phone = contract.customerPhone;
        if (contract.email) primaryContact.email = contract.email;
      } else if (contract.customerName) {
        client.contacts.push({
          name: contract.customerName,
          phone: contract.customerPhone || '',
          email: contract.email || '',
          roleTitle: 'Key Decision Maker',
          isPrimary: true
        });
      }
      if (contract.customerName) client.contact = contract.customerName;
    }

    if (contract.companyAddress) {
      if (!client.billingAddress) client.billingAddress = {};
      client.billingAddress.street = contract.companyAddress;
    }

    // Recalculate Client Revenue & Payment Status from all contracts for this client
    const allContracts = await SalesContract.find({
      $or: [
        { clientId: clientCustomId },
        { companyName: new RegExp('^' + escapeRegExp(compName) + '$', 'i') }
      ],
      isActive: true
    });
    const totalPaid = allContracts.reduce((sum, c) => sum + (Number(c.amountReleasedWithGst) || 0), 0);
    const hasPendingBalance = allContracts.some(c => (Number(c.balancePayment) || 0) > 0);
    client.revenue = `₹${totalPaid.toLocaleString('en-IN')}`;
    client.paymentStatus = hasPendingBalance ? 'pending' : (totalPaid > 0 ? 'paid' : 'pending');
    await client.save();
    broadcastRealtimeUpdate('CLIENT_UPDATED', { client });

    // 2. Sibling Contracts Sync if company renamed
    if (prevCompName && prevCompName.toLowerCase() !== compName.toLowerCase()) {
      await SalesContract.updateMany(
        {
          _id: { $ne: contract._id },
          companyName: new RegExp('^' + escapeRegExp(prevCompName) + '$', 'i')
        },
        {
          $set: {
            companyName: compName,
            clientId: clientCustomId
          }
        }
      );
    }

    // 3. Update or Provision matching Projects
    const sDate = contract.dateOfSales || contract.salesDate || contract.renewalFromDate;
    const projectUpdates = { companyName: compName, clientId: clientCustomId };
    if (contract.brandName) projectUpdates.brandName = contract.brandName;
    if (contract.customerName) projectUpdates.clientName = contract.customerName;
    if (contract.customerPhone) projectUpdates.clientPhone = contract.customerPhone;
    if (contract.email) projectUpdates.clientEmail = contract.email;
    if (contract.companyAddress) {
      projectUpdates.clientAddress = {
        street: contract.companyAddress,
        city: contract.branch || '',
        state: '',
        postalCode: '',
        country: 'India'
      };
    }

    if (sDate) {
      projectUpdates.salesDate = sDate;
      projectUpdates.startDate = sDate;
    }
    if (contract.dateOfLogin || contract.loginDate) {
      projectUpdates.loginDate = contract.dateOfLogin || contract.loginDate;
    }
    if (contract.dateOfPayment || contract.paymentDate) {
      projectUpdates.paymentDate = contract.dateOfPayment || contract.paymentDate;
    }
    const serviceText = contract.plan || contract.typeOfServices || contract.services || '';
    const durationUpper = String(contract.durationOfContract || contract.contractType || '').toUpperCase();
    const serviceUpper = String(serviceText).toUpperCase();
    const isWebsiteOrOneTime = serviceUpper.includes('WEB') || serviceUpper.includes('SITE') || serviceUpper.includes('HOSTING') || serviceUpper.includes('DOMAIN') || durationUpper.includes('ONE-TIME') || durationUpper.includes('ONETIME') || durationUpper.includes('ONE TIME');

    let effectiveRenewalDate = contract.renewalDate;

    if (sDate && (isWebsiteOrOneTime || !effectiveRenewalDate || effectiveRenewalDate === sDate)) {
      const parts = String(sDate).trim().split(/[/.-]/);
      if (parts.length === 3) {
        let d, m, y;
        if (parts[0].length === 4) {
          y = parseInt(parts[0], 10);
          m = parseInt(parts[1], 10) - 1;
          d = parseInt(parts[2], 10);
        } else {
          d = parseInt(parts[0], 10);
          m = parseInt(parts[1], 10) - 1;
          y = parseInt(parts[2], 10);
          if (y < 100) y += 2000;
        }
        const dt = new Date(y, m, d);
        if (isWebsiteOrOneTime || durationUpper.includes('YEAR') || durationUpper.includes('ANNUAL')) {
          dt.setFullYear(dt.getFullYear() + 1);
        } else {
          dt.setMonth(dt.getMonth() + 1);
        }
        const resD = String(dt.getDate()).padStart(2, '0');
        const resM = String(dt.getMonth() + 1).padStart(2, '0');
        const resY = dt.getFullYear();
        effectiveRenewalDate = `${resD}/${resM}/${resY}`;
      }
    }

    if (effectiveRenewalDate) {
      projectUpdates.renewalDate = effectiveRenewalDate;
      projectUpdates.nextRenewalDate = effectiveRenewalDate;
      if (contract.renewalDate !== effectiveRenewalDate) {
        contract.renewalDate = effectiveRenewalDate;
        await SalesContract.updateOne({ _id: contract._id }, { $set: { renewalDate: effectiveRenewalDate } });
      }
    }

    if (contract.durationOfContract || contract.contractType) {
      projectUpdates.planDuration = contract.durationOfContract || contract.contractType;
    }
    if (serviceText) {
      projectUpdates.soldPlanName = serviceText;
      const parsedServices = serviceText
        .split(/[,+&]/)
        .map(s => s.trim())
        .filter(Boolean);
      if (parsedServices.length > 0) {
        projectUpdates.services = parsedServices;
      }
    }
    if (contract.fullContractValue) {
      projectUpdates.budget = `₹${Number(contract.fullContractValue).toLocaleString('en-IN')}`;
    }
    if (contract.servicesBrief || contract.remarks) {
      projectUpdates.finalRemarks = contract.servicesBrief || contract.remarks;
    }
    if (contract.customId || contract._id) {
      projectUpdates.sourceContractId = contract.customId || contract._id.toString();
    }
    if (contract.isActive === false) {
      projectUpdates.status = 'inactive';
    }

    const projectConditions = [
      { clientId: clientCustomId },
      { companyName: new RegExp('^' + escapeRegExp(prevCompName || compName) + '$', 'i') }
    ];
    if (contract.brandName && contract.brandName.trim()) {
      const bTrim = contract.brandName.trim();
      projectConditions.push({ brandName: new RegExp('^' + escapeRegExp(bTrim) + '$', 'i') });
      projectConditions.push({ name: new RegExp('^' + escapeRegExp(bTrim), 'i') });
    }
    if (contract.projectId) {
      projectConditions.push({ customId: contract.projectId });
      if (mongoose.isValidObjectId(contract.projectId)) {
        projectConditions.push({ _id: contract.projectId });
      }
    }
    if (contract.customId) {
      projectConditions.push({ sourceContractId: contract.customId });
      projectConditions.push({ sourceDealId: contract.customId });
    }

    const matchedProjects = await Project.find({ $or: projectConditions });

    if (matchedProjects.length > 0) {
      for (const prj of matchedProjects) {
        // Fetch all active, non-deleted contracts for this project/client to determine chronological truth
        const allProjContracts = await SalesContract.find({
          $or: [
            { projectId: prj.customId },
            { clientId: clientCustomId },
            { companyName: new RegExp('^' + escapeRegExp(compName) + '$', 'i') },
            ...(contract.brandName ? [{ brandName: new RegExp('^' + escapeRegExp(contract.brandName) + '$', 'i') }] : []),
            { _id: contract._id }
          ],
          isActive: { $ne: false },
          isDeleted: { $ne: true }
        });

        // Chronologically sort all contracts to establish inception and current active term
        allProjContracts.sort((a, b) => {
          const da = parseContractDate(a.dateOfSales || a.salesDate, a.month, a.year);
          const db = parseContractDate(b.dateOfSales || b.salesDate, b.month, b.year);
          return da.getTime() - db.getTime();
        });

        const earliest = allProjContracts[0] || contract;
        const latest = allProjContracts[allProjContracts.length - 1] || contract;

        const rawInceptionDate = earliest.dateOfSales || earliest.salesDate || earliest.renewalFromDate || sDate;
        const rawRenewalDate = contract.renewalDate || latest.renewalDate || effectiveRenewalDate;
        const rawPlanDuration = contract.durationOfContract || latest.durationOfContract || contract.contractType || latest.contractType || prj.planDuration || 'MONTHLY';
        const distinctPlans = [];
        const distinctServices = new Set(Array.isArray(prj.services) ? prj.services : []);
        let combinedBudget = 0;

        allProjContracts.forEach(c => {
          const p = (c.plan || '').trim();
          if (p && !distinctPlans.includes(p)) distinctPlans.push(p);
          const s = (c.typeOfServices || '').trim();
          if (s) {
            distinctServices.add(s);
            if (!distinctPlans.includes(s) && !distinctPlans.some(dp => dp.toLowerCase() === s.toLowerCase())) {
              distinctPlans.push(s);
            }
          }
          combinedBudget += Number(c.fullContractValue || c.saleAmount || 0);
        });

        const rawSoldPlan = distinctPlans.length > 0 
          ? distinctPlans.join(' + ') 
          : (contract.plan || latest.plan || contract.typeOfServices || latest.typeOfServices || prj.soldPlanName);
        const rawBrand = contract.brandName || latest.brandName || earliest.brandName || prj.brandName || '';

        const individualUpdates = {
          companyName: compName,
          clientId: clientCustomId,
          brandName: rawBrand,
          clientName: contract.customerName || latest.customerName || earliest.customerName || prj.clientName || '',
          clientPhone: contract.customerPhone || latest.customerPhone || earliest.customerPhone || prj.clientPhone || '',
          clientEmail: contract.email || latest.email || earliest.email || prj.clientEmail || '',
          clientAddress: {
            street: contract.companyAddress || latest.companyAddress || '',
            city: contract.branch || latest.branch || '',
            state: '',
            postalCode: '',
            country: 'India'
          },
          salesDate: rawInceptionDate,
          startDate: rawInceptionDate,
          handoverDate: normalizeToYMD(rawInceptionDate) || prj.handoverDate,
          renewalDate: rawRenewalDate,
          nextRenewalDate: rawRenewalDate,
          planDuration: rawPlanDuration,
          soldPlanName: rawSoldPlan
        };

        if (contract.dateOfLogin || contract.loginDate) {
          individualUpdates.loginDate = contract.dateOfLogin || contract.loginDate;
        }
        if (contract.dateOfPayment || contract.paymentDate) {
          individualUpdates.paymentDate = contract.dateOfPayment || contract.paymentDate;
        }
        if (distinctServices.size > 0) {
          individualUpdates.services = Array.from(distinctServices).filter(Boolean);
        } else if (rawSoldPlan) {
          const parsedServices = rawSoldPlan.split(/[,+&]/).map(s => s.trim()).filter(Boolean);
          if (parsedServices.length > 0) {
            individualUpdates.services = parsedServices;
          }
        }
        const finalBudgetNum = combinedBudget > 0 ? combinedBudget : Number(contract.fullContractValue || latest.fullContractValue || 0);
        if (finalBudgetNum > 0) {
          individualUpdates.budget = `₹${finalBudgetNum.toLocaleString('en-IN')}`;
        }
        if (contract.servicesBrief || contract.remarks) {
          individualUpdates.finalRemarks = contract.servicesBrief || contract.remarks;
        }

        // Parse custom deliverables from remarks or servicesBrief
        const remarksCombined = `${contract.servicesBrief || ''} ${contract.remarks || ''} ${rawSoldPlan || ''}`.toLowerCase();
        let parsedCreatives = null;
        let parsedReels = null;
        let parsedCarousels = null;
        let parsedFestival = null;

        if (contract.deliverablesQuota) {
          if (contract.deliverablesQuota.creatives) parsedCreatives = Number(contract.deliverablesQuota.creatives);
          if (contract.deliverablesQuota.aiReels) parsedReels = Number(contract.deliverablesQuota.aiReels);
          if (contract.deliverablesQuota.carousels !== undefined) parsedCarousels = Number(contract.deliverablesQuota.carousels);
          if (contract.deliverablesQuota.festival !== undefined) parsedFestival = Boolean(contract.deliverablesQuota.festival);
        }

        if (parsedCreatives === null || parsedCreatives > 20) {
          const weeklyCreativeMatch = remarksCombined.match(/creative(?:\s*posts?)?\s*(?:per\s*week|\/\s*week|\/\s*wk)[^\d]*\(?(\d+)\)?/i) ||
                                      remarksCombined.match(/\(?(\d+)\)?\s*creative(?:\s*posts?)?\s*(?:per\s*week|\/\s*week|\/\s*wk)/i) ||
                                      remarksCombined.match(/(\d+)\s*(?:creative|graphics?|post)\s*(?:per\s*week|\/\s*week|\/\s*wk)/i);
          if (weeklyCreativeMatch) {
            const perWeek = parseInt(weeklyCreativeMatch[1], 10);
            if (!isNaN(perWeek) && perWeek > 0) parsedCreatives = perWeek * 4;
          } else {
            const yearlyCreativeMatch = remarksCombined.match(/(\d+)\s*(?:creative(?:\s*graphics?)?|graphics?)(?!\s*ads?)(?:\s*posts?)?[^\n,]*(?:\/\s*yr|\/\s*year|per\s*year|annually|\/\s*annum|per\s*annum)/i);
            if (yearlyCreativeMatch) {
              const perYear = parseInt(yearlyCreativeMatch[1], 10);
              if (!isNaN(perYear) && perYear > 0) parsedCreatives = Math.max(1, Math.round(perYear / 12));
            } else {
              const monthlyCreativeMatch = remarksCombined.match(/(\d+)\s*(?:creative(?:\s*graphics?)?|graphics?)(?!\s*ads?)(?:\s*posts?)?(?:\s*per\s*month|\/\s*month|\/\s*mo)?/i);
              if (monthlyCreativeMatch) {
                let perMonth = parseInt(monthlyCreativeMatch[1], 10);
                if (!isNaN(perMonth) && perMonth > 0) {
                  if (perMonth >= 24 && (remarksCombined.includes('annual') || remarksCombined.includes('/yr') || remarksCombined.includes('year') || String(contract.durationOfContract || '').toUpperCase().includes('ANNUAL'))) {
                    perMonth = Math.max(1, Math.round(perMonth / 12));
                  }
                  parsedCreatives = perMonth;
                }
              }
            }
          }
        }

        if (parsedReels === null || parsedReels > 20) {
          const weeklyReelMatch = remarksCombined.match(/(?:weekly[^\d]*)?\(?\s*\d+\.?\s*(?:post|creative)[^\d]*\+[^\d]*(\d+)\.?\s*(?:reel|video)/i) ||
                                  remarksCombined.match(/(?:ai\s*|engagement\s*|basic\s*)?reels?\s*(?:per\s*week|\/\s*week|\/\s*wk)[^\d]*\(?(\d+)\)?/i) ||
                                  remarksCombined.match(/\(?(\d+)\)?\s*(?:ai\s*|engagement\s*|basic\s*)?reels?\s*(?:per\s*week|\/\s*week|\/\s*wk)/i) ||
                                  remarksCombined.match(/(?:^|[^\w])(\d+)\.?\s*reels?\s*(?:per\s*week|\/\s*week|\/\s*wk)/i);
          if (weeklyReelMatch) {
            const num = parseInt(weeklyReelMatch[1], 10);
            if (!isNaN(num) && num > 0) parsedReels = num * 4;
          } else {
            const yearlyReelMatch = remarksCombined.match(/(\d+)\s*(?:ai\s*|engagement\s*|basic\s*)?reels?[^\n,]*(?:\/\s*yr|\/\s*year|per\s*year|annually|\/\s*annum|per\s*annum)/i);
            if (yearlyReelMatch) {
              const perYear = parseInt(yearlyReelMatch[1], 10);
              if (!isNaN(perYear) && perYear > 0) parsedReels = Math.max(1, Math.round(perYear / 12));
            } else {
              const monthlyReelMatch = remarksCombined.match(/(\d+)\s*(?:ai\s*|engagement\s*|basic\s*)?reels?(?:\s*per\s*month|\/\s*month|\/\s*mo)?/i);
              if (monthlyReelMatch) {
                let num = parseInt(monthlyReelMatch[1], 10);
                if (!isNaN(num) && num > 0) {
                  if (num >= 24 && (remarksCombined.includes('annual') || remarksCombined.includes('/yr') || remarksCombined.includes('year') || String(contract.durationOfContract || '').toUpperCase().includes('ANNUAL'))) {
                    num = Math.max(1, Math.round(num / 12));
                  }
                  parsedReels = num;
                }
              }
            }
          }
        }

        if (remarksCombined.includes('basic') || remarksCombined.includes('starter')) {
          if (parsedCreatives === null) parsedCreatives = 4;
          if (parsedReels === null) parsedReels = 4;
        }

        const yearlyCarouselMatch = remarksCombined.match(/(\d+)\s*carousels?[^\n,]*(?:\/\s*yr|\/\s*year|per\s*year|annually|\/\s*annum|per\s*annum)/i) ||
                                    remarksCombined.match(/carousel[^\d]*\(?(\d+)\)?[^\n,]*(?:\/\s*yr|\/\s*year|per\s*year|annually|\/\s*annum|per\s*annum)/i);
        if (yearlyCarouselMatch) {
          const perYear = parseInt(yearlyCarouselMatch[1], 10);
          if (!isNaN(perYear) && perYear > 0) parsedCarousels = Math.max(1, Math.round(perYear / 12));
        } else {
          const carouselMatch = remarksCombined.match(/carousel[^\d]*\(?(\d+)\)?/i);
          if (carouselMatch) {
            let num = parseInt(carouselMatch[1], 10);
            if (!isNaN(num) && num > 0) {
              if (num >= 24 && (remarksCombined.includes('annual') || remarksCombined.includes('/yr') || remarksCombined.includes('year'))) {
                num = Math.max(1, Math.round(num / 12));
              }
              parsedCarousels = num;
            }
          }
        }

        if (remarksCombined.includes('festival') || remarksCombined.includes('occasion')) {
          parsedFestival = true;
        }

        if (parsedCreatives !== null || parsedReels !== null || parsedCarousels !== null || parsedFestival !== null) {
          individualUpdates['deliverablesQuota.creatives'] = parsedCreatives ?? (prj.deliverablesQuota?.creatives || 8);
          individualUpdates['deliverablesQuota.aiReels'] = parsedReels ?? (prj.deliverablesQuota?.aiReels || 4);
          if (parsedCarousels !== null) individualUpdates['deliverablesQuota.carousels'] = parsedCarousels;
          if (parsedFestival !== null) individualUpdates['deliverablesQuota.festival'] = parsedFestival;

          individualUpdates['content.creatives'] = individualUpdates['deliverablesQuota.creatives'];
          individualUpdates['content.shorts'] = individualUpdates['deliverablesQuota.aiReels'];
          individualUpdates['content.aiVideos'] = individualUpdates['deliverablesQuota.aiReels'];
          if (parsedFestival) individualUpdates['content.festivalContent'] = 1;
        }

        if (contract.customId || contract._id) {
          individualUpdates.sourceContractId = contract.customId || contract._id.toString();
        }
        if (contract.isActive === false && allProjContracts.every(c => c.isActive === false)) {
          individualUpdates.status = 'inactive';
        } else {
          individualUpdates.status = 'active';
        }

        await Project.updateOne({ _id: prj._id }, { $set: individualUpdates });
        const freshProject = await Project.findById(prj._id);
        try {
          if (parsedCreatives !== null || parsedReels !== null) {
            await generateDeliverablesForProjectBackend(freshProject._id, true);
          }
        } catch (genErr) {
          console.warn('Error re-generating deliverables after quota sync:', genErr.message);
        }
        broadcastRealtimeUpdate('PROJECT_UPDATED', { project: freshProject });
      }
      if (!contract.projectId && matchedProjects[0]) {
        const pId = matchedProjects[0].customId || matchedProjects[0]._id.toString();
        await SalesContract.updateOne({ _id: contract._id }, { $set: { projectId: pId } });
      }
    } else if (contract.isActive !== false && compName) {
      const newProjCustomId = `prj_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 4)}`;
      const planText = serviceText || 'Digital Retainer';
      const startDateVal = sDate || new Date().toISOString().split('T')[0];
      const parsedServices = planText.split(/[,+&]/).map(s => s.trim()).filter(Boolean);

      const remarksCombined = `${contract.servicesBrief || ''} ${contract.remarks || ''} ${planText || ''}`.toLowerCase();
      let initCreatives = (remarksCombined.includes('basic') || remarksCombined.includes('starter')) ? 4 : 8;
      let initReels = 4;
      let initCarousels = 0;
      let initFestival = true;

      if (contract.deliverablesQuota) {
        if (contract.deliverablesQuota.creatives) initCreatives = Number(contract.deliverablesQuota.creatives);
        if (contract.deliverablesQuota.aiReels) initReels = Number(contract.deliverablesQuota.aiReels);
        if (contract.deliverablesQuota.carousels !== undefined) initCarousels = Number(contract.deliverablesQuota.carousels);
        if (contract.deliverablesQuota.festival !== undefined) initFestival = Boolean(contract.deliverablesQuota.festival);
      }

      let parsedCreatives = null;
      let parsedReels = null;

      if (!contract.deliverablesQuota?.creatives) {
        const weeklyCreativeMatch = remarksCombined.match(/creative(?:\s*posts?)?\s*(?:per\s*week|\/\s*week|\/\s*wk)[^\d]*\(?(\d+)\)?/i) ||
                                    remarksCombined.match(/\(?(\d+)\)?\s*creative(?:\s*posts?)?\s*(?:per\s*week|\/\s*week|\/\s*wk)/i) ||
                                    remarksCombined.match(/(\d+)\s*(?:creative|graphics?|post)\s*(?:per\s*week|\/\s*week|\/\s*wk)/i);
        if (weeklyCreativeMatch) {
          const perWeek = parseInt(weeklyCreativeMatch[1], 10);
          if (!isNaN(perWeek) && perWeek > 0) parsedCreatives = perWeek * 4;
        } else {
          const yearlyCreativeMatch = remarksCombined.match(/(\d+)\s*(?:creative(?:\s*graphics?)?|graphics?)(?!\s*ads?)(?:\s*posts?)?[^\n,]*(?:\/\s*yr|\/\s*year|per\s*year|annually|\/\s*annum|per\s*annum)/i);
          if (yearlyCreativeMatch) {
            const perYear = parseInt(yearlyCreativeMatch[1], 10);
            if (!isNaN(perYear) && perYear > 0) parsedCreatives = Math.max(1, Math.round(perYear / 12));
          } else {
            const monthlyCreativeMatch = remarksCombined.match(/(\d+)\s*(?:creative(?:\s*graphics?)?|graphics?)(?!\s*ads?)(?:\s*posts?)?(?:\s*per\s*month|\/\s*month|\/\s*mo)?/i);
            if (monthlyCreativeMatch) {
              let perMonth = parseInt(monthlyCreativeMatch[1], 10);
              if (!isNaN(perMonth) && perMonth > 0) {
                if (perMonth >= 24 && (remarksCombined.includes('annual') || remarksCombined.includes('/yr') || remarksCombined.includes('year') || String(contract.durationOfContract || '').toUpperCase().includes('ANNUAL'))) {
                  perMonth = Math.max(1, Math.round(perMonth / 12));
                }
                parsedCreatives = perMonth;
              }
            }
          }
        }
        if (parsedCreatives !== null) initCreatives = parsedCreatives;
      }

      if (!contract.deliverablesQuota?.aiReels) {
        const weeklyReelMatch = remarksCombined.match(/(?:weekly[^\d]*)?\(?\s*\d+\.?\s*(?:post|creative)[^\d]*\+[^\d]*(\d+)\.?\s*(?:reel|video)/i) ||
                                remarksCombined.match(/(?:ai\s*|engagement\s*|basic\s*)?reels?\s*(?:per\s*week|\/\s*week|\/\s*wk)[^\d]*\(?(\d+)\)?/i) ||
                                remarksCombined.match(/\(?(\d+)\)?\s*(?:ai\s*|engagement\s*|basic\s*)?reels?\s*(?:per\s*week|\/\s*week|\/\s*wk)/i) ||
                                remarksCombined.match(/(?:^|[^\w])(\d+)\.?\s*reels?\s*(?:per\s*week|\/\s*week|\/\s*wk)/i);
        if (weeklyReelMatch) {
          const num = parseInt(weeklyReelMatch[1], 10);
          if (!isNaN(num) && num > 0) parsedReels = num * 4;
        } else {
          const yearlyReelMatch = remarksCombined.match(/(\d+)\s*(?:ai\s*|engagement\s*|basic\s*)?reels?[^\n,]*(?:\/\s*yr|\/\s*year|per\s*year|annually|\/\s*annum|per\s*annum)/i);
          if (yearlyReelMatch) {
            const perYear = parseInt(yearlyReelMatch[1], 10);
            if (!isNaN(perYear) && perYear > 0) parsedReels = Math.max(1, Math.round(perYear / 12));
          } else {
            const monthlyReelMatch = remarksCombined.match(/(\d+)\s*(?:ai\s*|engagement\s*|basic\s*)?reels?(?:\s*per\s*month|\/\s*month|\/\s*mo)?/i);
            if (monthlyReelMatch) {
              let perMonth = parseInt(monthlyReelMatch[1], 10);
              if (!isNaN(perMonth) && perMonth > 0) {
                if (perMonth >= 24 && (remarksCombined.includes('annual') || remarksCombined.includes('/yr') || remarksCombined.includes('year') || String(contract.durationOfContract || '').toUpperCase().includes('ANNUAL'))) {
                  perMonth = Math.max(1, Math.round(perMonth / 12));
                }
                parsedReels = perMonth;
              }
            }
          }
        }
        if (parsedReels !== null) initReels = parsedReels;
      }

      if (remarksCombined.includes('basic') || remarksCombined.includes('starter')) {
        if (!contract.deliverablesQuota?.creatives && parsedCreatives === null) initCreatives = 4;
        if (!contract.deliverablesQuota?.aiReels && parsedReels === null) initReels = 4;
      }

      const yearlyCarouselMatch = remarksCombined.match(/(\d+)\s*carousels?[^\n,]*(?:\/\s*yr|\/\s*year|per\s*year|annually|\/\s*annum|per\s*annum)/i) ||
                                  remarksCombined.match(/carousel[^\d]*\(?(\d+)\)?[^\n,]*(?:\/\s*yr|\/\s*year|per\s*year|annually|\/\s*annum|per\s*annum)/i);
      if (yearlyCarouselMatch) {
        const perYear = parseInt(yearlyCarouselMatch[1], 10);
        if (!isNaN(perYear) && perYear > 0) initCarousels = Math.max(1, Math.round(perYear / 12));
      } else {
        const carouselMatch = remarksCombined.match(/carousel[^\d]*\(?(\d+)\)?/i);
        if (carouselMatch) {
          let num = parseInt(carouselMatch[1], 10);
          if (!isNaN(num) && num > 0) {
            if (num >= 24 && (remarksCombined.includes('annual') || remarksCombined.includes('/yr') || remarksCombined.includes('year'))) {
              num = Math.max(1, Math.round(num / 12));
            }
            initCarousels = num;
          }
        }
      }

      if (remarksCombined.includes('festival') || remarksCombined.includes('occasion')) {
        initFestival = true;
      }

      const newProject = await Project.create({
        customId: newProjCustomId,
        name: `${contract.brandName || compName} - ${planText}`,
        companyName: compName,
        brandName: contract.brandName || '',
        clientName: contract.customerName || '',
        clientPhone: contract.customerPhone || '',
        clientEmail: contract.email || '',
        clientAddress: {
          street: contract.companyAddress || '',
          city: contract.branch || '',
          state: '',
          postalCode: '',
          country: 'India'
        },
        clientId: clientCustomId,
        sourceDealId: contract.customId || contract.dealId || null,
        sourceContractId: contract.customId || contract._id.toString(),
        soldPlanName: planText,
        services: parsedServices.length > 0 ? parsedServices : ['SMO'],
        budget: contract.fullContractValue ? `₹${Number(contract.fullContractValue).toLocaleString('en-IN')}` : '₹0',
        startDate: startDateVal,
        salesDate: startDateVal,
        handoverDate: normalizeToYMD(startDateVal),
        loginDate: contract.dateOfLogin || contract.loginDate || startDateVal,
        paymentDate: contract.dateOfPayment || contract.paymentDate || startDateVal,
        renewalDate: contract.renewalDate || '',
        nextRenewalDate: contract.renewalDate || '',
        planDuration: contract.durationOfContract || contract.contractType || 'MONTHLY',
        finalRemarks: contract.servicesBrief || contract.remarks || '',
        deliverablesQuota: {
          creatives: initCreatives,
          aiReels: initReels,
          carousels: initCarousels,
          festival: initFestival
        },
        content: {
          creatives: initCreatives,
          shorts: initReels,
          aiVideos: initReels,
          festivalContent: initFestival ? 1 : 0
        },
        status: 'active',
        salesTeam: [contract.soldBy || 'Sales Team'],
        accountManager: 'Unassigned',
        manager: 'Unassigned',
        graphicDesigner: 'Unassigned',
        videoEditor: 'Unassigned',
        productionManager: 'Unassigned',
        assignedMembers: [],
        assignedAmId: null,
        assignedAmName: '',
        assignedAmAt: null,
        handoffStatus: 'Awaiting Admin Assignment'
      });

      await SalesContract.updateOne({ _id: contract._id }, { $set: { projectId: newProjCustomId } });

      try {
        await generateDeliverablesForProjectBackend(newProject, true);
      } catch (e) {
        console.warn('Deliverable generation notice during project sync:', e.message);
      }
      broadcastRealtimeUpdate('PROJECT_CREATED', { project: newProject });
    }

    // 4. Update matching Deals
    await Deal.updateMany(
      {
        $or: [
          { clientId: clientCustomId },
          { clientName: new RegExp('^' + escapeRegExp(prevCompName || compName) + '$', 'i') }
        ]
      },
      { $set: { clientName: compName, clientId: clientCustomId } }
    );

    // 5. Update matching Payments
    await Payment.updateMany(
      {
        $or: [
          { clientId: clientCustomId },
          { clientName: new RegExp('^' + escapeRegExp(prevCompName || compName) + '$', 'i') }
        ]
      },
      { $set: { clientName: compName, clientId: clientCustomId } }
    );

  } catch (syncErr) {
    console.error('Error in syncContractToLinkedEntities:', syncErr);
  }
};

/**
 * Synchronize a Payment to matching SalesContract (update released/balance, record settlement) and Client.
 */
export const syncPaymentToContractAndClient = async (payment, deal, client) => {
  if (!payment) return;
  try {
    const paymentAmount = Number(payment.amount) || 0;
    if (paymentAmount <= 0) return;

    // Find the matching contract
    let contract = null;
    const dealId = deal ? (deal.customId || deal._id.toString()) : payment.dealId;
    const clientId = client ? (client.customId || client._id.toString()) : payment.clientId;
    const clientName = (client?.companyName || client?.company || deal?.clientName || payment.clientName || '').trim();

    if (dealId) {
      contract = await SalesContract.findOne({ dealId, isActive: true });
    }

    if (!contract && clientId) {
      // Find contract with pending balance first
      contract = await SalesContract.findOne({
        clientId,
        balancePayment: { $gt: 0 },
        isActive: true
      }).sort({ dateOfSales: -1, createdAt: -1 });

      if (!contract) {
        contract = await SalesContract.findOne({ clientId, isActive: true }).sort({ dateOfSales: -1, createdAt: -1 });
      }
    }

    if (!contract && clientName) {
      contract = await SalesContract.findOne({
        companyName: new RegExp('^' + escapeRegExp(clientName) + '$', 'i'),
        balancePayment: { $gt: 0 },
        isActive: true
      }).sort({ dateOfSales: -1, createdAt: -1 });

      if (!contract) {
        contract = await SalesContract.findOne({
          companyName: new RegExp('^' + escapeRegExp(clientName) + '$', 'i'),
          isActive: true
        }).sort({ dateOfSales: -1, createdAt: -1 });
      }
    }

    if (contract) {
      if (clientId && !contract.clientId) contract.clientId = clientId;
      if (dealId && !contract.dealId) contract.dealId = dealId;

      const prevReleased = Number(contract.amountReleasedWithGst) || 0;
      const prevBalance = Number(contract.balancePayment) || 0;

      contract.amountReleasedWithGst = prevReleased + paymentAmount;
      contract.balancePayment = Math.max(0, prevBalance - paymentAmount);
      contract.paymentType = contract.balancePayment === 0 ? 'Full' : 'Partial';

      const payDate = payment.paidOn || new Date().toISOString().split('T')[0];
      const invNum = deal?.dealCode ? `INV-DEAL-${deal.dealCode}` : `INV-PAY-${payment.customId || ''}`;

      if (!contract.settlements) contract.settlements = [];
      contract.settlements.push({
        amount: paymentAmount,
        paymentMode: payment.mode || 'UPI',
        paymentRefNo: payment.reference || '',
        paymentDate: payDate,
        invoiceNumber: invNum,
        notes: payment.notes || `Payment recorded via Deals/Payments ledger`,
        createdAt: new Date()
      });

      const logMsg = `[Payment on ${payDate}]: ₹${paymentAmount.toLocaleString('en-IN')} paid via ${payment.mode || 'UPI'}${payment.reference ? ` (Ref: ${payment.reference})` : ''}. Balance remaining: ₹${contract.balancePayment.toLocaleString('en-IN')}`;
      contract.remarks = contract.remarks ? `${contract.remarks} | ${logMsg}` : logMsg;

      await contract.save();
      broadcastRealtimeUpdate('CONTRACT_UPDATED', { contract });
    }

    // Ensure client revenue & payment status are up to date
    if (client) {
      const activeContracts = await SalesContract.find({
        $or: [
          { clientId: client.customId || client._id.toString() },
          { companyName: new RegExp('^' + escapeRegExp(clientName) + '$', 'i') }
        ],
        isActive: true
      });
      if (activeContracts.length > 0) {
        const contractPaid = activeContracts.reduce((sum, c) => sum + (Number(c.amountReleasedWithGst) || 0), 0);
        const hasPendingBalance = activeContracts.some(c => (Number(c.balancePayment) || 0) > 0);
        client.revenue = `₹${contractPaid.toLocaleString('en-IN')}`;
        client.paymentStatus = hasPendingBalance ? 'pending' : (contractPaid > 0 ? 'paid' : 'pending');
        await client.save();
      }
      broadcastRealtimeUpdate('CLIENT_UPDATED', { client });
    }
  } catch (syncErr) {
    console.error('Error in syncPaymentToContractAndClient:', syncErr);
  }
};

// ==========================================
// 1. PLANS CONTROLLERS
// ==========================================
export const getPlans = async (req, res, next) => {
  try {
    await seedDefaultPlans();
    const plans = await Plan.find({ isActive: true }).sort({ category: 1, basePrice: 1 });
    res.json({ success: true, data: plans });
  } catch (err) {
    next(err);
  }
};

export const createPlan = async (req, res, next) => {
  try {
    const { name, code, description, billingType, basePrice, gstPercent, includes, deliverablesQuota, content } = req.body;
    if (!name || !code) {
      return res.status(400).json({ success: false, message: 'Plan name and unique code are required.' });
    }

    const cleanCode = String(code).trim().toUpperCase();
    const existing = await Plan.findOne({ code: cleanCode });
    if (existing) {
      return res.status(400).json({ success: false, message: `Plan with code ${cleanCode} already exists.` });
    }

    const newPlan = await Plan.create({
      customId: 'PLN-' + Math.random().toString(36).substring(2, 7).toUpperCase(),
      name,
      code: cleanCode,
      description: description || '',
      billingType: billingType || 'Monthly',
      basePrice: Number(basePrice) || 0,
      gstPercent: Number(gstPercent) || 18,
      includes: Array.isArray(includes) ? includes : [],
      deliverablesQuota: deliverablesQuota || { creatives: 4, aiReels: 4, festival: true },
      content: content || { creatives: 4, shorts: 4, festivalContent: 1 },
      isActive: true
    });

    res.status(201).json({ success: true, message: `Plan "${newPlan.name}" created successfully.`, data: newPlan });
  } catch (err) {
    next(err);
  }
};

export const updatePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const plan = await Plan.findOneAndUpdate(findByIdOrCustomId(id), updates, { new: true });
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found.' });
    }
    res.json({ success: true, message: `Plan "${plan.name}" updated.`, data: plan });
  } catch (err) {
    next(err);
  }
};

// ==========================================
// 2. CLIENTS CONTROLLERS
// ==========================================
export const getClients = async (req, res, next) => {
  try {
    const { status, source, owner, search, includeArchived } = req.query;
    const user = req.user;
    const userRole = (user?.role || '').toLowerCase();
    const isLeadOrAdmin = userRole === 'superadmin' || userRole === 'administrator' || userRole === 'sales_lead';

    const filter = {};
    if (!includeArchived || includeArchived === 'false') {
      filter.isArchived = { $ne: true };
    }

    // Role data scoping: Sales sees only own clients unless Admin / Sales Lead
    if (!isLeadOrAdmin && user?.id) {
      filter.$or = [
        { ownerId: user.id },
        { ownerName: user.name },
        { manager: user.name },
        { ownerId: { $in: ['', null] } } // unassigned clients visible
      ];
    }

    if (status && status !== 'all') {
      filter.status = status;
    }
    if (source && source !== 'all') {
      filter.source = source;
    }
    if (owner && owner !== 'all') {
      filter.$or = [{ ownerId: owner }, { ownerName: owner }];
    }
    if (search) {
      const q = new RegExp(search.trim(), 'i');
      filter.$or = [
        { companyName: q },
        { company: q },
        { displayName: q },
        { 'contacts.name': q },
        { 'contacts.email': q },
        { 'contacts.phone': q },
        { gstin: q }
      ];
    }

    const clients = await Client.find(filter).sort({ updatedAt: -1 });

    // Aggregate LTV (sum of all paid amounts) and open deals count for each client
    const clientIds = clients.map((c) => c.customId || c._id.toString());
    const deals = await Deal.find({ clientId: { $in: clientIds } });
    const payments = await Payment.find({ clientId: { $in: clientIds } });

    const enrichedClients = clients.map((client) => {
      const cId = client.customId || client._id.toString();
      const clientDeals = deals.filter((d) => d.clientId === cId);
      const clientPayments = payments.filter((p) => p.clientId === cId);

      const openDealsCount = clientDeals.filter(
        (d) => d.status !== 'Converted' && d.status !== 'Lost'
      ).length;
      const ltvAmount = clientPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);

      const primaryContact =
        (client.contacts && client.contacts.find((c) => c.isPrimary)) ||
        (client.contacts && client.contacts[0]) ||
        { name: client.contact || 'No Contact', email: '', phone: '' };

      const cObj = client.toJSON();
      return {
        ...cObj,
        primaryContact,
        openDealsCount,
        ltvAmount,
        ltv: formatINR(ltvAmount),
        dealsCount: clientDeals.length
      };
    });

    res.json({ success: true, data: enrichedClients });
  } catch (err) {
    next(err);
  }
};

export const getClientById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const client = await Client.findOne(findByIdOrCustomId(id));
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found.' });
    }

    const cId = client.customId || client._id.toString();
    const deals = await Deal.find({ clientId: cId }).sort({ createdAt: -1 });
    const payments = await Payment.find({ clientId: cId }).sort({ paidOn: -1 });
    const projects = await Project.find({
      $or: [
        { client: client.companyName || client.company },
        { companyName: client.companyName || client.company },
        { brandName: client.displayName || client.companyName }
      ]
    }).select('-dailyLogs');

    const ltvAmount = payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);

    res.json({
      success: true,
      data: {
        ...client.toJSON(),
        ltvAmount,
        ltv: formatINR(ltvAmount),
        deals,
        payments,
        projects
      }
    });
  } catch (err) {
    next(err);
  }
};

export const createClient = async (req, res, next) => {
  try {
    const {
      companyName,
      displayName,
      type,
      industry,
      gstin,
      pan,
      billingAddress,
      shippingAddress,
      website,
      source,
      ownerId,
      ownerName,
      status,
      contacts,
      notes,
      overrideDuplicate,
      duplicateReason
    } = req.body;

    if (!companyName || !companyName.trim()) {
      return res.status(400).json({ success: false, message: 'Company Name is required.' });
    }

    const cleanCompany = companyName.trim();
    const cleanGstin = (gstin || '').trim().toUpperCase();
    const contactList = Array.isArray(contacts) ? contacts : [];

    if (contactList.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one contact person is required.' });
    }

    // Ensure at least one primary contact
    if (!contactList.some((c) => c.isPrimary)) {
      contactList[0].isPrimary = true;
    }

    // Duplicate Check Guard
    if (!overrideDuplicate) {
      const duplicateConditions = [{ companyName: new RegExp(`^${cleanCompany}$`, 'i') }];
      if (cleanGstin) {
        duplicateConditions.push({ gstin: cleanGstin });
      }

      const emails = contactList.map((c) => (c.email || '').trim().toLowerCase()).filter(Boolean);
      const phones = contactList.map((c) => (c.phone || '').trim()).filter(Boolean);

      if (emails.length > 0) {
        duplicateConditions.push({ 'contacts.email': { $in: emails } });
      }
      if (phones.length > 0) {
        duplicateConditions.push({ 'contacts.phone': { $in: phones } });
      }

      const existingClient = await Client.findOne({ $or: duplicateConditions, isArchived: { $ne: true } });
      if (existingClient) {
        let matchField = 'company name';
        if (cleanGstin && existingClient.gstin === cleanGstin) matchField = 'GSTIN';
        return res.status(409).json({
          success: false,
          isDuplicate: true,
          duplicateClientId: existingClient.customId || existingClient._id.toString(),
          message: `A client with matching ${matchField} already exists: "${existingClient.companyName || existingClient.company}". You can override with a reason if this is intentional.`
        });
      }
    }

    const assignedOwnerId = ownerId || req.user?.id || '';
    const assignedOwnerName = ownerName || req.user?.name || 'Sales Executive';

    const newClient = await Client.create({
      customId: 'c_' + Math.random().toString(36).substring(2, 9),
      companyName: cleanCompany,
      company: cleanCompany,
      displayName: displayName || cleanCompany,
      type: type || 'Company',
      industry: industry || '',
      gstin: cleanGstin,
      pan: (pan || '').trim().toUpperCase(),
      billingAddress: billingAddress || {},
      shippingAddress: shippingAddress || billingAddress || {},
      website: website || '',
      source: source || 'Inbound',
      ownerId: assignedOwnerId,
      ownerName: assignedOwnerName,
      manager: assignedOwnerName,
      status: status || 'Lead',
      contacts: contactList,
      notes: notes || (duplicateReason ? `[Duplicate Override Note: ${duplicateReason}]` : ''),
      isArchived: false,
      contact: contactList[0]?.name || ''
    });

    broadcastRealtimeUpdate('CLIENT_UPDATED', { client: newClient });
    res.status(201).json({
      success: true,
      message: `Client "${newClient.companyName}" created successfully!`,
      data: newClient
    });
  } catch (err) {
    next(err);
  }
};

export const updateClient = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id || id === 'undefined' || id === 'null') {
      return res.status(400).json({ success: false, message: 'Valid Client ID is required for update.' });
    }
    const updates = { ...req.body };

    const existingClient = await Client.findOne(findByIdOrCustomId(id));
    if (!existingClient) {
      return res.status(404).json({ success: false, message: 'Client not found.' });
    }
    const prevCompanyName = existingClient.companyName || existingClient.company || '';

    if (updates.companyName) {
      updates.company = updates.companyName;
    }
    if (updates.displayName && !updates.brandName) {
      updates.brandName = updates.displayName;
    } else if (updates.brandName && !updates.displayName) {
      updates.displayName = updates.brandName;
    }
    if (updates.contacts && updates.contacts.length > 0) {
      const primary = updates.contacts.find((c) => c.isPrimary) || updates.contacts[0];
      if (primary) updates.contact = primary.name;
    }

    const updated = await Client.findOneAndUpdate(
      findByIdOrCustomId(id),
      { $set: updates },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Client not found.' });
    }

    // Bidirectional sync to linked SalesContracts, Projects, Deals, Payments, and Invoices
    await syncClientToLinkedEntities(updated, updates, prevCompanyName);

    broadcastRealtimeUpdate('CLIENT_UPDATED', { client: updated });
    res.json({ success: true, message: `Client "${updated.companyName}" updated successfully.`, data: updated });
  } catch (err) {
    next(err);
  }
};

export const deleteClient = async (req, res, next) => {
  try {
    const { id } = req.params;
    const client = await Client.findOne(findByIdOrCustomId(id));
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found.' });
    }

    const cId = client.customId || client._id.toString();
    const mongoId = client._id.toString();
    const compName = (client.companyName || client.company || '').trim();

    // 1. Locate all contracts belonging to this client
    const contractConditions = [
      { clientId: { $in: [cId, mongoId] } }
    ];
    if (compName) {
      contractConditions.push({ companyName: new RegExp('^' + escapeRegExp(compName) + '$', 'i') });
    }

    const linkedContracts = await SalesContract.find({ $or: contractConditions });

    // 2. Remove contracts from the sales sheet (mark deleted & inactive)
    if (linkedContracts.length > 0) {
      await SalesContract.updateMany(
        { $or: contractConditions },
        { $set: { isDeleted: true, isActive: false } }
      );

      // Clean up linked invoices
      const invNumbers = linkedContracts.map(c => c.invoiceNumber).filter(Boolean);
      if (invNumbers.length > 0) {
        await Invoice.deleteMany({
          $or: [
            { customId: { $in: invNumbers } },
            { invoiceNumber: { $in: invNumbers } }
          ]
        }).catch(() => {});
      }

      // Broadcast real-time deletion events for each contract to immediately clear from sheet
      for (const contract of linkedContracts) {
        broadcastRealtimeUpdate('CONTRACT_DELETED', {
          id: contract._id.toString(),
          contractId: contract._id.toString(),
          customId: contract.customId
        });
      }
    }

    const dealsCount = await Deal.countDocuments({ clientId: cId });

    if (dealsCount > 0) {
      client.isArchived = true;
      await client.save();
      broadcastRealtimeUpdate('CLIENT_UPDATED', { client });
      return res.json({
        success: true,
        archived: true,
        message: `Client "${client.companyName}" archived and ${linkedContracts.length} contract(s) removed from sales sheet.`
      });
    }

    await Client.deleteOne({ _id: client._id });
    broadcastRealtimeUpdate('CLIENT_DELETED', { id, client });
    res.json({
      success: true,
      message: `Client "${client.companyName}" deleted and ${linkedContracts.length} contract(s) removed from sales sheet.`
    });
  } catch (err) {
    next(err);
  }
};

// ==========================================
// 3. DEALS CONTROLLERS
// ==========================================
export const getDeals = async (req, res, next) => {
  try {
    const { status, owner, clientId, search } = req.query;
    const user = req.user;
    const userRole = (user?.role || '').toLowerCase();
    const isLeadOrAdmin = userRole === 'superadmin' || userRole === 'administrator' || userRole === 'sales_lead';

    const filter = {};

    // Scoping: Sales sees only own deals unless Admin/Lead
    if (!isLeadOrAdmin && user?.id) {
      filter.$or = [{ ownerId: user.id }, { ownerName: user.name }];
    }

    if (status && status !== 'all') {
      filter.status = status;
    }
    if (owner && owner !== 'all') {
      filter.$or = [{ ownerId: owner }, { ownerName: owner }];
    }
    if (clientId) {
      filter.clientId = clientId;
    }
    if (search) {
      const q = new RegExp(search.trim(), 'i');
      filter.$or = [{ title: q }, { dealCode: q }, { clientName: q }];
    }

    const deals = await Deal.find(filter).sort({ createdAt: -1 });

    // Enrich deals with paid totals and balance calculations
    const dealIds = deals.map((d) => d.customId || d._id.toString());
    const payments = await Payment.find({ dealId: { $in: dealIds } });

    const enriched = deals.map((deal) => {
      const dId = deal.customId || deal._id.toString();
      const dPayments = payments.filter((p) => p.dealId === dId);
      const paidAmount = dPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      const totalAmount = Number(deal.total) || 0;
      const balanceAmount = Math.max(0, totalAmount - paidAmount);
      const { discountAmount, discountLabel } = computeDealDiscount(deal);

      return {
        ...deal.toJSON(),
        discountAmount,
        discountLabel,
        paidAmount,
        paid: formatINR(paidAmount),
        balanceAmount,
        balance: formatINR(balanceAmount),
        paymentsCount: dPayments.length
      };
    });

    res.json({ success: true, data: enriched });
  } catch (err) {
    next(err);
  }
};

export const getPayments = async (req, res, next) => {
  try {
    const { dealId, clientId } = req.query;
    const filter = {};
    if (dealId) filter.dealId = dealId;
    if (clientId) filter.clientId = clientId;
    const payments = await Payment.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: payments });
  } catch (err) {
    next(err);
  }
};

export const getDealById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deal = await Deal.findOne(findByIdOrCustomId(id));
    if (!deal) {
      return res.status(404).json({ success: false, message: 'Deal not found.' });
    }

    const dId = deal.customId || deal._id.toString();
    const payments = await Payment.find({ dealId: dId }).sort({ paidOn: -1 });
    const paidAmount = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const totalAmount = Number(deal.total) || 0;
    const balanceAmount = Math.max(0, totalAmount - paidAmount);
    const { discountAmount, discountLabel } = computeDealDiscount(deal);

    let linkedProject = null;
    if (deal.projectId) {
      linkedProject = await Project.findOne(findByIdOrCustomId(deal.projectId)).select(
        'name companyName handoffStatus status accountManager assignedAmName assignedAmAt startDate deadline budget progress deliverablesQuota content'
      );
    }

    const client = await Client.findOne(findByIdOrCustomId(deal.clientId));

    res.json({
      success: true,
      data: {
        ...deal.toJSON(),
        discountAmount,
        discountLabel,
        paidAmount,
        paid: formatINR(paidAmount),
        balanceAmount,
        balance: formatINR(balanceAmount),
        payments,
        linkedProject,
        client
      }
    });
  } catch (err) {
    next(err);
  }
};

export const createDeal = async (req, res, next) => {
  try {
    const {
      clientId,
      title,
      planId,
      customLineItems,
      discountType,
      discountValue,
      expectedCloseDate,
      ownerId,
      ownerName,
      planSnapshot: customPlanSnapshot,
      branch,
      vertical,
      closingType,
      invoiceNumber,
      gstNumber,
      tanNumber,
      remarks
    } = req.body;

    if (!clientId) {
      return res.status(400).json({ success: false, message: 'Client is required.' });
    }
    if (!title) {
      return res.status(400).json({ success: false, message: 'Deal Title is required.' });
    }

    const client = await Client.findOne(findByIdOrCustomId(clientId));
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client record not found.' });
    }

    let planSnapshot = null;
    let basePrice = 0;

    if (planId) {
      const plan = await Plan.findOne(findByIdOrCustomId(planId));
      if (plan) {
        planSnapshot = {
          planId: plan.customId || plan._id.toString(),
          name: plan.name,
          code: plan.code,
          category: plan.category,
          description: plan.description,
          billingType: req.body.billingCycle || plan.billingType,
          basePrice: customPlanSnapshot?.basePrice !== undefined ? customPlanSnapshot.basePrice : plan.basePrice,
          gstPercent: plan.gstPercent || 18,
          includes: plan.includes,
          deliverablesQuota: plan.deliverablesQuota,
          content: plan.content
        };
        basePrice = planSnapshot.basePrice;
      }
    } else if (customPlanSnapshot) {
      planSnapshot = {
        ...customPlanSnapshot,
        billingType: req.body.billingCycle || customPlanSnapshot.billingType
      };
      basePrice = planSnapshot.basePrice || 0;
    }

    const lineItems = Array.isArray(customLineItems)
      ? customLineItems.map((item) => {
          const qty = Number(item.quantity) || 1;
          const uPrice = Number(item.unitPrice) || 0;
          return {
            description: item.description || 'Custom Deliverable',
            quantity: qty,
            unitPrice: uPrice,
            amount: qty * uPrice
          };
        })
      : [];

    const lineItemsTotal = lineItems.reduce((acc, item) => acc + item.amount, 0);
    const subtotal = (Number(basePrice) || 0) + lineItemsTotal;

    let discount = 0;
    const discVal = Number(discountValue) || 0;
    if (discountType === 'percentage') {
      discount = Math.round((subtotal * discVal) / 100);
    } else {
      discount = discVal;
    }
    discount = Math.min(subtotal, Math.max(0, discount));

    const taxableAmount = Math.max(0, subtotal - discount);
    const gstPercent = 18;
    const gstAmount = Math.round((taxableAmount * gstPercent) / 100);
    const total = taxableAmount + gstAmount;

    // Generate unique sequential dealCode: DL-YYYY-XXXX
    const currentYear = new Date().getFullYear();
    const dealCount = await Deal.countDocuments();
    const dealSeq = String(dealCount + 1).padStart(4, '0');
    const dealCode = `DL-${currentYear}-${dealSeq}`;

    const assignedOwnerId = ownerId || req.user?.id || '';
    const assignedOwnerName = ownerName || req.user?.name || 'Sales Executive';

    const {
      addToProject = false,
      generatePI = true,
      sendClientEmail = true,
      paymentDone = false,
      amountPaid = 0,
      paymentMode = 'UPI',
      paymentRef = '',
      projectName = '',
      kickoffNotes = '',
      tdsPercent = 0,
      paymentType = 'Full',
      websiteUrl,
      domainAccount = 'Our Account',
      domainProvider = '',
      domainPurchaseDate = '',
      domainDurationYears = 1
    } = req.body;

    const dealStatus = (addToProject && paymentDone) ? 'Converted' : (addToProject ? 'Converted' : 'Draft');

    const newDeal = await Deal.create({
      customId: 'd_' + Math.random().toString(36).substring(2, 9),
      dealCode,
      clientId: client.customId || client._id.toString(),
      clientName: client.companyName || client.company,
      brandName: req.body.brandName || client.displayName || client.brandName || client.companyName || client.company || '',
      title,
      ownerId: assignedOwnerId,
      ownerName: assignedOwnerName,
      planId: planId || '',
      planSnapshot,
      customLineItems: lineItems,
      discountType: discountType || 'fixed',
      discountValue: discVal,
      discountAmount: discount,
      subtotal,
      gstPercent,
      gstAmount,
      total,
      currency: 'INR',
      expectedCloseDate: expectedCloseDate || '',
      websiteUrl: websiteUrl || client?.website || '',
      domainAccount: domainAccount || 'Our Account',
      status: dealStatus,
      activity: [
        {
          actor: req.user?.name || 'Sales Executive',
          from: '',
          to: dealStatus,
          time: new Date(),
          note: `Deal created with total value ${formatINR(total)}.${addToProject ? ' Added to Production Project queue.' : ''}`
        }
      ]
    });

    const dealId = newDeal.customId || newDeal._id.toString();
    let createdProject = null;
    let createdDocument = null;
    let emailSent = false;
    const clientEmail = client.primaryContact?.email || client.email || '';
    const clientPhone = client.primaryContact?.phone || client.phone || '';
    const clientContactName = client.primaryContact?.name || client.contact || client.companyName || client.company;

    // Optional: Record initial payment if payment is marked as done
    if (paymentDone && (Number(amountPaid) > 0 || total > 0)) {
      const paidVal = Number(amountPaid) > 0 ? Number(amountPaid) : total;
      await Payment.create({
        customId: 'pay_' + Math.random().toString(36).substring(2, 9),
        dealId,
        dealCode: newDeal.dealCode,
        clientId: client.customId || client._id.toString(),
        clientName: client.companyName || client.company,
        amount: paidVal,
        mode: paymentMode || 'UPI',
        reference: paymentRef || `UTR-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
        paidOn: new Date().toISOString().split('T')[0],
        recordedBy: req.user?.name || 'Sales Executive',
        recordedById: req.user?.id || '',
        notes: 'Initial payment recorded during deal creation.'
      });
    }

    // Auto-create & Add to Project for Production Admin
    if (addToProject) {
      const effBrandName = req.body.brandName || client.displayName || client.brandName || client.companyName || client.company;
      const effCompanyName = client.companyName || client.company;
      const effectiveProjectName = projectName && projectName.trim() ? projectName.trim() : `${effBrandName} Campaign`;
      const billingType = planSnapshot?.billingType || 'Monthly';
      const todayStr = expectedCloseDate || new Date().toISOString().split('T')[0];

      // Calculate Next Renewal Date
      let computedNextRenewal = todayStr;
      const billNorm = billingType.toUpperCase();
      const refDate = new Date(todayStr);
      if (billNorm.includes('QUARTER')) refDate.setMonth(refDate.getMonth() + 3);
      else if (billNorm.includes('HALF') || billNorm.includes('6')) refDate.setMonth(refDate.getMonth() + 6);
      else if (billNorm.includes('ANNUAL') || billNorm.includes('YEAR')) refDate.setFullYear(refDate.getFullYear() + 1);
      else if (billNorm.includes('ONE-TIME') || billNorm.includes('ONETIME')) refDate.setFullYear(refDate.getFullYear() + 1);
      else if (billNorm.includes('WEEK')) refDate.setDate(refDate.getDate() + 7);
      else refDate.setMonth(refDate.getMonth() + 1);
      computedNextRenewal = refDate.toISOString().split('T')[0];

      const isWebsitePlan = Boolean(
        (planSnapshot?.name && planSnapshot.name.toLowerCase().includes('website')) ||
        (title && title.toLowerCase().includes('website'))
      );
      const defaultCreatives = isWebsitePlan ? 0 : 4;
      const defaultReels = isWebsitePlan ? 0 : 4;

      const quota = planSnapshot?.deliverablesQuota || {
        creatives: defaultCreatives,
        carousels: 0,
        aiReels: defaultReels,
        basicReels: 0,
        longVideos: 0,
        festival: !isWebsitePlan,
        blogs: 0,
        gmb: false
      };

      const content = planSnapshot?.content || {
        creatives: quota.creatives !== undefined ? Number(quota.creatives) : defaultCreatives,
        carousels: quota.carousels !== undefined ? Number(quota.carousels) : 0,
        shorts: quota.aiReels !== undefined ? Number(quota.aiReels) : defaultReels,
        aiVideos: 0,
        longVideos: quota.longVideos !== undefined ? Number(quota.longVideos) : 0,
        festivalContent: quota.festival ? 1 : 0,
        blogs: quota.blogs !== undefined ? Number(quota.blogs) : 0
      };

      // Check if project already exists for this client / company to prevent duplication
      const existingProject = await Project.findOne({
        $or: [
          { companyName: new RegExp(`^${effCompanyName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          { name: new RegExp(`^${effCompanyName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i') },
          { client: new RegExp(`^${effCompanyName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          { clientId: client.customId || client._id.toString() }
        ]
      });

      if (existingProject) {
        createdProject = existingProject;
        newDeal.projectId = existingProject.customId || existingProject._id.toString();
        await newDeal.save();
      } else {
        createdProject = await Project.create({
          customId: 'proj_' + Math.random().toString(36).substring(2, 9),
          name: effectiveProjectName,
          companyName: effCompanyName,
          brandName: effBrandName,
          clientName: clientContactName,
          clientPhone: clientPhone,
          clientEmail: clientEmail,
          clientAddress: client.address || {},
          clientId: client.customId || client._id.toString(),
          client: effCompanyName,
          sourceDealId: dealId,
          soldPlanName: planSnapshot?.name || title,
          soldPlanCode: planSnapshot?.code || '',
          planSnapshot: planSnapshot,
          planDuration: billingType,
          budget: String(total),
          startDate: todayStr,
          renewalDate: todayStr,
          nextRenewalDate: computedNextRenewal,
          renewalStatus: 'NEW',
          handoffStatus: 'Awaiting Admin Assignment',
          assignedAmId: null,
          assignedAmName: 'Unassigned',
          accountManager: 'Unassigned',
          productionManager: 'Unassigned',
          graphicDesigner: 'Unassigned',
          videoEditor: 'Unassigned',
          assignedMembers: [],
          websiteUrl: websiteUrl || client?.website || '',
          domainAccount: domainAccount || 'Our Account',
          domainProvider: domainProvider || '',
          domainPurchaseDate: domainPurchaseDate || '',
          domainDurationYears: Number(domainDurationYears) || 1,
          kickoffNotes: kickoffNotes || `Created via Sales Deal ${newDeal.dealCode}. Plan: ${planSnapshot?.name || title}`,
          deliverablesQuota: quota,
          content: content,
          activity: [
            {
              date: todayStr,
              event: `Project spawned from Sales Deal ${newDeal.dealCode} by ${req.user?.name || 'Sales Executive'}. Handoff status: Awaiting Admin Assignment.`
            }
          ]
        });
      }

      // Save Proforma Invoice (PI) Document in Project Documents
      if (generatePI) {
        createdDocument = await Document.create({
          customId: 'doc_' + Math.random().toString(36).substring(2, 9),
          name: `Proforma Invoice (PI) - ${newDeal.dealCode}.pdf`,
          folder: 'Contracts',
          size: '142 KB',
          uploadedBy: req.user?.name || 'Sales Executive',
          date: todayStr,
          projectId: createdProject.customId || createdProject._id.toString(),
          clientId: client.customId || client._id.toString(),
          dealId: newDeal.dealCode,
          docType: 'proforma_invoice',
          dataSnapshot: {
            dealCode: newDeal.dealCode,
            title: newDeal.title,
            clientName: effCompanyName,
            brandName: effBrandName,
            contactName: clientContactName,
            email: clientEmail,
            phone: clientPhone,
            subtotal,
            gstPercent,
            gstAmount,
            total,
            planName: planSnapshot?.name || title,
            lineItems: lineItems
          }
        });
      }

      // Auto-create SalesContract entry for Master Sales Sheet syncing
      try {
        const contractCount = await SalesContract.countDocuments();
        const amtReleasedWithoutGst = (Number(amountPaid) || 0) / (1 + (gstPercent / 100));
        
        let slices = 1;
        const pCycle = String(billingType || '').toUpperCase();
        if (pCycle.includes('QUARTER')) slices = 3;
        else if (pCycle.includes('HALF') || pCycle.includes('6')) slices = 6;
        
        const numTds = Number(tdsPercent) || 0;
        const tdsTotalAmount = Math.round((taxableAmount * numTds) / 100);
        const calcPayable = Math.max(0, total - tdsTotalAmount);
        const fcv = (taxableAmount || basePrice || total) / slices;
        const amtwGst = (Number(amountPaid) || 0) / slices;
        const amtWoGst = amtReleasedWithoutGst / slices;
        const amtAftTds = amtWoGst;
        const balPay = Math.max(0, calcPayable - (Number(amountPaid) || 0)) / slices;
        const planPr = (basePrice || total) / slices;
        const computedPayType = paymentType || (balPay > 0 ? 'Partial' : 'Full');
        
        const baseDate = new Date(todayStr);

        for (let i = 0; i < slices; i++) {
          const sliceDate = new Date(baseDate);
          sliceDate.setMonth(sliceDate.getMonth() + i);
          const sliceDateStr = sliceDate.toISOString().split('T')[0];

          let nextRenDateStr = '';
          const isOneTime = pCycle.includes('ONE TIME') || pCycle.includes('1TIME');
          if (isOneTime) {
            const planNameLower = String(planSnapshot?.name || title || '').toLowerCase();
            if (planNameLower.includes('web') || planNameLower.includes('hosting')) {
               const nextRenDate = new Date(sliceDate);
               nextRenDate.setFullYear(nextRenDate.getFullYear() + 1);
               nextRenDateStr = nextRenDate.toISOString().split('T')[0];
            }
          } else {
            const nextRenDate = new Date(sliceDate);
            nextRenDate.setMonth(nextRenDate.getMonth() + 1);
            nextRenDateStr = nextRenDate.toISOString().split('T')[0];
          }

          const scCustomId = 'sc_' + Math.random().toString(36).substring(2, 9);
          
          await SalesContract.create({
            customId: scCustomId,
            srNo: contractCount + 1 + i,
            month: sliceDate.toLocaleString('default', { month: 'long' }),
            year: sliceDate.getFullYear(),
            dateOfSales: sliceDateStr,
            dateOfLogin: sliceDateStr,
            companyName: effCompanyName,
            brandName: effBrandName,
            fullContractValue: fcv,
            amountReleasedWithGst: amtwGst,
            amountReleasedWithoutGst: amtWoGst,
            amountReleasedAfterTds: amtAftTds,
            balancePayment: balPay,
            tdsPercent: numTds,
            tdsAmount: tdsTotalAmount / slices,
            totalPayable: calcPayable / slices,
            paymentType: computedPayType,
            tds: numTds > 0 ? `${numTds}%` : '0%',
            paymentCycle: isOneTime ? 'One-Time' : 'Monthly',
            modeOfPayment: paymentMode || 'UPI',
            paymentRefNo: i === 0 ? (paymentRef || '') : '',
            renewalDate: nextRenDateStr,
            contractType: isOneTime ? 'ONE TIME' : (i === 0 ? 'NEW' : 'RENEWAL'),
            plan: planSnapshot?.name || title,
            planPrice: planPr,
            customerName: clientContactName,
            customerPhone: clientPhone,
            email: clientEmail,
            clientId: client.customId || client._id.toString(),
            dealId: newDeal.dealCode,
            projectId: createdProject.customId || createdProject._id.toString(),
            branch: branch || 'Rohini',
            vertical: vertical || 'PRITTAL',
            closingType: closingType || 'Self closure',
            invoiceNumber: invoiceNumber || '',
            gstNumber: gstNumber || '',
            tanNumber: tanNumber || 'NA',
            remarks: remarks || '',
            soldBy: assignedOwnerName
          });
        }
      } catch (scErr) {
        console.warn('Failed to auto-create SalesContract:', scErr.message);
      }


      // Notify Production Administrators
      try {
        const adminUsers = await User.find({
          $or: [
            { role: { $in: ['superadmin', 'administrator', 'production_admin', 'production_manager'] } },
            { department: { $in: ['Production', 'production', 'Operations'] } }
          ]
        });

        for (const adm of adminUsers) {
          await Notification.create({
            userId: adm.customId || adm.username || adm.email || adm._id.toString(),
            title: '⚡ New Client Deal Onboarded (Needs AM)',
            message: `Deal ${newDeal.dealCode} for "${effBrandName}" has been converted to Project "${createdProject.name}". Please assign an Account Manager.`,
            type: 'project_handoff',
            metadata: {
              projectId: createdProject.customId,
              dealId: newDeal.customId,
              brandName: effBrandName
            }
          });
        }
      } catch (notifyErr) {
        console.warn('Failed to send admin notifications:', notifyErr.message);
      }

      // Auto-dispatch Proforma Invoice Email notification to client
      if (sendClientEmail && clientEmail) {
        emailSent = true;
        createdProject.activity.push({
          date: todayStr,
          event: `Proforma Invoice (PI) and Project Kickoff brief automatically dispatched to client at ${clientEmail}.`
        });
        await createdProject.save();
      }
    }

    broadcastRealtimeUpdate('DEAL_UPDATED', { deal: newDeal, project: createdProject });
    res.status(201).json({
      success: true,
      message: `Deal ${newDeal.dealCode} created successfully!${addToProject ? ' Project added for Production Admin assignment.' : ''}`,
      data: {
        deal: newDeal,
        project: createdProject,
        document: createdDocument,
        emailSent,
        clientEmail
      }
    });
  } catch (err) {
    next(err);
  }
};

export const updateDeal = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deal = await Deal.findOne(findByIdOrCustomId(id));
    if (!deal) {
      return res.status(404).json({ success: false, message: 'Deal not found.' });
    }

    const dId = deal.customId || deal._id.toString();
    const paymentsCount = await Payment.countDocuments({ dealId: dId });

    const {
      title,
      clientName,
      ownerName,
      remarks,
      paidAmount,
      planId,
      customLineItems,
      discountType,
      discountValue,
      expectedCloseDate,
      status,
      lostReason
    } = req.body;

    // Rule: After first successful payment, plan and line items freeze!
    if (paymentsCount > 0 && (planId !== undefined || customLineItems !== undefined || discountValue !== undefined)) {
      return res.status(400).json({
        success: false,
        message: 'Plan setup and commercial line items are frozen because payments have been recorded for this deal. To adjust, clone the deal or contact Admin.'
      });
    }

    if (title) deal.title = title;
    if (clientName) deal.clientName = clientName;
    if (ownerName) deal.ownerName = ownerName;
    if (remarks !== undefined) deal.remarks = remarks;
    if (paidAmount !== undefined) deal.paidAmount = Number(paidAmount) || 0;
    if (expectedCloseDate !== undefined) deal.expectedCloseDate = expectedCloseDate;

    if (paymentsCount === 0) {
      if (planId !== undefined && planId !== deal.planId) {
        deal.planId = planId;
        if (planId) {
          const plan = await Plan.findOne(findByIdOrCustomId(planId));
          if (plan) {
            deal.planSnapshot = {
              planId: plan.customId || plan._id.toString(),
              name: plan.name,
              code: plan.code,
              category: plan.category,
              description: plan.description,
              billingType: plan.billingType,
              basePrice: plan.basePrice,
              gstPercent: plan.gstPercent || 18,
              includes: plan.includes,
              deliverablesQuota: plan.deliverablesQuota,
              content: plan.content
            };
          }
        } else {
          deal.planSnapshot = null;
        }
      }

      if (customLineItems !== undefined) {
        deal.customLineItems = customLineItems.map((item) => {
          const qty = Number(item.quantity) || 1;
          const uPrice = Number(item.unitPrice) || 0;
          return {
            description: item.description || 'Custom Deliverable',
            quantity: qty,
            unitPrice: uPrice,
            amount: qty * uPrice
          };
        });
      }

      if (discountType !== undefined) deal.discountType = discountType;
      if (discountValue !== undefined) deal.discountValue = Number(discountValue) || 0;

      // Recalculate totals
      const basePrice = deal.planSnapshot ? Number(deal.planSnapshot.basePrice) || 0 : 0;
      const lineItemsTotal = deal.customLineItems.reduce((acc, item) => acc + item.amount, 0);
      deal.subtotal = basePrice + lineItemsTotal;

      let discount = 0;
      if (deal.discountType === 'percentage') {
        discount = Math.round((deal.subtotal * deal.discountValue) / 100);
      } else {
        discount = deal.discountValue;
      }
      discount = Math.min(deal.subtotal, Math.max(0, discount));
      deal.discountAmount = discount;

      const taxable = Math.max(0, deal.subtotal - discount);
      deal.gstAmount = Math.round((taxable * deal.gstPercent) / 100);
      deal.total = taxable + deal.gstAmount;
    }

    if (status && status !== deal.status) {
      if (status === 'Lost' && (!lostReason || !lostReason.trim())) {
        return res.status(400).json({ success: false, message: 'Lost reason is required when marking a deal as Lost.' });
      }
      const prevStatus = deal.status;
      deal.status = status;
      if (lostReason) deal.lostReason = lostReason;
      deal.activity.push({
        actor: req.user?.name || 'Sales Executive',
        from: prevStatus,
        to: status,
        time: new Date(),
        note: lostReason ? `Status changed to ${status}. Reason: ${lostReason}` : `Status updated to ${status}.`
      });
    }

    await deal.save();
    broadcastRealtimeUpdate('DEAL_UPDATED', { deal });
    res.json({ success: true, message: `Deal ${deal.dealCode} updated successfully.`, data: deal });
  } catch (err) {
    next(err);
  }
};

export const updateDealStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, lostReason, note } = req.body;

    const deal = await Deal.findOne(findByIdOrCustomId(id));
    if (!deal) {
      return res.status(404).json({ success: false, message: 'Deal not found.' });
    }

    if (status === 'Lost' && (!lostReason || !lostReason.trim())) {
      return res.status(400).json({ success: false, message: 'A reason is required when marking a deal as Lost.' });
    }

    const prevStatus = deal.status;
    deal.status = status;
    if (lostReason) deal.lostReason = lostReason;

    deal.activity.push({
      actor: req.user?.name || 'Sales Executive',
      from: prevStatus,
      to: status,
      time: new Date(),
      note: note || (lostReason ? `Reason: ${lostReason}` : `Deal status changed to ${status}`)
    });

    await deal.save();
    broadcastRealtimeUpdate('DEAL_UPDATED', { deal });
    res.json({ success: true, message: `Deal status updated to ${status}`, data: deal });
  } catch (err) {
    next(err);
  }
};

// ==========================================
// 4. PAYMENTS CONTROLLERS
// ==========================================
export const recordPayment = async (req, res, next) => {
  try {
    const { dealId } = req.params;
    const { amount, mode, reference, paidOn, proofUrl, notes } = req.body;

    const deal = await Deal.findOne(findByIdOrCustomId(dealId));
    if (!deal) {
      return res.status(404).json({ success: false, message: 'Deal not found.' });
    }

    const dId = deal.customId || deal._id.toString();
    const existingPayments = await Payment.find({ dealId: dId });
    const currentPaid = existingPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const balance = Math.max(0, deal.total - currentPaid);

    const paymentAmount = Number(amount);
    if (!paymentAmount || paymentAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Payment amount must be greater than 0.' });
    }

    // Overpayment check
    if (paymentAmount > balance) {
      return res.status(400).json({
        success: false,
        message: `Payment of ${formatINR(paymentAmount)} exceeds remaining balance ${formatINR(balance)}. Overpayment is not allowed.`
      });
    }

    const newPayment = await Payment.create({
      customId: 'pay_' + Math.random().toString(36).substring(2, 9),
      dealId: dId,
      dealCode: deal.dealCode,
      clientId: deal.clientId,
      clientName: deal.clientName,
      amount: paymentAmount,
      mode: mode || 'UPI',
      reference: reference || '',
      paidOn: paidOn || new Date().toISOString().split('T')[0],
      proofUrl: proofUrl || '',
      recordedBy: req.user?.name || 'Sales Executive',
      recordedById: req.user?.id || '',
      notes: notes || ''
    });

    // Derive new status based on sum of payments
    const newTotalPaid = currentPaid + paymentAmount;
    let newDealStatus = deal.status;

    if (deal.status !== 'Converted') {
      if (newTotalPaid >= deal.total) {
        newDealStatus = 'Paid';
      } else if (newTotalPaid > 0) {
        newDealStatus = 'Partially Paid';
      }
    }

    // Fetch Client and Sales Rep details for email and notifications
    const client = await Client.findOne(findByIdOrCustomId(deal.clientId));
    let salesRepUser = null;
    if (deal.ownerId) {
      salesRepUser = await User.findOne(findByIdOrCustomId(deal.ownerId));
    }
    const salesRep = {
      name: salesRepUser?.name || deal.ownerName || req.user?.name || 'Sales Executive',
      email: salesRepUser?.email || deal.ownerEmail || req.user?.email || 'sales@prittal.com'
    };

    // Auto-dispatch Proforma Invoice (PI) & Payment Confirmation Email to Client + Sales Rep
    let emailReceipt = null;
    try {
      emailReceipt = await sendPaymentAndPIDocumentEmail({
        deal,
        client: client ? client.toObject() : { name: deal.clientName, email: deal.clientEmail },
        payment: newPayment,
        salesRep,
        docType: 'PI'
      });
    } catch (mailErr) {
      console.error('Email dispatch error (non-blocking):', mailErr);
    }

    const prevStatus = deal.status;
    deal.status = newDealStatus;
    const emailNotice = emailReceipt?.recipients?.length 
      ? ` 📧 Proforma Invoice & Payment receipt emailed to ${emailReceipt.recipients.join(' & ')}.` 
      : '';
    deal.activity.push({
      actor: req.user?.name || 'Sales Executive',
      from: prevStatus,
      to: newDealStatus,
      time: new Date(),
      note: `Recorded payment of ${formatINR(paymentAmount)} via ${mode || 'UPI'}.${reference ? ` Ref: ${reference}` : ''}.${emailNotice}`
    });

    await deal.save();

    // Update Client status to Active / Customer if payment was recorded
    if (client) {
      client.status = 'Active';
      client.paymentStatus = newTotalPaid >= deal.total ? 'paid' : 'pending';
      await client.save();
    }

    // Bidirectional sync to SalesContract and Client
    await syncPaymentToContractAndClient(newPayment, deal, client);

    broadcastRealtimeUpdate('PAYMENT_CREATED', { payment: newPayment });
    broadcastRealtimeUpdate('DEAL_UPDATED', { deal });
    if (client) {
      broadcastRealtimeUpdate('CLIENT_UPDATED', { client });
    }

    // 1. Create Notification for Deal Owner
    if (deal.ownerId && deal.ownerId !== req.user?.id) {
      await Notification.create({
        customId: 'notif_' + Math.random().toString(36).substring(2, 9),
        userId: deal.ownerId,
        recipientName: deal.ownerName,
        title: `Payment Received — ${deal.dealCode}`,
        message: `${formatINR(paymentAmount)} received for deal "${deal.title}". Deal is now ${newDealStatus}. Proforma Invoice generated & emailed.`,
        type: 'invoice_paid',
        relatedId: dId
      });
    }

    // 2. High-Priority Notification for Super Admin Dashboard with full client details & PI ref
    const superAdminUsers = await User.find({ role: 'superadmin' });
    const adminRecipients = new Set(['superadmin', ...(superAdminUsers.map(u => u.customId || u._id.toString()))]);
    for (const adminId of adminRecipients) {
      await Notification.create({
        customId: 'notif_' + Math.random().toString(36).substring(2, 9),
        userId: adminId,
        recipientName: 'Super Admin',
        title: `🚨 New Payment & PI: ${formatINR(paymentAmount)} from ${deal.clientName}`,
        message: `Client "${deal.clientName}" (${client?.company || 'Company'}) paid ${formatINR(paymentAmount)} via ${mode || 'UPI'} (Ref: ${reference || 'N/A'}). Proforma Invoice [PI-PROD-${deal.dealCode}] created and sent to client (${client?.email || 'N/A'}) & sales rep (${salesRep.name}). Deal: ${newDealStatus}.`,
        type: 'invoice_paid',
        relatedId: dId
      });
    }

    res.status(201).json({
      success: true,
      message: `Payment of ${formatINR(paymentAmount)} recorded successfully! Proforma Invoice & receipt emailed to client and sales team.`,
      data: {
        payment: newPayment,
        dealStatus: newDealStatus,
        totalPaid: newTotalPaid,
        balanceRemaining: Math.max(0, deal.total - newTotalPaid),
        emailDispatched: emailReceipt
      }
    });
  } catch (err) {
    next(err);
  }
};

// ==========================================
// 5. CONVERT DEAL TO PROJECT (TRANSACTION)
// ==========================================
export const convertDealToProject = async (req, res, next) => {
  try {
    const { dealId } = req.params;
    const { projectName, kickoffNotes, notifyAdmin = true, websiteUrl, domainAccount, domainProvider, domainPurchaseDate, domainDurationYears } = req.body;

    const deal = await Deal.findOne(findByIdOrCustomId(dealId));
    if (!deal) {
      return res.status(404).json({ success: false, message: 'Deal not found.' });
    }

    if (deal.status === 'Converted' || deal.projectId) {
      return res.status(400).json({ success: false, message: 'This deal already has a project.' });
    }

    // Rule: Add to project is allowed on Partially Paid or Paid (blocked only when paid amount is 0)
    const dId = deal.customId || deal._id.toString();
    const payments = await Payment.find({ dealId: dId });
    const totalPaid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    if (totalPaid <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot convert deal to project with 0 payments recorded. Record a payment first.'
      });
    }

    if (!kickoffNotes || kickoffNotes.trim().length < 20) {
      return res.status(400).json({
        success: false,
        message: 'Kickoff brief is required (minimum 20 characters) so Production has essential project context.'
      });
    }

    const client = await Client.findOne(findByIdOrCustomId(deal.clientId));
    const effectiveClientName = client?.companyName || client?.company || deal.clientName || 'Client';
    const effectiveProjectName = projectName && projectName.trim() ? projectName.trim() : `${deal.title} - ${effectiveClientName}`;

    const isWebsitePlan = Boolean(
      (deal.planSnapshot?.name && deal.planSnapshot.name.toLowerCase().includes('website')) ||
      (deal.title && deal.title.toLowerCase().includes('website'))
    );
    const defaultCreatives = isWebsitePlan ? 0 : 4;
    const defaultReels = isWebsitePlan ? 0 : 4;

    // Quotas and content mapping from plan snapshot
    const quota = deal.planSnapshot?.deliverablesQuota || {
      creatives: defaultCreatives,
      carousels: 0,
      aiReels: defaultReels,
      basicReels: 0,
      longVideos: 0,
      festival: !isWebsitePlan,
      blogs: 0,
      gmb: false
    };

    const content = deal.planSnapshot?.content || {
      creatives: quota.creatives !== undefined ? Number(quota.creatives) : defaultCreatives,
      carousels: quota.carousels !== undefined ? Number(quota.carousels) : 0,
      shorts: quota.aiReels !== undefined ? Number(quota.aiReels) : defaultReels,
      aiVideos: 0,
      longVideos: quota.longVideos !== undefined ? Number(quota.longVideos) : 0,
      festivalContent: quota.festival ? 1 : 0,
      blogs: quota.blogs !== undefined ? Number(quota.blogs) : 0
    };

    const todayStr = new Date().toISOString().split('T')[0];
    const deadlineDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const dealPlanDuration = deal.planSnapshot?.billingType || 'Monthly';

    let computedNextRenewal = todayStr;
    const billNorm = dealPlanDuration.toUpperCase();
    const refDate = new Date(todayStr);
    refDate.setHours(12, 0, 0, 0);
    if (billNorm.includes('QUARTER')) refDate.setMonth(refDate.getMonth() + 3);
    else if (billNorm.includes('HALF') || billNorm.includes('6')) refDate.setMonth(refDate.getMonth() + 6);
    else if (billNorm.includes('ANNUAL') || billNorm.includes('YEAR')) refDate.setFullYear(refDate.getFullYear() + 1);
    else if (billNorm.includes('WEEK')) refDate.setDate(refDate.getDate() + 7);
    else refDate.setMonth(refDate.getMonth() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    computedNextRenewal = `${refDate.getFullYear()}-${pad(refDate.getMonth() + 1)}-${pad(refDate.getDate())}`;

    // Check if an existing project already exists for this deal or client to prevent duplication
    let targetProject = null;
    if (deal.projectId) {
      targetProject = await Project.findOne({
        $or: [{ customId: deal.projectId }, { _id: deal.projectId }]
      });
    }
    if (!targetProject) {
      targetProject = await Project.findOne({
        $or: [
          { companyName: new RegExp(`^${effectiveClientName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          { name: new RegExp(`^${effectiveClientName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i') },
          { client: new RegExp(`^${effectiveClientName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          { clientId: client?.customId || client?._id?.toString() }
        ]
      });
    }

    const createdNewProject = !targetProject;
    if (createdNewProject) {
      const primaryContact = client?.contacts?.find(c => c.isPrimary) || client?.contacts?.[0];
      targetProject = await Project.create({
        customId: 'proj_' + Math.random().toString(36).substring(2, 9),
        name: effectiveProjectName,
        companyName: client?.companyName || client?.company || effectiveClientName,
        brandName: client?.displayName || client?.brandName || deal.brandName || client?.companyName || effectiveClientName,
        clientName: primaryContact?.name || client?.contact || deal.clientName || '',
        clientPhone: primaryContact?.phone || client?.phone || '',
        clientEmail: primaryContact?.email || client?.email || '',
        clientId: client?.customId || client?._id?.toString() || deal.clientId || '',
        client: client?.companyName || client?.company || effectiveClientName,
        services: deal.planSnapshot?.name ? [deal.planSnapshot.name] : ['SMO Retainer'],
        salesTeam: [deal.ownerName || req.user?.name || 'Sales'],
        accountManager: 'Unassigned',
        productionManager: 'Unassigned',
        graphicDesigner: 'Unassigned',
        videoEditor: 'Unassigned',
        assignedMembers: [],
        salesDate: todayStr,
        handoverDate: todayStr,
        startDate: todayStr,
        taskStartDate: todayStr,
        deadline: deadlineDate,
        renewalDate: todayStr,
        nextRenewalDate: computedNextRenewal,
        renewalStatus: 'NEW',
        planDuration: dealPlanDuration,
        deliverablesQuota: quota,
        content,
        budget: formatINR(deal.total),
        progress: 0,
        status: 'planning',
        websiteUrl: websiteUrl || deal.websiteUrl || client?.website || '',
        domainAccount: domainAccount || deal.domainAccount || 'Our Account',
        domainProvider: domainProvider || '',
        domainPurchaseDate: domainPurchaseDate || '',
        domainDurationYears: Number(domainDurationYears) || 1,

        // Sales Handoff Fields
        sourceDealId: dId,
        soldPlanName: deal.planSnapshot?.name || deal.title,
        soldPlanCode: deal.planSnapshot?.code || 'CUSTOM',
        planSnapshot: deal.planSnapshot,
        handoffStatus: 'Awaiting Admin Assignment',
        kickoffNotes: kickoffNotes.trim(),
        activity: [
          {
            date: todayStr,
            event: `Project spawned from Deal ${deal.dealCode} by ${req.user?.name || 'Sales'}. Paid: ${formatINR(totalPaid)} of ${formatINR(deal.total)}. Awaiting Admin AM assignment.`
          }
        ]
      });
    } else {
      if (websiteUrl && !targetProject.websiteUrl) targetProject.websiteUrl = websiteUrl;
      if (domainAccount && !targetProject.domainAccount) targetProject.domainAccount = domainAccount;
      if (domainProvider && !targetProject.domainProvider) targetProject.domainProvider = domainProvider;
      if (domainPurchaseDate && !targetProject.domainPurchaseDate) targetProject.domainPurchaseDate = domainPurchaseDate;
      if (domainDurationYears && !targetProject.domainDurationYears) targetProject.domainDurationYears = Number(domainDurationYears) || 1;
      targetProject.activity = Array.isArray(targetProject.activity) ? targetProject.activity : [];
      targetProject.activity.push({
        date: todayStr,
        event: `Sales Deal ${deal.dealCode} linked to this existing project by ${req.user?.name || 'Sales'}. No duplicate onboarding was created.`
      });
      await targetProject.save();
    }

    // Update Deal atomically
    deal.status = 'Converted';
    deal.projectId = targetProject.customId || targetProject._id.toString();
    deal.activity.push({
      actor: req.user?.name || 'Sales Executive',
      from: 'Paid',
      to: 'Converted',
      time: new Date(),
      note: createdNewProject
        ? `Converted to project "${targetProject.name}" (ID: ${targetProject.customId}). Handoff status: Awaiting Admin Assignment.`
        : `Linked to existing project "${targetProject.name}" (ID: ${targetProject.customId}).`
    });
    await deal.save();

    // Update Client status to Customer
    if (client) {
      client.status = 'Customer';
      client.projects = targetProject.name;
      await client.save();
    }

    // Super Admin Notification
    if (notifyAdmin && createdNewProject) {
      await Notification.create({
        customId: 'notif_' + Math.random().toString(36).substring(2, 9),
        userId: 'superadmin',
        recipientName: 'Super Admin',
        title: `New Project Awaiting AM — ${targetProject.name}`,
        message: `Deal ${deal.dealCode} for "${effectiveClientName}" was converted by ${req.user?.name || 'Sales'}. Please assign an Account Manager.`,
        type: 'milestone',
        relatedId: targetProject.customId || targetProject._id.toString()
      });
    }

    await generateDeliverablesForProjectBackend(targetProject, createdNewProject);

    broadcastRealtimeUpdate(createdNewProject ? 'PROJECT_CREATED' : 'PROJECT_UPDATED', { project: targetProject, deal });

    res.status(createdNewProject ? 201 : 200).json({
      success: true,
      message: createdNewProject
        ? 'Project created. Awaiting admin to assign an Account Manager.'
        : 'Deal linked to the existing project. No duplicate onboarding was created.',
      data: {
        project: targetProject,
        deal
      }
    });
  } catch (err) {
    next(err);
  }
};

// ==========================================
// 6. ADMIN NEW PROJECTS & AM ASSIGNMENT
// ==========================================
export const getNewProjectsInbox = async (req, res, next) => {
  try {
    const candidates = await Project.find({
      handoffStatus: 'Awaiting Admin Assignment'
    }).sort({ createdAt: -1 });

    const clean = (value) => String(value || '').trim().toLowerCase();
    const allOtherProjects = await Project.find({
      _id: { $nin: candidates.map((project) => project._id) },
      handoffStatus: { $ne: 'Awaiting Admin Assignment' },
      status: { $ne: 'cancelled' }
    }).select('clientId companyName brandName client').lean();

    const projects = candidates.filter((project) => {
      const amName = clean(project.assignedAmName);
      const hasExplicitAm = (project.assignedAmId && clean(project.assignedAmId) !== 'unassigned') || (amName && amName !== 'unassigned' && amName !== 'none');
      if (hasExplicitAm) return false;

      const clientId = clean(project.clientId);
      const identityNames = [project.companyName, project.brandName, project.client].map(clean).filter(Boolean);
      return !allOtherProjects.some((other) => {
        if (clientId && clean(other.clientId) === clientId) return true;
        const otherNames = new Set([other.companyName, other.brandName, other.client].map(clean).filter(Boolean));
        return identityNames.some((name) => otherNames.has(name));
      });
    });

    // Fetch related deal info for snapshot recap
    const dealIds = projects.map((p) => p.sourceDealId).filter(Boolean);
    const deals = await Deal.find({ $or: [{ customId: { $in: dealIds } }, { _id: { $in: dealIds.filter((id) => mongoose.isValidObjectId(id)) } }] });
    const payments = await Payment.find({ dealId: { $in: dealIds } });

    const enriched = projects.map((p) => {
      const matchedDeal = deals.find((d) => d.customId === p.sourceDealId || d._id.toString() === p.sourceDealId);
      const dPayments = payments.filter((pay) => pay.dealId === p.sourceDealId);
      const paid = dPayments.reduce((sum, pay) => sum + (Number(pay.amount) || 0), 0);

      return {
        ...p.toJSON(),
        deal: matchedDeal || null,
        paidAmount: paid,
        paid: formatINR(paid),
        totalAmount: matchedDeal?.total || 0,
        total: formatINR(matchedDeal?.total || 0)
      };
    });

    res.json({ success: true, data: enriched, count: enriched.length });
  } catch (err) {
    next(err);
  }
};

export const assignAccountManager = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { amUserId, amName: reqAmName } = req.body;

    if (!amUserId && !reqAmName) {
      return res.status(400).json({ success: false, message: 'Account Manager is required.' });
    }

    const project = await Project.findOne(findByIdOrCustomId(projectId));
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    let amUser = null;
    const searchConditions = [];
    if (amUserId) {
      searchConditions.push({ customId: amUserId });
      if (mongoose.isValidObjectId(amUserId)) {
        searchConditions.push({ _id: amUserId });
      }
      searchConditions.push({ name: new RegExp('^' + escapeRegExp(amUserId) + '$', 'i') });
    }
    if (reqAmName) {
      searchConditions.push({ name: new RegExp('^' + escapeRegExp(reqAmName) + '$', 'i') });
    }

    if (searchConditions.length > 0) {
      amUser = await User.findOne({ $or: searchConditions });
    }

    let resolvedAmName = reqAmName || '';
    let resolvedAmId = amUserId || '';

    if (!amUser) {
      // Look in TeamMember collection
      const tm = await TeamMember.findOne({ $or: searchConditions });
      if (tm) {
        resolvedAmName = tm.name;
        resolvedAmId = tm.customId || tm._id.toString();
        // Also check if User exists with this TM name
        const matchUser = await User.findOne({ name: new RegExp('^' + escapeRegExp(tm.name) + '$', 'i') });
        if (matchUser) {
          amUser = matchUser;
          resolvedAmId = matchUser.customId || matchUser._id.toString();
        }
      }
    } else {
      resolvedAmName = amUser.name;
      resolvedAmId = amUser.customId || amUser._id.toString();
    }

    if (!resolvedAmName && !amUser) {
      return res.status(404).json({ success: false, message: 'Selected Account Manager user not found.' });
    }

    const finalAmName = resolvedAmName || amUser?.name || 'Account Manager';
    const finalAmId = resolvedAmId || amUser?.customId || amUser?._id?.toString() || amUserId;

    const prevAm = project.accountManager || 'Unassigned';
    project.assignedAmId = finalAmId;
    project.assignedAmName = finalAmName;
    project.accountManager = finalAmName;
    project.manager = finalAmName;
    project.assignedAmAt = new Date();
    project.assignedByAdminId = req.user?.id || req.user?.customId || req.user?._id || 'admin';
    project.assignedByAdminName = req.user?.name || 'Admin';
    project.handoffStatus = 'Awaiting Team Assignment';

    if (!Array.isArray(project.activity)) {
      project.activity = [];
    }
    project.activity.push({
      date: new Date().toISOString().split('T')[0],
      event: `Account Manager ${finalAmName} assigned by ${req.user?.name || 'Admin'} (Previous: ${prevAm}). Handoff status: Awaiting Team Assignment.`
    });

    await project.save();
    await generateDeliverablesForProjectBackend(project, false).catch(() => {});
    const projIds = [project.customId, project._id?.toString()].filter(Boolean);
    await Task.updateMany(
      { projectId: { $in: projIds }, status: { $ne: 'done' } },
      { accountManager: finalAmName }
    ).catch(() => {});

    // Notify AM
    if (finalAmId) {
      await Notification.create({
        customId: 'notif_' + Math.random().toString(36).substring(2, 9),
        userId: finalAmId,
        recipientName: finalAmName,
        title: `Assigned as AM — ${project.name}`,
        message: `You have been assigned as the Account Manager for project "${project.name}". Please staff your team and start production.`,
        type: 'task_assigned',
        relatedId: project.customId || project._id?.toString()
      }).catch(() => {});
    }

    // Notify Sales Owner if exists
    if (project.salesTeam && project.salesTeam.length > 0) {
      await Notification.create({
        customId: 'notif_' + Math.random().toString(36).substring(2, 9),
        userId: 'sales',
        recipientName: project.salesTeam[0],
        title: `AM Assigned — ${project.name}`,
        message: `${finalAmName} was assigned as Account Manager for your sold project "${project.name}".`,
        type: 'system',
        relatedId: project.customId || project._id?.toString()
      }).catch(() => {});
    }

    broadcastRealtimeUpdate('PROJECT_UPDATED', { project });

    res.json({
      success: true,
      message: `Account Manager ${finalAmName} assigned to "${project.name}".`,
      data: project
    });
  } catch (err) {
    next(err);
  }
};

// ==========================================
// 7. AM TEAM STAFFING & START PRODUCTION
// ==========================================
export const assignProjectTeam = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { teamAssignments } = req.body;

    const project = await Project.findOne(findByIdOrCustomId(projectId));
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    const requesterRole = String(req.user?.role || '').toLowerCase();
    const requesterId = String(req.user?.customId || req.user?.id || req.user?._id || '');
    const requesterName = String(req.user?.name || '').toLowerCase().trim();
    const isAdminRequester = ['superadmin', 'administrator'].includes(requesterRole);
    const isAssignedAm = (requesterId && requesterId === String(project.assignedAmId || '')) ||
      (requesterName && requesterName === String(project.assignedAmName || project.accountManager || '').toLowerCase().trim());
    if (!isAdminRequester && !isAssignedAm) {
      return res.status(403).json({ success: false, message: 'Only the assigned Account Manager or an administrator can staff this project.' });
    }
    if (project.handoffStatus === 'Awaiting Admin Assignment') {
      return res.status(409).json({ success: false, message: 'Assign an Account Manager before staffing the production team.' });
    }

    const assignments = Array.isArray(teamAssignments) ? teamAssignments : [];
    if (assignments.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one team member assignment is required.' });
    }

    const allowedResponsibilities = new Set([
      'creative', 'carousel', 'reel', 'festival', 'blog', 'general',
      'web_design', 'web_development', 'content_upload', 'website_qa', 'deployment',
      'keyword_research', 'seo_audit', 'on_page_seo', 'off_page_seo', 'seo_reporting',
      'shoot_planning', 'photography', 'photo_editing', 'video_shoot', 'video_editing', 'shoot_delivery',
      'ad_setup', 'ad_creative', 'ad_launch', 'ad_optimization'
    ]);
    const normalizedAssignments = assignments.map((item) => ({
      userId: item.userId,
      userName: item.userName || 'Team Member',
      roleOnProject: item.roleOnProject || item.roleInProject || 'Production Specialist',
      allocatedHours: Number(item.allocatedHours) || Number(item.hoursPerWeek) || 0,
      taskDescription: String(item.taskDescription || '').trim(),
      responsibleFor: Array.from(new Set(
        (Array.isArray(item.responsibleFor) ? item.responsibleFor : [])
          .map((value) => String(value).toLowerCase().trim())
          .filter((value) => allowedResponsibilities.has(value))
      ))
    }));

    if (normalizedAssignments.some((item) => !item.userId)) {
      return res.status(400).json({ success: false, message: 'Every team assignment must have a selected member.' });
    }
    if (normalizedAssignments.some((item) => item.responsibleFor.length === 0 && !item.taskDescription)) {
      return res.status(400).json({
        success: false,
        message: 'Specify what each team member will create or provide a task instruction.'
      });
    }

    const duplicateResponsibility = normalizedAssignments
      .flatMap((item) => item.responsibleFor)
      .find((value, index, all) => value !== 'general' && all.indexOf(value) !== index);
    if (duplicateResponsibility) {
      return res.status(400).json({
        success: false,
        message: `${duplicateResponsibility} work can only have one primary owner.`
      });
    }

    project.teamAssignments = normalizedAssignments;

    const memberNames = Array.from(new Set(normalizedAssignments.map((a) => a.userName).filter(Boolean)));
    project.assignedMembers = memberNames;
    project.members = memberNames;
    project.handoffStatus = 'Team Assigned';

    // Auto-detect and sync Graphic Designer & Video Editor
    const designerAssignment = normalizedAssignments.find((a) => {
      if (a.responsibleFor.some((type) => ['creative', 'carousel'].includes(type))) return true;
      const role = (a.roleOnProject || a.roleInProject || '').toLowerCase();
      return role.includes('design');
    });
    if (designerAssignment && designerAssignment.userName) {
      project.graphicDesigner = designerAssignment.userName;
    } else if (assignments[0]?.userName && (!project.graphicDesigner || project.graphicDesigner === 'Unassigned')) {
      project.graphicDesigner = assignments[0].userName;
    }

    const videoAssignment = normalizedAssignments.find((a) => {
      if (a.responsibleFor.includes('reel')) return true;
      const role = (a.roleOnProject || a.roleInProject || '').toLowerCase();
      return role.includes('video') || role.includes('editor');
    });
    if (videoAssignment && videoAssignment.userName) {
      project.videoEditor = videoAssignment.userName;
    }

    project.activity.push({
      date: new Date().toISOString().split('T')[0],
      event: `Production team staffed by ${req.user?.name || 'AM'}: ${memberNames.join(', ')}. Designer: ${project.graphicDesigner || 'Unassigned'}.`
    });

    await project.save();
    await generateDeliverablesForProjectBackend(project, false);
    const pIds = [project.customId || project._id.toString()];
    if (project._id) pIds.push(project._id.toString());
    if (project.customId) pIds.push(project.customId);
    for (const assignment of normalizedAssignments) {
      for (const taskType of assignment.responsibleFor.filter((type) => type !== 'general')) {
        const taskUpdates = {
          assignedTo: assignment.userName,
          assignedToId: assignment.userId
        };
        if (assignment.taskDescription) taskUpdates.description = assignment.taskDescription;
        await Task.updateMany(
          { projectId: { $in: pIds }, taskType, status: { $ne: 'done' } },
          { $set: taskUpdates }
        ).catch(() => {});
      }
    }

    // Notify assigned members
    for (const assignment of normalizedAssignments) {
      if (assignment.userId) {
        await Notification.create({
          customId: 'notif_' + Math.random().toString(36).substring(2, 9),
          userId: assignment.userId,
          recipientName: assignment.userName,
          title: `Assigned to ${project.name}`,
          message: `You were assigned as ${assignment.roleOnProject} for "${project.name}"${assignment.responsibleFor.length ? ` (${assignment.responsibleFor.join(', ')})` : ''}.`,
          type: 'task_assigned',
          relatedId: project.customId || project._id.toString()
        });
      }
    }

    broadcastRealtimeUpdate('PROJECT_UPDATED', { project });

    res.json({
      success: true,
      message: `Team of ${memberNames.length} member(s) confirmed for "${project.name}".`,
      data: project
    });
  } catch (err) {
    next(err);
  }
};

export const startProduction = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const project = await Project.findOne(findByIdOrCustomId(projectId));
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    const requesterRole = String(req.user?.role || '').toLowerCase();
    const requesterId = String(req.user?.customId || req.user?.id || req.user?._id || '');
    const requesterName = String(req.user?.name || '').toLowerCase().trim();
    const isAdminRequester = ['superadmin', 'administrator'].includes(requesterRole);
    const isAssignedAm = (requesterId && requesterId === String(project.assignedAmId || '')) ||
      (requesterName && requesterName === String(project.assignedAmName || project.accountManager || '').toLowerCase().trim());
    if (!isAdminRequester && !isAssignedAm) {
      return res.status(403).json({ success: false, message: 'Only the assigned Account Manager or an administrator can start production.' });
    }
    if (project.handoffStatus !== 'Team Assigned' && project.handoffStatus !== 'In Production') {
      return res.status(409).json({ success: false, message: 'Confirm the team and task owners before starting production.' });
    }

    project.handoffStatus = 'In Production';
    project.status = 'active';
    project.startDate = new Date().toISOString().split('T')[0];

    project.activity.push({
      date: new Date().toISOString().split('T')[0],
      event: `Production officially started by Account Manager ${req.user?.name || project.accountManager}. Tasks now live on team board.`
    });

    await project.save();
    await generateDeliverablesForProjectBackend(project, false);

    // Broadcast notification to assigned members and Sales Owner
    const targetMembers = project.assignedMembers || [];
    for (const memberName of targetMembers) {
      await Notification.create({
        customId: 'notif_' + Math.random().toString(36).substring(2, 9),
        userId: memberName,
        recipientName: memberName,
        title: `Production Started: ${project.name}`,
        message: `Project "${project.name}" is now IN PRODUCTION. Work on deliverables has begun.`,
        type: 'task_assigned',
        relatedId: project.customId || project._id.toString()
      });
    }

    broadcastRealtimeUpdate('PROJECT_UPDATED', { project });

    res.json({
      success: true,
      message: `Production started for "${project.name}"! Deliverables are now live.`,
      data: project
    });
  } catch (err) {
    next(err);
  }
};

// ==========================================
// 8. DOCUMENT GENERATION (PDF / PI)
// ==========================================
export const generateDealDocument = async (req, res, next) => {
  try {
    const { dealId } = req.params;
    const { docType } = req.body; // 'PDF' | 'PI'

    const deal = await Deal.findOne(findByIdOrCustomId(dealId));
    if (!deal) {
      return res.status(404).json({ success: false, message: 'Deal not found.' });
    }

    const client = await Client.findOne(findByIdOrCustomId(deal.clientId));
    const dId = deal.customId || deal._id.toString();
    const payments = await Payment.find({ dealId: dId });
    const paidAmount = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const balanceAmount = Math.max(0, deal.total - paidAmount);

    const isPI = docType === 'PI';
    const typeLabel = isPI ? 'PI' : 'PDF';
    const existingVersion = deal.documents.filter((d) => d.type === typeLabel).length + 1;
    const fileName = isPI ? `PI-PROD-${deal.dealCode}-v${existingVersion}.pdf` : `Invoice-${deal.dealCode}-v${existingVersion}.pdf`;

    const docRecord = {
      name: fileName,
      type: typeLabel,
      version: existingVersion,
      generatedAt: new Date(),
      fileUrl: `/uploads/${fileName}`
    };

    deal.documents.push(docRecord);
    deal.activity.push({
      actor: req.user?.name || 'Sales Executive',
      from: '',
      to: '',
      time: new Date(),
      note: `Generated ${typeLabel} document (${fileName}).`
    });

    await deal.save();

    res.status(201).json({
      success: true,
      message: `${isPI ? 'Proforma Invoice (PI for Production)' : 'Client Invoice/Sale PDF'} generated successfully.`,
      data: {
        document: docRecord,
        deal,
        client,
        paidAmount,
        balanceAmount
      }
    });
  } catch (err) {
    next(err);
  }
};

export const deleteDealDocument = async (req, res, next) => {
  try {
    const { dealId, docId } = req.params;
    const deal = await Deal.findOne(findByIdOrCustomId(dealId));
    if (!deal) {
      return res.status(404).json({ success: false, message: 'Deal not found.' });
    }

    const initialLen = (deal.documents || []).length;
    let deletedDocName = '';

    // Find document by _id, id, name, or version
    const targetDoc = deal.documents.find(d => 
      d._id?.toString() === docId || 
      d.id === docId || 
      d.name === docId ||
      String(d.version) === docId
    );

    if (targetDoc) {
      deletedDocName = targetDoc.name || `Version ${targetDoc.version}`;
      deal.documents = deal.documents.filter(d => d !== targetDoc);
    } else if (!isNaN(Number(docId))) {
      const idx = Number(docId);
      if (idx >= 0 && idx < deal.documents.length) {
        deletedDocName = deal.documents[idx].name || `Version ${deal.documents[idx].version}`;
        deal.documents.splice(idx, 1);
      }
    }

    if (deal.documents.length === initialLen) {
      return res.status(404).json({ success: false, message: 'Document not found on this deal.' });
    }

    deal.activity.push({
      actor: req.user?.name || 'Sales Executive',
      from: '',
      to: '',
      time: new Date(),
      note: `Deleted commercial document (${deletedDocName || docId}).`
    });

    await deal.save();

    res.json({
      success: true,
      message: 'Document deleted successfully.',
      data: deal
    });
  } catch (err) {
    next(err);
  }
};

// ==========================================
// 9. LEGACY PROPOSALS & LEADS WRAPPERS
// ==========================================
export const getProposals = async (req, res, next) => {
  return getDeals(req, res, next);
};

export const createProposal = async (req, res, next) => {
  return createDeal(req, res, next);
};

export const updateProposalStatus = async (req, res, next) => {
  return updateDealStatus(req, res, next);
};

export const deleteProposal = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deleted = await Deal.findOneAndDelete(findByIdOrCustomId(id));
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Deal not found.' });
    }
    res.json({ success: true, message: `Deal "${deleted.title}" removed.`, data: deleted });
  } catch (err) {
    next(err);
  }
};

export const getLeads = async (req, res, next) => {
  try {
    const leads = await Lead.find().sort({ createdAt: -1 });
    if (leads.length === 0) {
      // Fallback: check if any clients exist with status 'Lead'
      const clientLeads = await Client.find({ status: 'Lead', isArchived: { $ne: true } }).sort({ createdAt: -1 });
      return res.json({ success: true, data: clientLeads });
    }
    res.json({ success: true, data: leads });
  } catch (err) {
    next(err);
  }
};

export const createLead = async (req, res, next) => {
  try {
    const rawAssigned = (req.body.assignedTo || req.body.assignedMember || '').trim();
    const isUnassigned = !rawAssigned || rawAssigned.toLowerCase() === 'unassigned' || rawAssigned.toLowerCase() === 'untouched';
    const assignedName = isUnassigned ? '' : rawAssigned;
    let assignedCallerId = isUnassigned ? '' : (req.body.assignedCallerId || req.body.callerId || '').trim();
    let calledById = (req.body.calledById || '').trim();
    const calledByName = (req.body.calledBy || '').trim();

    // If assigned caller ID not passed and a caller is specified, look it up in User or TeamMember
    if (!assignedCallerId && assignedName) {
      const matchedUser = await User.findOne({
        $or: [
          { name: new RegExp('^' + assignedName + '$', 'i') },
          { username: new RegExp('^' + assignedName + '$', 'i') }
        ]
      });
      if (matchedUser) {
        assignedCallerId = matchedUser.customId || matchedUser._id.toString();
      } else {
        const matchedTm = await TeamMember.findOne({ name: new RegExp('^' + assignedName + '$', 'i') });
        if (matchedTm) assignedCallerId = matchedTm.customId || matchedTm._id.toString();
      }
    }

    // If calledBy ID not passed, look it up
    if (!calledById && calledByName) {
      const matchedUser = await User.findOne({
        $or: [
          { name: new RegExp('^' + calledByName + '$', 'i') },
          { username: new RegExp('^' + calledByName + '$', 'i') }
        ]
      });
      if (matchedUser) {
        calledById = matchedUser.customId || matchedUser._id.toString();
      } else {
        const matchedTm = await TeamMember.findOne({ name: new RegExp('^' + calledByName + '$', 'i') });
        if (matchedTm) calledById = matchedTm.customId || matchedTm._id.toString();
      }
    }

    const incomingUrl = (req.body.url || '').trim();
    let autoAudit = null;
    if (incomingUrl) {
      try {
        autoAudit = await analyzeWebsiteDetails(incomingUrl);
      } catch (auditErr) {
        console.warn('[createLead] Auto-audit notice:', auditErr.message);
      }
    }

    const leadData = {
      customId: req.body.customId || 'lead_' + Math.random().toString(36).substring(2, 9),
      company: req.body.company || req.body.businessName || 'New Prospect',
      date: req.body.date || new Date().toISOString().split('T')[0],
      area: req.body.area || '',
      category: req.body.category || 'Manufacturer',
      type: req.body.type || 'Shoes',
      contactPerson: req.body.contactPerson || '',
      email: req.body.email || '',
      phone: req.body.phone || req.body.number || '',
      address: req.body.address ? req.body.address.replace(/^((?:[a-z\s]+ )?(?:wholesal(?:er|e)|manufactur(?:er|ing)|trader|dealer|supplier|store|shop|factory|distributor|retail(?:er)?|exporter|importer|corporate office))[,\s\-]+/i, '').trim() : '',
      gmbRating: req.body.gmbRating || '',
      reviews: req.body.reviews || '',
      url: autoAudit?.url || incomingUrl,
      website: autoAudit?.url || incomingUrl,
      websiteExist: autoAudit ? autoAudit.websiteExist : (req.body.websiteExist || (incomingUrl ? 'Yes' : 'No')),
      websiteStatus: autoAudit ? autoAudit.websiteStatus : (req.body.websiteStatus || (incomingUrl ? 'Medium' : 'No')),
      instagram: autoAudit ? autoAudit.instagram : (req.body.instagram || 'No'),
      facebook: autoAudit ? autoAudit.facebook : (req.body.facebook || 'No'),
      linkedin: autoAudit ? autoAudit.linkedin : (req.body.linkedin || 'No'),
      youtube: autoAudit ? autoAudit.youtube : (req.body.youtube || 'No'),
      socialActivities: autoAudit ? autoAudit.socialActivities : (
        [req.body.instagram, req.body.facebook, req.body.linkedin, req.body.youtube].some(x => String(x || '').toLowerCase() === 'yes')
          ? (req.body.socialActivities || 'Active')
          : 'Not Active'
      ),
      service: req.body.service || autoAudit?.service || req.body.serviceToPitch || '',
      serviceCategory: req.body.serviceCategory || autoAudit?.serviceCategory || 'Lead Generation',
      chances: req.body.chances || autoAudit?.chances || 'High',
      assignedTo: assignedName,
      assignedCallerId: assignedCallerId,
      callerId: assignedCallerId,
      assignedDate: req.body.assignedDate || (assignedName ? new Date().toISOString().split('T')[0] : ''),
      callingDate: req.body.callingDate || '',
      calledBy: calledByName,
      calledById: calledById,
      createdBy: req.user?.name || 'Sales Admin',
      createdById: req.user?.id || 'usr_admin',
      creatorRole: req.user?.role || 'sales_admin',
      callStatus: req.body.callStatus || '',
      remark: req.body.remark || req.body.notes || '',
      budget: req.body.budget || '₹0',
      source: req.body.source || 'Manual Lead Creation',
      assignedMember: assignedName,
      assignedMemberId: assignedCallerId,
      status: req.body.status || 'lead'
    };

    const newLead = await Lead.create(leadData);
    broadcastRealtimeUpdate('LEAD_UPDATED', { lead: newLead });
    res.status(201).json({ success: true, message: `Lead created for ${newLead.company}`, data: newLead });
  } catch (err) {
    next(err);
  }
};

export const batchImportLeads = async (req, res, next) => {
  try {
    const { leadsToCreate = [], leadsToUpdate = [] } = req.body;
    const teamMembers = await TeamMember.find({});
    const users = await User.find({});

    const resolveCallerId = (name) => {
      if (!name) return '';
      const trimmed = name.trim().toLowerCase();
      const u = users.find(x => (x.name || '').toLowerCase() === trimmed || (x.username || '').toLowerCase() === trimmed);
      if (u) return u.customId || u._id.toString();
      const tm = teamMembers.find(x => (x.name || '').toLowerCase() === trimmed);
      if (tm) return tm.customId || tm._id.toString();
      return '';
    };

    const createdResults = [];
    if (Array.isArray(leadsToCreate) && leadsToCreate.length > 0) {
      const docsToInsert = leadsToCreate.map(l => {
        const assignedName = (l.assignedTo !== undefined ? l.assignedTo : (l.assignedMember || '')).trim();
        const calledByName = (l.calledBy || '').trim();
        const isExplicitlyUnassigned = assignedName === '' || assignedName.toLowerCase() === 'unassigned';
        const finalAssignedTo = isExplicitlyUnassigned ? '' : assignedName;
        const assignedCallerId = isExplicitlyUnassigned ? '' : (l.assignedCallerId || resolveCallerId(finalAssignedTo));
        const calledById = l.calledById || resolveCallerId(calledByName);

        const hasSocial = [l.instagram, l.facebook, l.linkedin, l.youtube].some(
          x => String(x || '').toLowerCase() === 'yes'
        );
        const finalSocial = hasSocial ? (l.socialActivities || 'Active') : 'Not Active';
        const hasWebsite = String(l.websiteExist || (l.url ? 'Yes' : 'No')).toLowerCase() === 'yes';
        const revCount = parseInt(l.reviews, 10) || 0;

        let service = (l.service || l.serviceToPitch || '').trim();
        let serviceCategory = (l.serviceCategory || l.serviceCategoryPitch || '').trim();
        let remark = l.remark || l.notes || '';

        // Auto-assign tailored service pitch if empty or generic 'Lead Generation'
        if (!service || service.toLowerCase() === 'lead generation' || service === '--') {
          if (!hasWebsite && !hasSocial) {
            service = 'Website Design + Social Media Management + GMB Optimization + Review Generation';
            serviceCategory = 'Website Design';
            if (!remark) remark = 'No website or social presence found. Pitch complete online identity setup, responsive website and Google review generation.';
          } else if (!hasWebsite && hasSocial) {
            service = 'Website Design + Social Media Setup + Paid Promotions + Review Generation';
            serviceCategory = 'Website Design';
            if (!remark) remark = 'Active on social channels but has no official website. High opportunity for business catalogue website and lead funnels.';
          } else if (hasWebsite && !hasSocial) {
            service = 'Social Media Setup + Paid Promotions + Review Generation';
            serviceCategory = 'SMO & Social Media';
            if (!remark) remark = 'Website exists but social platforms are missing. Pitch social media branding, Meta ad campaigns, and Google review generation.';
          } else if (hasWebsite && hasSocial && revCount < 30) {
            service = 'Social Media Setup + Paid Promotions + GMB Optimization + Review Generation';
            serviceCategory = 'Lead Generation';
            if (!remark) remark = 'Digital presence exists. High value in pitching Google Maps ranking, review acceleration and local lead generation.';
          } else {
            service = 'Paid Promotions + Review Generation';
            serviceCategory = 'Lead Generation';
            if (!remark) remark = 'Established brand presence. Pitch performance ads, review generation and scale-up marketing.';
          }
        }

        return {
          customId: l.customId || 'lead_' + Math.random().toString(36).substring(2, 9),
          company: l.company || l.businessName || 'New Prospect',
          date: l.date || new Date().toISOString().split('T')[0],
          area: l.area || '',
          city: l.city || '',
          state: l.state || '',
          category: l.category || 'Manufacturer',
          type: l.type || 'Shoes',
          contactPerson: l.contactPerson || '',
          email: l.email || '',
          phone: l.phone || l.number || '',
          address: l.address ? l.address.replace(/^((?:[a-z\s]+ )?(?:wholesal(?:er|e)|manufactur(?:er|ing)|trader|dealer|supplier|store|shop|factory|distributor|retail(?:er)?|exporter|importer|corporate office))[,\s\-]+/i, '').trim() : '',
          gmbRating: l.gmbRating || '',
          reviews: l.reviews || '',
          url: l.url || '',
          websiteExist: l.websiteExist || (l.url ? 'Yes' : 'No'),
          websiteStatus: l.websiteStatus || (l.url ? 'Good' : 'No'),
          instagram: l.instagram || 'No',
          facebook: l.facebook || 'No',
          linkedin: l.linkedin || 'No',
          youtube: l.youtube || 'No',
          socialActivities: finalSocial,
          service,
          serviceCategory: serviceCategory || 'Lead Generation',
          chances: l.chances || 'High',
          assignedTo: finalAssignedTo,
          assignedCallerId: assignedCallerId,
          callerId: assignedCallerId,
          assignedDate: l.assignedDate || (finalAssignedTo ? new Date().toISOString().split('T')[0] : ''),
          callingDate: l.callingDate || '',
          calledBy: calledByName,
          calledById: calledById || (calledByName === req.user?.name ? (req.user?.id || req.user?.customId) : ''),
          createdBy: req.user?.name || 'Sales Admin',
          createdById: req.user?.id || 'usr_admin',
          creatorRole: req.user?.role || 'sales_admin',
          callStatus: l.callStatus !== undefined ? l.callStatus : '',
          remark,
          budget: l.budget || '₹0',
          source: l.source || 'Excel Import',
          assignedMember: finalAssignedTo,
          assignedMemberId: assignedCallerId,
          status: l.status || 'lead'
        };
      });

      const inserted = await Lead.insertMany(docsToInsert, { ordered: false });
      createdResults.push(...inserted);
    }

    const updatedResults = [];
    if (Array.isArray(leadsToUpdate) && leadsToUpdate.length > 0) {
      for (const item of leadsToUpdate) {
        const id = item.id || item._id || item.customId;
        if (!id) continue;
        const updates = item.updates || item;
        delete updates.id;
        delete updates._id;
        delete updates.customId;
        const lead = await Lead.findOneAndUpdate(findByIdOrCustomId(id), { $set: updates }, { new: true });
        if (lead) updatedResults.push(lead);
      }
    }

    broadcastRealtimeUpdate('LEADS_BATCH_UPDATED', { createdCount: createdResults.length, updatedCount: updatedResults.length });

    res.status(200).json({
      success: true,
      message: `Successfully processed ${createdResults.length} new leads and ${updatedResults.length} updated leads`,
      createdCount: createdResults.length,
      updatedCount: updatedResults.length,
      data: { created: createdResults, updated: updatedResults }
    });
  } catch (err) {
    next(err);
  }
};

export const updateLeadStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    let lead = await Lead.findOne(findByIdOrCustomId(id));
    if (lead) {
      lead.status = status;
      await lead.save();
      broadcastRealtimeUpdate('LEAD_UPDATED', { lead });
      return res.json({ success: true, data: lead });
    }
    return updateClient(req, res, next);
  } catch (err) {
    next(err);
  }
};

export const updateLead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };
    if (updates.assignedTo !== undefined) {
      const cleanAssigned = (updates.assignedTo || '').trim();
      if (!cleanAssigned || cleanAssigned.toLowerCase() === 'unassigned' || cleanAssigned.toLowerCase() === 'untouched') {
        updates.assignedTo = '';
        updates.assignedMember = '';
        updates.assignedCallerId = '';
        updates.callerId = '';
        updates.assignedDate = '';
      } else {
        updates.assignedTo = cleanAssigned;
        if (updates.assignedDate === undefined) {
          updates.assignedDate = new Date().toISOString().split('T')[0];
        }
        if (!updates.assignedMember) {
          updates.assignedMember = cleanAssigned;
        }
      }
    }

    // Auto-resolve assignedCallerId / callerId if assignedTo is updated
    if (updates.assignedTo && !updates.assignedCallerId && !updates.callerId) {
      const cleanAssigned = updates.assignedTo.trim();
      const matchedUser = await User.findOne({
        $or: [
          { name: new RegExp('^' + cleanAssigned + '$', 'i') },
          { username: new RegExp('^' + cleanAssigned + '$', 'i') }
        ]
      });
      if (matchedUser) {
        updates.assignedCallerId = matchedUser.customId || matchedUser._id.toString();
        updates.callerId = updates.assignedCallerId;
        updates.assignedMemberId = updates.assignedCallerId;
      } else {
        const matchedTm = await TeamMember.findOne({ name: new RegExp('^' + cleanAssigned + '$', 'i') });
        if (matchedTm) {
          updates.assignedCallerId = matchedTm.customId || matchedTm._id.toString();
          updates.callerId = updates.assignedCallerId;
          updates.assignedMemberId = updates.assignedCallerId;
        }
      }
    }

    // Auto-resolve calledById if calledBy is updated
    if (updates.calledBy && !updates.calledById) {
      const cleanCalledBy = updates.calledBy.trim();
      const matchedUser = await User.findOne({
        $or: [
          { name: new RegExp('^' + cleanCalledBy + '$', 'i') },
          { username: new RegExp('^' + cleanCalledBy + '$', 'i') }
        ]
      });
      if (matchedUser) {
        updates.calledById = matchedUser.customId || matchedUser._id.toString();
      } else {
        const matchedTm = await TeamMember.findOne({ name: new RegExp('^' + cleanCalledBy + '$', 'i') });
        if (matchedTm) updates.calledById = matchedTm.customId || matchedTm._id.toString();
      }
    }

    // Automatically analyze website and update status + social presence if URL is supplied or changed
    if (updates.url !== undefined) {
      const urlStr = String(updates.url || '').trim();
      const currentLead = await Lead.findOne(findByIdOrCustomId(id)).lean();
      const urlChanged = !currentLead || (currentLead.url || '').trim() !== urlStr;
      const isUnverifiedAudit = !currentLead?.websiteStatus || 
        currentLead.websiteStatus === 'No' || 
        (currentLead.instagram === 'No' && currentLead.facebook === 'No' && currentLead.linkedin === 'No' && currentLead.youtube === 'No');
      const shouldAudit = urlStr && req.body.forceAnalyze !== false && (urlChanged || req.body.forceAnalyze || req.body.analyzeWebsite || isUnverifiedAudit);

      if (shouldAudit) {
        try {
          const analysis = await analyzeWebsiteDetails(urlStr);
          updates.url = analysis.url || urlStr;
          updates.websiteExist = analysis.websiteExist;
          updates.websiteStatus = analysis.websiteStatus;
          updates.instagram = analysis.instagram;
          updates.facebook = analysis.facebook;
          updates.linkedin = analysis.linkedin;
          updates.youtube = analysis.youtube;
          updates.socialActivities = analysis.socialActivities;

          // If current pitch is default/empty, auto-tailor pitch based on website audit
          const currentPitch = currentLead?.service || updates.service || '';
          if (!currentPitch || currentPitch.includes('Social Media Management + GMB') || currentPitch === 'Website Design') {
            updates.service = analysis.service;
            updates.serviceCategory = analysis.serviceCategory;
            if (!currentLead?.remark || currentLead.remark.includes('No website') || !updates.remark) {
              updates.remark = analysis.remark;
            }
          }
        } catch (analysisErr) {
          console.warn('[updateLead] Website analysis notice:', analysisErr.message);
        }
      } else if (!urlStr) {
        updates.websiteExist = 'No';
        updates.websiteStatus = 'No';
        updates.socialActivities = 'Not Active';
      }
    }

    let lead = await Lead.findOneAndUpdate(
      findByIdOrCustomId(id),
      { $set: updates },
      { new: true }
    );
    if (lead) {
      broadcastRealtimeUpdate('LEAD_UPDATED', { lead });
      return res.json({ success: true, message: 'Lead updated successfully.', data: lead });
    }
    return res.status(404).json({ success: false, message: 'Lead not found.' });
  } catch (err) {
    next(err);
  }
};

/**
 * Public/authenticated standalone website audit endpoint
 */
export const analyzeWebsiteController = async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, message: 'URL is required.' });
    }
    const analysis = await analyzeWebsiteDetails(url);
    res.json({ success: true, data: analysis });
  } catch (err) {
    next(err);
  }
};

/**
 * Audit and update a specific CRM lead's website status and social channels
 */
export const analyzeLeadWebsiteController = async (req, res, next) => {
  try {
    const { id } = req.params;
    let lead = await Lead.findOne(findByIdOrCustomId(id));
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });

    const targetUrl = (req.body.url || lead.url || '').trim();
    if (!targetUrl) {
      return res.status(400).json({ success: false, message: 'Lead has no website URL to analyze.' });
    }

    const analysis = await analyzeWebsiteDetails(targetUrl);
    lead.url = analysis.url || targetUrl;
    lead.websiteExist = analysis.websiteExist;
    lead.websiteStatus = analysis.websiteStatus;
    lead.instagram = analysis.instagram;
    lead.facebook = analysis.facebook;
    lead.linkedin = analysis.linkedin;
    lead.youtube = analysis.youtube;
    lead.socialActivities = analysis.socialActivities;
    lead.service = analysis.service;
    lead.serviceCategory = analysis.serviceCategory;
    if (!lead.remark || lead.remark.includes('No website') || lead.remark.trim() === '') {
      lead.remark = analysis.remark;
    }

    await lead.save();
    broadcastRealtimeUpdate('LEAD_UPDATED', { lead });

    res.json({
      success: true,
      message: `Website analyzed! Status: ${analysis.websiteStatus}, Social Presence: ${analysis.socialActivities}`,
      data: lead,
      analysis
    });
  } catch (err) {
    next(err);
  }
};


export const deleteLead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const lead = await Lead.findOneAndDelete(findByIdOrCustomId(id));
    if (lead) {
      broadcastRealtimeUpdate('LEAD_DELETED', { leadId: id });
      return res.json({ success: true, message: 'Lead deleted.' });
    }
    return deleteClient(req, res, next);
  } catch (err) {
    next(err);
  }
};

export const getFollowUps = async (req, res, next) => {
  try {
    const { FollowUp } = await import('../models/FollowUp.js');
    const followUps = await FollowUp.find().sort({ date: 1 });
    res.json({ success: true, data: followUps });
  } catch (err) {
    next(err);
  }
};

export const createFollowUp = async (req, res, next) => {
  try {
    const { FollowUp } = await import('../models/FollowUp.js');
    const { client, type, date, time, assignedTo, status, notes, leadId } = req.body;
    const newItem = await FollowUp.create({
      customId: 'f_' + Math.random().toString(36).substring(2, 9),
      client: client || 'General Account',
      leadId: leadId || '',
      type: type || 'Call',
      date: date || new Date().toISOString().split('T')[0],
      time: time || '10:00 AM',
      assignedTo: assignedTo || req.user?.name || '',
      status: status || 'pending',
      notes: notes || ''
    });
    broadcastRealtimeUpdate('FOLLOWUP_UPDATED', { followUp: newItem });
    res.status(201).json({ success: true, message: `Follow-up scheduled with ${newItem.client}`, data: newItem });
  } catch (err) {
    next(err);
  }
};

export const toggleFollowUp = async (req, res, next) => {
  try {
    const { FollowUp } = await import('../models/FollowUp.js');
    const { Lead } = await import('../models/Lead.js');
    const { id } = req.params;
    const item = await FollowUp.findOne(findByIdOrCustomId(id));
    if (!item) {
      return res.status(404).json({ success: false, message: 'Follow-up not found.' });
    }

    const {
      status,
      remark,
      completionRemark,
      outcomeStatus,
      planSold,
      soldPlanName,
      dealValue,
      paymentNote,
      completedBy,
      completedDate,
      nextFollowUp
    } = req.body || {};

    const hasOutcomePayload = remark !== undefined || outcomeStatus !== undefined || planSold !== undefined;

    if (status !== undefined) {
      item.status = status;
    } else if (hasOutcomePayload) {
      item.status = 'completed';
    } else {
      item.status = item.status === 'completed' ? 'pending' : 'completed';
    }

    const finalRemark = (remark || completionRemark || item.completionRemark || '').trim();

    if (item.status === 'completed') {
      if (finalRemark) item.completionRemark = finalRemark;
      if (outcomeStatus) item.outcomeStatus = outcomeStatus;
      if (planSold !== undefined) item.planSold = Boolean(planSold);
      if (soldPlanName !== undefined) item.soldPlanName = soldPlanName;
      if (dealValue !== undefined) item.dealValue = Number(dealValue) || 0;
      if (paymentNote !== undefined) item.paymentNote = paymentNote;
      item.completedBy = completedBy || req.user?.name || item.assignedTo || '';
      item.completedDate = completedDate || new Date().toISOString().split('T')[0];
      item.completedAt = new Date();
    }

    await item.save();
    broadcastRealtimeUpdate('FOLLOWUP_UPDATED', { followUp: item });

    // Sync outcome and remarks into the matching Lead
    let targetLead = null;
    if (item.leadId) {
      targetLead = await Lead.findOne(findByIdOrCustomId(item.leadId));
    }
    if (!targetLead && item.client) {
      const escapedClient = item.client.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      targetLead = await Lead.findOne({
        $or: [
          { company: { $regex: new RegExp(`^${escapedClient}$`, 'i') } },
          { customId: item.client }
        ]
      });
    }

    if (targetLead && item.status === 'completed') {
      if (item.outcomeStatus) {
        targetLead.callStatus = item.outcomeStatus;
      }
      if (finalRemark) {
        targetLead.remark2 = finalRemark;
        targetLead.lastRemark = finalRemark;
      }
      if (item.planSold) {
        targetLead.planSold = true;
        targetLead.soldPlanName = item.soldPlanName;
        targetLead.dealValue = item.dealValue;
        if (item.dealValue > 0) {
          targetLead.budget = `₹${item.dealValue.toLocaleString('en-IN')}`;
        }
        targetLead.status = 'won';
      }
      targetLead.callingDate = item.completedDate || new Date().toISOString().split('T')[0];
      if (item.completedBy) {
        targetLead.calledBy = item.completedBy;
      }
      await targetLead.save();
      broadcastRealtimeUpdate('LEAD_UPDATED', { lead: targetLead });
    }

    // Schedule next follow-up if requested
    let createdNextFollowUp = null;
    if (nextFollowUp && nextFollowUp.date) {
      createdNextFollowUp = await FollowUp.create({
        customId: 'f_' + Math.random().toString(36).substring(2, 9),
        client: item.client,
        leadId: item.leadId || (targetLead ? (targetLead.customId || targetLead._id.toString()) : ''),
        type: nextFollowUp.type || 'Call',
        date: nextFollowUp.date,
        time: nextFollowUp.time || '10:00 AM',
        assignedTo: nextFollowUp.assignedTo || item.assignedTo || req.user?.name || '',
        status: 'pending',
        notes: nextFollowUp.notes || `Follow-up after outcome: ${item.outcomeStatus || 'Meeting completed'}`
      });
      broadcastRealtimeUpdate('FOLLOWUP_UPDATED', { followUp: createdNextFollowUp });
    }

    res.json({
      success: true,
      message: `Follow-up marked as ${item.status}`,
      data: item,
      lead: targetLead,
      nextFollowUp: createdNextFollowUp
    });
  } catch (err) {
    next(err);
  }
};

export const deleteFollowUp = async (req, res, next) => {
  try {
    const { FollowUp } = await import('../models/FollowUp.js');
    const { id } = req.params;
    const deleted = await FollowUp.findOneAndDelete(findByIdOrCustomId(id));
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Follow-up not found.' });
    }
    broadcastRealtimeUpdate('FOLLOWUP_DELETED', { id, followUp: deleted });
    res.json({ success: true, message: 'Follow-up deleted successfully.', data: deleted });
  } catch (err) {
    next(err);
  }
};

// ==========================================
// 10. SALES ADMIN CLIENT ONBOARDING
// ==========================================
export const onboardClient = async (req, res, next) => {
  try {
    const {
      // 1. Client & Brand Info
      companyName,
      brandName,
      clientName,
      roleTitle,
      email,
      phone,
      street,
      city,
      state,
      postalCode,
      country,
      gstin,
      website,
      websiteUrl,
      domainAccount = 'Our Account',
      domainProvider = '',
      domainPurchaseDate = '',
      domainDurationYears = 1,
      hostingAccount = 'Our Account',
      social,

      // 2. Commercial / Plan
      planId,
      planName,
      billingType,
      dealTotal,
      discountType,
      discountValue,
      customLineItems,
      tdsPercent = 0,
      paymentType = 'Full',
      gstPercent = 18,
      branch = 'Rohini',
      vertical = 'PRITTAL',
      closingType = 'Self closure',
      invoiceNumber = '',
      gstNumber,
      tanNumber,

      // 3. Payment
      amountPaid,
      paymentMode,
      paymentRef,
      paidOn,
      proofUrl,
      paymentNotes,

      // 4. Project Details
      projectName,
      whatsappGroupName,
      kickoffNotes,
      startDate,
      deadline,
      deliverablesQuota
    } = req.body;

    if (!brandName && !companyName) {
      return res.status(400).json({ success: false, message: 'Brand Name or Company Name is required.' });
    }
    if (!clientName || !clientName.trim()) {
      return res.status(400).json({ success: false, message: 'Client / Contact Person Name is required.' });
    }
    if (!phone || !phone.trim()) {
      return res.status(400).json({ success: false, message: 'Contact Phone Number is required.' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, message: 'Client Email Address is required.' });
    }

    const paidNum = Number(amountPaid) || 0;
    if (paidNum <= 0 && paymentType !== 'Full') {
      return res.status(400).json({ success: false, message: 'Paid Amount must be greater than 0 to complete sales onboarding.' });
    }

    const effCompanyName = (companyName || brandName).trim();
    const effBrandName = (brandName || companyName).trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();

    // 1. Create or Find/Update Client
    let client = await Client.findOne({
      $or: [
        { companyName: new RegExp(`^${effCompanyName}$`, 'i') },
        { company: new RegExp(`^${effCompanyName}$`, 'i') },
        { displayName: new RegExp(`^${effBrandName}$`, 'i') },
        { 'contacts.email': cleanEmail },
        { 'contacts.phone': cleanPhone }
      ]
    });

    const clientAddressObj = {
      street: street || '',
      city: city || '',
      state: state || '',
      postalCode: postalCode || '',
      country: country || 'India'
    };

    const primaryContact = {
      name: clientName.trim(),
      roleTitle: roleTitle || 'Primary Contact',
      email: cleanEmail,
      phone: cleanPhone,
      isPrimary: true
    };

    if (!client) {
      client = await Client.create({
        customId: 'c_' + Math.random().toString(36).substring(2, 9),
        company: effCompanyName,
        companyName: effCompanyName,
        displayName: effBrandName,
        brandName: effBrandName,
        contact: clientName.trim(),
        email: cleanEmail,
        phone: cleanPhone,
        industry: industry || 'Digital Marketing',
        billingAddress: clientAddressObj,
        shippingAddress: clientAddressObj,
        gstin: (gstNumber || gstin || '').toUpperCase().trim(),
        pan: (tanNumber || pan || '').toUpperCase().trim(),
        website: website || '',
        ownerId: req.user?.id || '',
        ownerName: req.user?.name || 'Sales Admin',
        status: 'Customer',
        paymentStatus: 'paid',
        contacts: [primaryContact],
        notes: kickoffNotes || `Client onboarded via Sales Admin flow on ${new Date().toISOString().split('T')[0]}.`
      });
    } else {
      client.status = 'Customer';
      client.paymentStatus = 'paid';
      if (!client.displayName) client.displayName = effBrandName;
      if (gstin && !client.gstin) client.gstin = gstin.toUpperCase().trim();
      if (pan && !client.pan) client.pan = pan.toUpperCase().trim();
      if (website && !client.website) client.website = website;
      if (street || city) {
        client.billingAddress = { ...client.billingAddress, ...clientAddressObj };
        client.shippingAddress = { ...client.shippingAddress, ...clientAddressObj };
      }
      const hasContact = client.contacts && client.contacts.some(c => c.email === cleanEmail || c.phone === cleanPhone);
      if (!hasContact) {
        client.contacts.push(primaryContact);
      }
      await client.save();
    }

    const clientId = client.customId || client._id.toString();

    // 2. Fetch Plan Snapshot if planId provided
    let planSnapshot = null;
    let basePrice = Number(dealTotal) || paidNum;
    if (planId) {
      const plan = await Plan.findOne(findByIdOrCustomId(planId));
      if (plan) {
        planSnapshot = {
          planId: plan.customId || plan._id.toString(),
          name: plan.name,
          code: plan.code,
          description: plan.description,
          billingType: plan.billingType,
          basePrice: plan.basePrice,
          gstPercent: plan.gstPercent || 18,
          includes: plan.includes,
          deliverablesQuota: plan.deliverablesQuota,
          content: plan.content
        };
        if (!dealTotal) {
          basePrice = plan.basePrice;
        }
      }
    }

    const lineItems = Array.isArray(customLineItems) ? customLineItems : [];
    const discVal = Number(discountValue) || 0;
    const finalBase = Number(basePrice) || (Number(dealTotal) || paidNum);
    const discAmount = discountType === 'percentage' ? Math.round((finalBase * discVal) / 100) : discVal;
    const taxable = Math.max(0, finalBase - discAmount);
    const numGst = Number(gstPercent) || 18;
    const computedGstAmount = Math.round((taxable * numGst) / 100);
    const computedTotalWithGst = taxable + computedGstAmount;
    const numTds = Number(tdsPercent) || 0;
    const computedTdsAmount = Math.round((taxable * numTds) / 100);
    const computedTotalPayable = Math.max(0, computedTotalWithGst - computedTdsAmount);
    const effAmountPaid = paymentType === 'Full' ? computedTotalPayable : (paidNum > 0 ? paidNum : computedTotalPayable);
    const computedBalance = Math.max(0, computedTotalPayable - effAmountPaid);

    const currentYear = new Date().getFullYear();
    const dealCount = await Deal.countDocuments();
    const dealSeq = String(dealCount + 1).padStart(4, '0');
    const dealCode = `DL-${currentYear}-${dealSeq}`;

    // 3. Create Deal
    const deal = await Deal.create({
      customId: 'd_' + Math.random().toString(36).substring(2, 9),
      dealCode,
      clientId,
      clientName: effCompanyName,
      title: `${effBrandName} — ${planName || planSnapshot?.name || 'Onboarding Package'}`,
      ownerId: req.user?.id || '',
      ownerName: req.user?.name || 'Sales Admin',
      planId: planId || '',
      planSnapshot: planSnapshot || {
        name: planName || 'Standard Package',
        billingType: billingType || 'Monthly',
        basePrice: taxable,
        deliverablesQuota: deliverablesQuota || { creatives: 4, aiReels: 4, festival: true }
      },
      customLineItems: lineItems,
      discountType: discountType || 'fixed',
      discountValue: discVal,
      discountAmount: discAmount,
      subtotal: taxable,
      gstPercent: numGst,
      gstAmount: computedGstAmount,
      total: computedTotalWithGst,
      currency: 'INR',
      expectedCloseDate: paidOn || new Date().toISOString().split('T')[0],
      websiteUrl: websiteUrl || website || '',
      domainAccount: domainAccount || 'Our Account',
      status: 'Converted',
      activity: [
        {
          actor: req.user?.name || 'Sales Admin',
          from: 'Draft',
          to: 'Converted',
          time: new Date(),
          note: `Deal created & converted on payment of ${formatINR(paidNum)}.`
        }
      ]
    });

    const dealId = deal.customId || deal._id.toString();

    // 4. Record Payment
    const payment = await Payment.create({
      customId: 'pay_' + Math.random().toString(36).substring(2, 9),
      dealId,
      dealCode: deal.dealCode,
      clientId,
      clientName: effCompanyName,
      amount: paidNum,
      mode: paymentMode || 'UPI',
      reference: paymentRef || `UTR-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
      paidOn: paidOn || new Date().toISOString().split('T')[0],
      proofUrl: proofUrl || '',
      recordedBy: req.user?.name || 'Sales Admin',
      recordedById: req.user?.id || '',
      notes: paymentNotes || `Onboarding payment confirmation.`
    });

    // 5. Create Project for Production Administration
    const todayStr = new Date().toISOString().split('T')[0];
    const targetStartDate = startDate || todayStr;
    const targetDeadline = deadline || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const effPlanDuration = billingType || planSnapshot?.billingType || 'Monthly';

    let computedNextRenewal = targetStartDate;
    const billNorm = effPlanDuration.toUpperCase();
    const refDate = new Date(targetStartDate);
    refDate.setHours(12, 0, 0, 0);
    if (billNorm.includes('QUARTER')) refDate.setMonth(refDate.getMonth() + 3);
    else if (billNorm.includes('HALF') || billNorm.includes('6')) refDate.setMonth(refDate.getMonth() + 6);
    else if (billNorm.includes('ANNUAL') || billNorm.includes('YEAR')) refDate.setFullYear(refDate.getFullYear() + 1);
    else if (billNorm.includes('WEEK')) refDate.setDate(refDate.getDate() + 7);
    else refDate.setMonth(refDate.getMonth() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    computedNextRenewal = `${refDate.getFullYear()}-${pad(refDate.getMonth() + 1)}-${pad(refDate.getDate())}`;
    const effectiveProjectName = (projectName && projectName.trim()) ? projectName.trim() : `${effBrandName} Campaign`;

    const quota = deliverablesQuota || planSnapshot?.deliverablesQuota || {
      creatives: 4,
      carousels: 0,
      aiReels: 4,
      basicReels: 0,
      longVideos: 0,
      festival: true,
      blogs: 0,
      gmb: false
    };

    const content = planSnapshot?.content || {
      creatives: quota.creatives || 4,
      carousels: quota.carousels || 0,
      shorts: quota.aiReels || 4,
      aiVideos: 0,
      longVideos: quota.longVideos || 0,
      festivalContent: quota.festival ? 1 : 0,
      blogs: quota.blogs || 0
    };

    // Check if project already exists for this client / company to prevent duplication
    let project = await Project.findOne({
      $or: [
        { companyName: new RegExp(`^${effCompanyName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        { name: new RegExp(`^${effCompanyName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i') },
        { client: new RegExp(`^${effCompanyName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        { clientId: clientId }
      ]
    });

    if (!project) {
      project = await Project.create({
      customId: 'proj_' + Math.random().toString(36).substring(2, 9),
      name: effectiveProjectName,
      companyName: effCompanyName,
      brandName: effBrandName,
      clientName: clientName.trim(),
      clientPhone: cleanPhone,
      clientEmail: cleanEmail,
      clientAddress: clientAddressObj,
      clientId,
      whatsappGroupName: whatsappGroupName || `${effBrandName} Official Group`,
      client: effCompanyName,
      services: planName ? [planName] : (planSnapshot?.name ? [planSnapshot.name] : ['SMO & Content Strategy']),
      salesTeam: [req.user?.name || 'Sales Admin'],
      accountManager: 'Unassigned',
      productionManager: 'Tushar',
      assignedMembers: [],
      salesDate: todayStr,
      handoverDate: targetStartDate,
      startDate: targetStartDate,
      taskStartDate: targetStartDate,
      deadline: targetDeadline,
      renewalDate: targetStartDate,
      nextRenewalDate: computedNextRenewal,
      renewalStatus: 'NEW',
      planDuration: effPlanDuration,
      deliverablesQuota: quota,
      content,
      social: social || {
        facebook: '',
        instagram: '',
        linkedin: '',
        twitter: '',
        youtube: '',
        whatsapp: cleanPhone
      },
      budget: formatINR(finalTotal),
      progress: 0,
      status: 'planning',
      websiteUrl: websiteUrl || website || '',
      domainAccount: domainAccount || 'Our Account',
      domainProvider: domainProvider || '',
      domainPurchaseDate: domainPurchaseDate || '',
      domainDurationYears: Number(domainDurationYears) || 1,
      hostingAccount: hostingAccount || 'Our Account',

      // Handoff & Production Admin Delegation
      sourceDealId: dealId,
      soldPlanName: planName || planSnapshot?.name || deal.title,
      soldPlanCode: planSnapshot?.code || 'CUSTOM',
      planSnapshot: planSnapshot || deal.planSnapshot,
      handoffStatus: 'Awaiting Admin Assignment',
      kickoffNotes: kickoffNotes || `Client brand ${effBrandName} onboarded. Payment verified (${formatINR(paidNum)}). Ready for Account Manager assignment.`,
      activity: [
        {
          date: todayStr,
          event: `Client onboarded by ${req.user?.name || 'Sales Admin'}. Payment verified (${formatINR(paidNum)}). Project created and queued for Production Admin assignment.`
        }
      ]
      });

      await generateDeliverablesForProjectBackend(project, true);
    }

    const projectId = project.customId || project._id.toString();

    // Link deal & client to project
    deal.projectId = projectId;
    await deal.save();

    client.projects = project.name;
    await client.save();

    // Auto-create SalesContract entry for Master Sales Sheet syncing
    try {
      const contractCount = await SalesContract.countDocuments();
      const amtReleasedWithoutGst = effAmountPaid / (1 + (numGst / 100));
      const scCustomId = 'sc_' + Math.random().toString(36).substring(2, 9);
      const nowRef = new Date(targetStartDate);

      await SalesContract.create({
        customId: scCustomId,
        srNo: contractCount + 1,
        month: nowRef.toLocaleString('default', { month: 'long' }),
        year: nowRef.getFullYear(),
        dateOfSales: targetStartDate,
        dateOfLogin: targetStartDate,
        companyName: effCompanyName,
        brandName: effBrandName,
        fullContractValue: taxable,
        amountReleasedWithGst: effAmountPaid,
        amountReleasedWithoutGst: amtReleasedWithoutGst,
        amountReleasedAfterTds: amtReleasedWithoutGst,
        balancePayment: computedBalance,
        tdsPercent: numTds,
        tdsAmount: computedTdsAmount,
        totalPayable: computedTotalPayable,
        paymentType: paymentType || (computedBalance > 0 ? 'Partial' : 'Full'),
        tds: numTds > 0 ? `${numTds}%` : '0%',
        paymentCycle: effPlanDuration,
        modeOfPayment: paymentMode || 'UPI',
        paymentRefNo: paymentRef || '',
        renewalDate: computedNextRenewal,
        contractType: 'NEW',
        plan: planName || planSnapshot?.name || 'Standard Package',
        planPrice: taxable,
        customerName: clientName.trim(),
        customerPhone: cleanPhone,
        email: cleanEmail,
        clientId: client.customId || client._id.toString(),
        dealId: deal.dealCode,
        projectId: projectId,
        branch: branch || 'Rohini',
        vertical: vertical || 'PRITTAL',
        closingType: closingType || 'Self closure',
        invoiceNumber: invoiceNumber || '',
        gstNumber: (gstNumber || gstin || '').toUpperCase().trim(),
        tanNumber: (tanNumber || pan || 'NA').toUpperCase().trim(),
        websiteUrl: websiteUrl || website || '',
        domainAccount: domainAccount || 'Our Account',
        domainProvider: domainProvider || '',
        domainPurchaseDate: domainPurchaseDate || '',
        domainDurationYears: Number(domainDurationYears) || 1,
        remarks: paymentNotes || kickoffNotes || '',
        soldBy: req.user?.name || 'Sales Admin'
      });

      // Create paid invoice entry
      await Invoice.create({
        customId: 'inv_' + Math.random().toString(36).substring(2, 9),
        client: effCompanyName || effBrandName,
        amount: `₹${effAmountPaid.toLocaleString('en-IN')}`,
        dueDate: targetStartDate,
        date: targetStartDate,
        status: 'paid'
      });
    } catch (scErr) {
      console.warn('Failed to auto-create SalesContract in onboardClient:', scErr.message);
    }

    // Auto-dispatch Proforma Invoice (PI) & Payment Confirmation Email to Client + Sales Rep
    const salesRep = {
      name: req.user?.name || 'Sales Admin',
      email: req.user?.email || 'sales@prittal.com'
    };
    let emailReceipt = null;
    try {
      emailReceipt = await sendPaymentAndPIDocumentEmail({
        deal,
        client: client.toObject(),
        payment,
        salesRep,
        docType: 'PI'
      });
    } catch (mailErr) {
      console.error('Email dispatch error (non-blocking):', mailErr);
    }

    // 6. Broadcast Real-Time Notification to Superadmin & Production Admins
    const superAdminUsers = await User.find({ role: 'superadmin' });
    const adminRecipients = new Set(['superadmin', ...(superAdminUsers.map(u => u.customId || u._id.toString()))]);
    for (const adminId of adminRecipients) {
      await Notification.create({
        customId: 'notif_' + Math.random().toString(36).substring(2, 9),
        userId: adminId,
        recipientName: 'Super Admin',
        title: `🚨 New Client Onboarded & PI: ${effBrandName} (${formatINR(paidNum)})`,
        message: `Client "${effBrandName}" (${effCompanyName}) was onboarded by ${req.user?.name || 'Sales Admin'} with payment of ${formatINR(paidNum)} via ${paymentMode || 'UPI'}. Proforma Invoice [PI-PROD-${deal.dealCode}] created and sent to client (${cleanEmail}) & sales (${salesRep.email}).`,
        type: 'invoice_paid',
        relatedId: dealId
      });
    }

    broadcastRealtimeUpdate('PROJECT_CREATED', { project, client, deal });

    res.status(201).json({
      success: true,
      message: `Client "${effBrandName}" successfully onboarded! Proforma Invoice & payment confirmation emailed to client and sales team.`,
      data: {
        client,
        deal,
        payment,
        project,
        emailDispatched: emailReceipt
      }
    });
  } catch (err) {
    next(err);
  }
};

// ==========================================
// 11. EXPLICIT EMAIL DISPATCH (PI / INVOICE)
// ==========================================
export const sendDocumentEmail = async (req, res, next) => {
  try {
    const rawDealId = req.params.dealId;
    const { 
      docType = 'PI', 
      customRecipient, 
      clientEmail, 
      salesEmail, 
      cc, 
      subject: customSubject, 
      message: customMessage,
      dealData,
      clientData,
      dealId: bodyDealId
    } = req.body;

    const lookupId = (rawDealId && rawDealId !== 'undefined' && rawDealId !== 'null') ? rawDealId : bodyDealId;

    let deal = null;
    if (lookupId) {
      deal = await Deal.findOne(findByIdOrCustomId(lookupId));
      if (!deal) {
        deal = await Deal.findOne({ dealCode: lookupId });
      }
    }

    // If deal not found directly, check if lookupId belongs to a project
    if (!deal && lookupId) {
      const project = await Project.findOne({
        $or: [
          { customId: lookupId },
          { sourceDealId: lookupId },
          { dealCode: lookupId }
        ]
      });
      if (project) {
        deal = {
          id: project.sourceDealId || project.customId || project._id?.toString(),
          customId: project.sourceDealId || project.customId,
          dealCode: project.sourceDealId || 'DL-2026-0001',
          title: `${project.brandName || project.companyName || project.name} Retainer Agreement`,
          total: Number(project.budget) || 25000,
          subtotal: (Number(project.budget) || 25000) / 1.18,
          gstAmount: (Number(project.budget) || 25000) - ((Number(project.budget) || 25000) / 1.18),
          clientId: project.clientId,
          clientName: project.companyName || project.brandName,
          clientEmail: project.clientEmail,
          ownerId: project.ownerId,
          ownerName: project.manager || 'Production & Sales Team',
          planSnapshot: project.planSnapshot ? {
            ...project.planSnapshot,
            category: project.planSnapshot.category || (String(project.soldPlanName || project.planSnapshot.name || '').toLowerCase().includes('website') ? 'Website' : (project.serviceType || 'Website'))
          } : {
            name: project.soldPlanName || 'Standard Website',
            category: String(project.soldPlanName || '').toLowerCase().includes('website') ? 'Website' : (project.serviceType || 'Website'),
            deliverablesQuota: project.deliverablesQuota,
            content: project.content
          }
        };
      }
    }

    // If still no deal, use dealData provided from frontend preview drawer
    if (!deal && dealData) {
      deal = dealData;
    }

    if (!deal) {
      return res.status(404).json({ success: false, message: 'Deal or project agreement record not found.' });
    }

    // Resolve client
    let client = null;
    const cId = deal.clientId || clientData?.id || clientData?.customId;
    if (cId) {
      client = await Client.findOne(findByIdOrCustomId(cId));
    }

    // Resolve client email:
    const contactEmail = client?.contacts?.find(c => c.isPrimary)?.email || client?.contacts?.[0]?.email || client?.email;
    const resolvedClientEmail = clientEmail 
      || customRecipient 
      || clientData?.email 
      || contactEmail 
      || deal.clientEmail 
      || '';

    const targetClientObj = client ? client.toObject() : {
      companyName: clientData?.companyName || clientData?.name || deal.clientName || 'Client',
      name: clientData?.name || deal.clientName || 'Client',
      phone: clientData?.phone || ''
    };
    targetClientObj.email = resolvedClientEmail;

    // Resolve sales executive
    let salesRepUser = null;
    if (deal.ownerId) {
      salesRepUser = await User.findOne(findByIdOrCustomId(deal.ownerId));
    }
    const resolvedSalesEmail = salesEmail 
      || salesRepUser?.email 
      || deal.ownerEmail 
      || req.user?.email 
      || 'sales@prittal.com';

    const salesRep = {
      name: salesRepUser?.name || deal.ownerName || req.user?.name || 'Sales Team',
      email: resolvedSalesEmail
    };

    const dId = deal.customId || deal._id?.toString() || deal.id;
    let latestPayment = null;
    let totalPaid = Number(deal.paidAmount) || 0;
    if (dId) {
      const allDealPayments = await Payment.find({
        $or: [
          { dealId: dId },
          { dealId: deal.customId },
          { dealCode: deal.dealCode }
        ]
      }).sort({ createdAt: -1 });
      if (allDealPayments.length > 0) {
        latestPayment = allDealPayments[0];
        totalPaid = allDealPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
      }
    }
    deal.paidAmount = totalPaid;

    const dispatchResult = await sendPaymentAndPIDocumentEmail({
      deal,
      client: targetClientObj,
      payment: latestPayment,
      salesRep,
      docType,
      clientEmail: resolvedClientEmail,
      salesEmail: resolvedSalesEmail,
      cc,
      customSubject,
      customMessage
    });

    if (deal && deal.activity && typeof deal.save === 'function') {
      deal.activity.push({
        actor: req.user?.name || 'Sales Executive',
        from: '',
        to: '',
        time: new Date(),
        note: `📧 Dispatched ${docType} document email to ${dispatchResult.recipients.join(' & ')}.`
      });
      await deal.save();
    }

    res.json({
      success: true,
      message: `${docType === 'PI' || docType === 'PI_PRODUCTION' ? 'Proforma Invoice (PI)' : 'Commercial Document'} emailed successfully to ${dispatchResult.recipients.join(' & ')}.`,
      data: dispatchResult
    });
  } catch (err) {
    console.error('Email dispatch error:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Failed to dispatch document email.'
    });
  }
};

/**
 * Public/Accessible stream endpoint for document PDF
 * GET /api/sales/documents/:id/pdf
 */
export const downloadDocumentPdf = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { docType = 'PI' } = req.query;

    const cleanId = String(id).replace(/^(PI-PROD-|INV-)/, '');
    let deal = await Deal.findOne({
      $or: [
        { dealCode: id },
        { dealCode: cleanId },
        { customId: id },
        { customId: cleanId },
        ...(mongoose.isValidObjectId(id) ? [{ _id: id }] : []),
        ...(mongoose.isValidObjectId(cleanId) ? [{ _id: cleanId }] : [])
      ]
    });

    if (!deal) {
      const project = await Project.findOne({
        $or: [
          { customId: id },
          { customId: cleanId },
          { sourceDealId: id },
          { sourceDealId: cleanId }
        ]
      });
      if (project) {
        deal = {
          dealCode: cleanId,
          title: project.soldPlanName || project.name,
          planSnapshot: project.planSnapshot ? {
            ...project.planSnapshot,
            category: project.planSnapshot.category || (String(project.soldPlanName || project.planSnapshot.name || '').toLowerCase().includes('website') ? 'Website' : (project.serviceType || 'Website'))
          } : {
            name: project.soldPlanName || 'Standard Website',
            category: String(project.soldPlanName || '').toLowerCase().includes('website') ? 'Website' : (project.serviceType || 'Website'),
            deliverablesQuota: project.deliverablesQuota,
            content: project.content
          },
          total: Number(project.budget) || 0,
          subtotal: Number(project.budget) || 0,
          clientId: project.clientId,
          clientName: project.companyName || project.client
        };
      }
    }

    if (!deal) {
      return res.status(404).send('Document or deal not found.');
    }

    let client = null;
    if (deal.clientId) {
      client = await Client.findOne(findByIdOrCustomId(deal.clientId));
    }

    const isPI = docType === 'PI' || docType === 'PI_PRODUCTION' || String(id).startsWith('PI-PROD-');
    const dealCode = deal.dealCode || cleanId || 'DL-2026-0001';
    const docCode = isPI ? `PI-PROD-${dealCode}` : `INV-${dealCode}`;

    const dId = deal.customId || deal._id?.toString() || deal.id;
    let latestPayment = null;
    let totalPaid = Number(deal.paidAmount) || 0;
    if (dId) {
      const allDealPayments = await Payment.find({
        $or: [
          { dealId: dId },
          { dealId: deal.customId },
          { dealCode: deal.dealCode },
          { dealCode: cleanId }
        ]
      }).sort({ createdAt: -1 });
      if (allDealPayments.length > 0) {
        latestPayment = allDealPayments[0];
        totalPaid = allDealPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
      }
    }
    deal.paidAmount = totalPaid;

    const pdfBuffer = await generateDocumentPdfBuffer({
      deal,
      client,
      payment: latestPayment,
      salesRep: { name: deal.ownerName || 'Sales Team', email: deal.ownerEmail || 'sales@prittal.com' },
      docType: isPI ? 'PI' : 'INV'
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${docCode}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF download stream error:', err);
    res.status(500).send('Error generating PDF document.');
  }
};

// ==========================================
// 11. SALES CALLERS & SALES REPS ENDPOINTS
// ==========================================

export const getCallers = async (req, res, next) => {
  try {
    const [salesUsers, salesTeamMembers] = await Promise.all([
      User.find({
        $or: [
          { department: 'Sales' },
          { designation: /caller|sales/i },
          { role: /sales|caller/i }
        ]
      }).select('-passwordHash'),
      TeamMember.find({
        $or: [
          { department: 'Sales' },
          { role: /caller|sales/i }
        ]
      })
    ]);

    const callerMap = new Map();

    // 1. Add team members
    salesTeamMembers.forEach(tm => {
      const normKey = (tm.name || '').toLowerCase().trim();
      if (!normKey) return;
      callerMap.set(normKey, {
        id: tm.customId || tm._id.toString(),
        customId: tm.customId || tm._id.toString(),
        name: tm.name,
        role: tm.role || 'Telecaller',
        department: tm.department || 'Sales',
        status: tm.availability === 'Available' ? 'Active' : (tm.availability || 'Active'),
        joinedDate: tm.createdAt ? new Date(tm.createdAt).toISOString().split('T')[0] : '2026-01-15',
        phone: '',
        email: `${normKey.replace(/[^a-z0-9]/g, '')}@sales.crm`,
        username: normKey.replace(/[^a-z0-9]/g, '')
      });
    });

    // 2. Overlay / enrich with User accounts
    salesUsers.forEach(u => {
      const normKey = (u.name || '').toLowerCase().trim();
      if (!normKey) return;
      const existing = callerMap.get(normKey);
      callerMap.set(normKey, {
        ...(existing || {}),
        id: u.customId || u._id.toString(),
        customId: u.customId || u._id.toString(),
        name: u.name,
        role: u.designation || (u.role === 'administrator' ? 'Sales Admin' : 'Telecaller'),
        department: u.department || 'Sales',
        email: u.email,
        username: u.username || u.email.split('@')[0],
        phone: u.phone || existing?.phone || '',
        status: 'Active',
        joinedDate: u.createdAt ? new Date(u.createdAt).toISOString().split('T')[0] : existing?.joinedDate || '2026-01-15'
      });
    });

    // Guarantee default 'Manish' is always present
    if (!callerMap.has('manish')) {
      callerMap.set('manish', {
        id: 'caller_manish',
        customId: 'caller_manish',
        name: 'Manish',
        role: 'Senior Sales Caller',
        department: 'Sales',
        email: 'manish@sales.crm',
        username: 'manish',
        phone: '+91 98765 43210',
        status: 'Active',
        joinedDate: '2026-01-15'
      });
    }

    const callers = Array.from(callerMap.values());
    res.json({ success: true, count: callers.length, data: callers });
  } catch (err) {
    next(err);
  }
};

export const createCaller = async (req, res, next) => {
  try {
    const { name, role, phone, email, username, password, status } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Caller name is required.' });
    }

    const trimmedName = name.trim();
    const cleanUsername = (username || trimmedName.toLowerCase().replace(/[^a-z0-9]/g, '')).trim();
    const cleanEmail = (email || `${cleanUsername}@sales.crm`).toLowerCase().trim();
    const cleanRole = (role || 'Telecaller').trim();
    const cleanPassword = (password || 'Caller@123').trim();
    const cleanPhone = (phone || '').trim();

    // Check if User already exists
    let existingUser = await User.findOne({
      $or: [
        { email: cleanEmail },
        { username: cleanUsername },
        { name: trimmedName }
      ]
    });

    let targetUserId;
    if (!existingUser) {
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(cleanPassword, salt);
      const isSalesAdmin = cleanRole.toLowerCase().includes('admin');
      const newUser = await User.create({
        customId: 'u_' + Math.random().toString(36).substring(2, 9),
        name: trimmedName,
        username: cleanUsername,
        email: cleanEmail,
        passwordHash,
        department: 'Sales',
        designation: cleanRole,
        role: isSalesAdmin ? 'sales_admin' : 'member',
        phone: cleanPhone,
        createdBy: req.user?.id || 'sales_admin',
        isVerified: true
      });
      targetUserId = newUser.customId || newUser._id.toString();
      existingUser = newUser;
    } else {
      targetUserId = existingUser.customId || existingUser._id.toString();
      existingUser.designation = cleanRole;
      existingUser.department = 'Sales';
      if (cleanPhone) existingUser.phone = cleanPhone;
      await existingUser.save();
    }

    // Check / Sync TeamMember
    let teamMember = await TeamMember.findOne({
      $or: [
        { name: trimmedName },
        { customId: targetUserId }
      ]
    });

    if (!teamMember) {
      teamMember = await TeamMember.create({
        customId: targetUserId.startsWith('tm_') ? targetUserId : 'tm_' + targetUserId.replace('u_', ''),
        name: trimmedName,
        department: 'Sales',
        role: cleanRole,
        workload: 0,
        availability: status === 'Inactive' ? 'OOF' : 'Available',
        performance: 90
      });
    } else {
      teamMember.role = cleanRole;
      teamMember.department = 'Sales';
      teamMember.availability = status === 'Inactive' ? 'OOF' : 'Available';
      await teamMember.save();
    }

    const callerObj = {
      id: targetUserId,
      customId: targetUserId,
      teamMemberId: teamMember.customId || teamMember._id.toString(),
      name: trimmedName,
      role: cleanRole,
      department: 'Sales',
      email: cleanEmail,
      username: cleanUsername,
      password: cleanPassword,
      phone: cleanPhone,
      status: status || 'Active',
      joinedDate: new Date().toISOString().split('T')[0]
    };

    broadcastRealtimeUpdate('CALLER_CREATED', { caller: callerObj });

    res.status(201).json({
      success: true,
      message: `Caller "${trimmedName}" saved successfully in backend database!`,
      data: callerObj
    });
  } catch (err) {
    next(err);
  }
};

export const updateCaller = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, role, phone, email, username, password, status } = req.body;

    const user = await User.findOne(findByIdOrCustomId(id));
    if (user) {
      if (name) user.name = name.trim();
      if (role) user.designation = role.trim();
      if (phone !== undefined) user.phone = phone.trim();
      if (email) user.email = email.toLowerCase().trim();
      if (username) user.username = username.toLowerCase().trim();
      if (password && password.trim().length >= 4) {
        const salt = await bcrypt.genSalt(10);
        user.passwordHash = await bcrypt.hash(password.trim(), salt);
      }
      await user.save();
    }

    const tm = await TeamMember.findOne({
      $or: [{ customId: id }, ...(user ? [{ name: user.name }] : [])]
    });
    if (tm) {
      if (name) tm.name = name.trim();
      if (role) tm.role = role.trim();
      if (status) tm.availability = status === 'Inactive' ? 'OOF' : 'Available';
      await tm.save();
    }

    const updatedCaller = {
      id: user?.customId || user?._id.toString() || id,
      name: user?.name || tm?.name || name,
      role: user?.designation || tm?.role || role,
      department: 'Sales',
      email: user?.email || email,
      username: user?.username || username,
      phone: user?.phone || phone,
      status: status || 'Active'
    };

    broadcastRealtimeUpdate('CALLER_UPDATED', { caller: updatedCaller });

    res.json({
      success: true,
      message: 'Caller updated successfully in backend.',
      data: updatedCaller
    });
  } catch (err) {
    next(err);
  }
};

export const deleteCaller = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = await User.findOne(findByIdOrCustomId(id));
    const nameToDelete = user?.name;

    if (user) {
      await User.deleteOne({ _id: user._id });
    }

    await TeamMember.deleteMany({
      $or: [
        { customId: id },
        ...(nameToDelete ? [{ name: nameToDelete }] : [])
      ]
    });

    broadcastRealtimeUpdate('CALLER_DELETED', { id, name: nameToDelete });

    res.json({
      success: true,
      message: `Caller removed from backend database.`
    });
  } catch (err) {
    next(err);
  }
};

// ==========================================
// SALES CONTRACTS & EXCEL SALES SHEET SYNC
// ==========================================

export const getSalesContracts = async (req, res, next) => {
  try {
    let contracts = await SalesContract.find({ isDeleted: { $ne: true }, isActive: { $ne: false } }).sort({ srNo: 1, rowNum: 1 });
    
    // If no contracts have been synced yet, auto-sync from Excel on first request
    if (contracts.length === 0) {
      try {
        const syncResult = await syncSalesContractsFromExcel();
        contracts = syncResult.contracts.filter(c => !c.isDeleted && c.isActive !== false);
      } catch (syncErr) {
        console.warn('Initial sales contracts auto-sync notice:', syncErr.message);
      }
    }

    res.json({
      success: true,
      count: contracts.length,
      data: contracts,
      contracts: contracts
    });
  } catch (err) {
    next(err);
  }
};

export const getSalesContractsByClient = async (req, res, next) => {
  try {
    const { clientId } = req.params;
    if (!clientId) {
      return res.status(400).json({ success: false, message: 'Client ID is required.' });
    }

    // Also look up client to get companyName for matching
    const client = await Client.findOne(findByIdOrCustomId(clientId));
    const companyName = client?.companyName || client?.company || '';
    const normCompany = companyName.toLowerCase().replace(/[^a-z0-9]/g, '').trim();

    let query = {
      isDeleted: { $ne: true },
      isActive: { $ne: false },
      $or: [
        { clientId },
        ...(client?.customId ? [{ clientId: client.customId }] : [])
      ]
    };

    if (normCompany) {
      // Find contracts that match client ID or normalized company name
      const allContracts = await SalesContract.find({ isDeleted: { $ne: true }, isActive: { $ne: false } });
      const matched = allContracts.filter(c => {
        if (c.clientId === clientId || (client?.customId && c.clientId === client.customId)) return true;
        const cComp = (c.companyName || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        return normCompany && (cComp.includes(normCompany) || normCompany.includes(cComp));
      });

      return res.json({
        success: true,
        count: matched.length,
        data: matched,
        contracts: matched
      });
    }

    const contracts = await SalesContract.find(query).sort({ srNo: 1 });
    res.json({
      success: true,
      count: contracts.length,
      data: contracts,
      contracts: contracts
    });
  } catch (err) {
    next(err);
  }
};


export const deleteSalesContract = async (req, res, next) => {
  try {
    const { id } = req.params;
    const contract = await SalesContract.findOneAndUpdate(
      findByIdOrCustomId(id),
      { $set: { isDeleted: true, isActive: false } },
      { new: true }
    );
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contract not found' });
    }
    if (contract.invoiceNumber) {
      await Invoice.deleteMany({ $or: [{ customId: contract.invoiceNumber }, { invoiceNumber: contract.invoiceNumber }] }).catch(() => {});
    }
    broadcastRealtimeUpdate('CONTRACT_DELETED', { id: contract._id.toString(), contractId: contract._id.toString(), customId: contract.customId });
    res.json({ success: true, message: 'Contract deleted successfully', data: contract });
  } catch (err) {
    next(err);
  }
};

export const updateSalesContract = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const prevContract = await SalesContract.findOne(findByIdOrCustomId(id));
    const prevCompanyName = prevContract?.companyName || '';

    // Numerical conversions for editable price section
    const numericFields = [
      'fullContractValue',
      'amountReleasedWithGst',
      'amountReleasedWithoutGst',
      'amountReleasedAfterTds',
      'balancePayment',
      'saleAmount',
      'planPrice',
      'tdsPercent',
      'tdsAmount',
      'totalPayable',
      'gstPercent',
      'gstAmount'
    ];

    numericFields.forEach(f => {
      if (updates[f] !== undefined && updates[f] !== null && updates[f] !== '') {
        const num = parseFloat(String(updates[f]).replace(/[^0-9.-]+/g, ''));
        updates[f] = isNaN(num) ? 0 : num;
      }
    });

    // Map UI alias fields to schema fields
    if (updates.paymentMode !== undefined) updates.modeOfPayment = updates.paymentMode;
    if (updates.paymentReferenceNumber !== undefined) updates.paymentRefNo = updates.paymentReferenceNumber;
    if (updates.salesDate !== undefined) updates.dateOfSales = updates.salesDate;
    if (updates.loginDate !== undefined) updates.dateOfLogin = updates.loginDate;
    if (updates.contractDuration !== undefined) updates.durationOfContract = updates.contractDuration;
    if (updates.balanceDate !== undefined) updates.balancePaymentDate = updates.balanceDate;
    if (updates.gstin !== undefined) updates.gstNumber = updates.gstin;
    if (updates.tan !== undefined) updates.tanNumber = updates.tan;
    if (updates.services !== undefined) updates.typeOfServices = updates.services;
    if (updates.customerAddress !== undefined) updates.companyAddress = updates.customerAddress;
    if (updates.customerEmail !== undefined) updates.email = updates.customerEmail;

    // Synchronize dateOfLogin and month if dateOfSales is supplied
    if (updates.dateOfSales) {
      if (!updates.dateOfLogin || updates.dateOfLogin === prevContract?.dateOfSales || updates.dateOfLogin === prevContract?.dateOfLogin) {
        updates.dateOfLogin = updates.dateOfSales;
        updates.loginDate = updates.dateOfSales;
      }
      updates.salesDate = updates.dateOfSales;

      const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const parts = String(updates.dateOfSales).trim().split(/[/.-]/);
      if (parts.length === 3) {
        let mIdx = -1;
        if (parts[0].length === 4) {
          mIdx = parseInt(parts[1], 10) - 1;
        } else if (parts[2].length === 4) {
          let p1 = parseInt(parts[0], 10);
          let p2 = parseInt(parts[1], 10);
          mIdx = (p1 <= 12 && p2 > 12) ? p1 - 1 : p2 - 1;
        }
        if (mIdx >= 0 && mIdx < 12) {
          updates.month = monthNames[mIdx];
        }
      }
    }

    if (updates.paymentType) {
      const pt = String(updates.paymentType).trim();
      if (pt.toLowerCase() === 'full') updates.paymentType = 'Full';
      else if (pt.toLowerCase() === 'partial') updates.paymentType = 'Partial';
      else delete updates.paymentType;
    }

    // Enforce 0% GST for Cash/M-Cash/M-UPI payment if not explicitly overridden
    const effMode = String(updates.modeOfPayment || updates.paymentMode || prevContract?.modeOfPayment || '').toLowerCase();
    const isCashMode = (effMode.includes('cash') || effMode.includes('m-upi')) && !effMode.includes('gst');
    const hasExplicitGst = updates.hasGst === true || updates.isGstExplicit === true || Boolean((updates.gstNumber || prevContract?.gstNumber) && String(updates.gstNumber || prevContract?.gstNumber).trim().length >= 15);
    if (isCashMode && !hasExplicitGst) {
      if (!updates.isGstExplicit && (updates.gstPercent === undefined || updates.gstPercent === null || updates.gstPercent === '' || Number(updates.gstPercent) === 18)) {
        updates.gstPercent = 0;
        updates.gstAmount = 0;
        if (updates.amountReleasedWithGst !== undefined) {
          updates.amountReleasedWithoutGst = updates.amountReleasedWithGst;
        } else if (prevContract?.amountReleasedWithGst) {
          updates.amountReleasedWithoutGst = prevContract.amountReleasedWithGst;
        }
        const bVal = updates.fullContractValue !== undefined ? Number(updates.fullContractValue) : (prevContract?.fullContractValue || 0);
        const tVal = updates.tdsAmount !== undefined ? Number(updates.tdsAmount) : (prevContract?.tdsAmount || 0);
        updates.totalPayable = Math.max(0, bVal - tVal);
      }
    }

    const updated = await SalesContract.findOneAndUpdate(
      findByIdOrCustomId(id),
      { $set: updates },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Sales contract not found.' });
    }

    // Update child split renewal contract dates if dateOfSales changed
    if (updates.dateOfSales && prevContract?.dateOfSales && updates.dateOfSales !== prevContract.dateOfSales) {
      await updateChildSplitContractsDates(updated, prevContract.dateOfSales, updates.dateOfSales);
    }

    // Bidirectional sync back to Client, sibling contracts, Projects, Deals, and Payments
    await syncContractToLinkedEntities(updated, prevCompanyName);

    broadcastRealtimeUpdate('CONTRACT_UPDATED', { contract: updated });

    res.json({
      success: true,
      message: 'Sales contract and commercial pricing updated successfully.',
      data: updated,
      contract: updated
    });
  } catch (err) {
    next(err);
  }
};

export const syncSalesSheetFromExcel = async (req, res, next) => {
  try {
    const result = await syncSalesContractsFromExcel();
    res.json({
      success: true,
      message: `Successfully synchronized ${result.count} sales contract records from Excel.`,
      count: result.count,
      data: result.contracts,
      contracts: result.contracts,
      contractsCount: result.count,
      linkedProjectsCount: result.linkedProjectsCount
    });
  } catch (err) {
    next(err);
  }
};

// Create a new sales contract manually (not from Excel)
export const createSalesContract = async (req, res, next) => {
  try {
    const body = req.body;
    if (!body.companyName) {
      return res.status(400).json({ success: false, message: 'Company name is required.' });
    }

    // Auto-assign next srNo
    const maxDoc = await SalesContract.findOne({}).sort({ srNo: -1 }).select('srNo');
    const nextSrNo = (maxDoc?.srNo || 0) + 1;

    // Generate a unique customId
    const now = new Date();
    const customId = `SC-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${nextSrNo}`;

    // Numerical conversions
    const numericFields = [
      'fullContractValue', 'amountReleasedWithGst', 'amountReleasedWithoutGst',
      'amountReleasedAfterTds', 'balancePayment', 'saleAmount', 'tdsPercent',
      'tdsAmount', 'totalPayable', 'gstPercent', 'gstAmount'
    ];
    numericFields.forEach(f => {
      if (body[f] !== undefined && body[f] !== null && body[f] !== '') {
        const num = parseFloat(String(body[f]).replace(/[^0-9.-]+/g, ''));
        body[f] = isNaN(num) ? 0 : num;
      }
    });

    // Map UI alias fields to schema fields
    if (body.paymentMode !== undefined) body.modeOfPayment = body.paymentMode;
    if (body.paymentReferenceNumber !== undefined) body.paymentRefNo = body.paymentReferenceNumber;
    if (body.salesDate !== undefined) body.dateOfSales = body.salesDate;
    if (body.loginDate !== undefined) body.dateOfLogin = body.loginDate;
    if (body.contractDuration !== undefined) body.durationOfContract = body.contractDuration;
    if (body.gstin !== undefined) body.gstNumber = body.gstin;
    if (body.services !== undefined) body.typeOfServices = body.services;

    // Determine GST percent: cash/m-cash/m-upi is 0% unless explicitly given, others default to 18%
    const payModeStr = String(body.modeOfPayment || body.paymentMode || '').toLowerCase();
    const isCashMode = (payModeStr.includes('cash') || payModeStr.includes('m-upi')) && !payModeStr.includes('gst');
    const hasExplicitGst = body.hasGst === true || body.isGstExplicit === true || Boolean(body.gstNumber && body.gstNumber.trim().length >= 15);
    let effectiveGst;
    if (isCashMode && !hasExplicitGst) {
      effectiveGst = 0;
    } else if (body.gstPercent !== undefined && body.gstPercent !== null && body.gstPercent !== '') {
      effectiveGst = Number(body.gstPercent);
    } else {
      effectiveGst = isCashMode ? 0 : 18;
    }
    body.gstPercent = effectiveGst;
    if (body.gstAmount === undefined || body.gstAmount === null || effectiveGst === 0) {
      body.gstAmount = effectiveGst > 0 ? Math.round((Number(body.fullContractValue) || 0) * (effectiveGst / 100)) : 0;
    }
    if (effectiveGst === 0 && (!body.amountReleasedWithoutGst || body.amountReleasedWithoutGst === 0)) {
      body.amountReleasedWithoutGst = body.amountReleasedWithGst || 0;
    }

    // Automated Renewal Splitting Logic
    let cycles = 1;
    const cType = (body.contractType || '').toUpperCase();
    const cDuration = (body.contractDuration || body.durationOfContract || body.paymentCycle || '').toUpperCase();
    if (cType.includes('QUARTERLY') || cDuration.includes('QUARTERLY')) {
      cycles = 3;
    } else if (cType.includes('HALF') || cDuration.includes('HALF')) {
      cycles = 6;
    } else if (cType.includes('ANNUAL') || cType.includes('YEARLY') || cDuration.includes('ANNUAL') || cDuration.includes('YEARLY')) {
      cycles = 12;
    }

    let finalBody = { ...body };
    let autoRenewalConfig = { active: false };

    const parsedSalesDate = body.dateOfSales 
      ? new Date(body.dateOfSales.split('/').reverse().join('-')) 
      : now;

    if (cycles > 1) {
      finalBody.fullContractValue = Math.round((finalBody.fullContractValue || 0) / cycles);
      finalBody.amountReleasedWithGst = Math.round((finalBody.amountReleasedWithGst || 0) / cycles);
      finalBody.amountReleasedWithoutGst = Math.round((finalBody.amountReleasedWithoutGst || 0) / cycles);
      finalBody.amountReleasedAfterTds = Math.round((finalBody.amountReleasedAfterTds || 0) / cycles);
      finalBody.balancePayment = Math.round((finalBody.balancePayment || 0) / cycles);
      finalBody.saleAmount = Math.round((finalBody.saleAmount || 0) / cycles);
      
      const gstPercent = finalBody.gstPercent !== undefined ? Number(finalBody.gstPercent) : (isCashMode ? 0 : 18);
      finalBody.gstAmount = Math.round(finalBody.fullContractValue * (gstPercent / 100));

      finalBody.durationOfContract = '1 Month';
      finalBody.contractType = cycles === 3 ? 'QUARTERLY' : cycles === 6 ? 'HALF YEARLY' : 'ANNUAL';
      
      const nextMonth = new Date(parsedSalesDate);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      finalBody.renewalDate = `${String(nextMonth.getDate()).padStart(2, '0')}/${String(nextMonth.getMonth() + 1).padStart(2, '0')}/${nextMonth.getFullYear()}`;
      
      autoRenewalConfig = {
        active: true,
        originalDuration: body.contractDuration || body.contractType || `${cycles} Months`,
        maxCycles: cycles,
        currentCycle: 1,
        parentContractId: null
      };
    }

    const contract = await SalesContract.create({
      ...finalBody,
      autoRenewalConfig,
      customId,
      srNo: nextSrNo,
      month: now.toLocaleString('en-US', { month: 'long' }),
      year: now.getFullYear(),
      dateOfSales: body.dateOfSales || `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`
    });

    // Bidirectional sync to Client, Projects, Deals
    await syncContractToLinkedEntities(contract);

    broadcastRealtimeUpdate('CONTRACT_CREATED', { contract });

    res.status(201).json({
      success: true,
      message: 'New sales contract created successfully.',
      data: contract,
      contract
    });
  } catch (err) {
    next(err);
  }
};

// Settle partial balance payment for a contract
export const settleSalesContractBalance = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { settleAmount, paymentMode, paymentRefNo, paymentDate, invoiceNumber, notes } = req.body;

    const contract = await SalesContract.findOne(findByIdOrCustomId(id));
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Sales contract not found.' });
    }

    const prevBalance = Number(contract.balancePayment) || 0;
    const amountPaid = Number(settleAmount) || prevBalance;
    const nowStr = paymentDate || new Date().toLocaleDateString('en-GB');

    // Update contract numbers
    contract.amountReleasedWithGst = (Number(contract.amountReleasedWithGst) || 0) + amountPaid;
    contract.balancePayment = Math.max(0, prevBalance - amountPaid);
    contract.paymentType = contract.balancePayment === 0 ? 'Full' : 'Partial';
    if (paymentMode) contract.modeOfPayment = paymentMode;
    if (paymentRefNo) contract.paymentRefNo = paymentRefNo;

    // Create an Invoice entry in finance
    const invNum = invoiceNumber || (contract.invoiceNumber ? `${contract.invoiceNumber}-BAL` : ('INV-' + Math.random().toString(36).substring(2, 8).toUpperCase()));
    const invoice = await Invoice.create({
      customId: 'inv_' + Math.random().toString(36).substring(2, 9),
      client: contract.companyName || contract.brandName || 'Client',
      amount: `₹${amountPaid.toLocaleString('en-IN')}`,
      dueDate: nowStr,
      date: new Date().toISOString().split('T')[0],
      status: 'paid'
    });

    // Find or infer linked Client
    const clientConditions = [];
    if (contract.clientId) {
      const cCond = findByIdOrCustomId(contract.clientId);
      if (cCond && cCond.$or) {
        clientConditions.push(...cCond.$or);
      } else if (cCond) {
        clientConditions.push(cCond);
      }
    }
    if (contract.companyName) {
      clientConditions.push({ companyName: new RegExp('^' + escapeRegExp(contract.companyName.trim()) + '$', 'i') });
      clientConditions.push({ company: new RegExp('^' + escapeRegExp(contract.companyName.trim()) + '$', 'i') });
    }
    const client = await Client.findOne({ $or: clientConditions });
    const clientCustomId = client ? (client.customId || client._id.toString()) : (contract.clientId || 'unassigned');

    // Find linked deal if any
    let linkedDeal = null;
    if (contract.dealId) {
      linkedDeal = await Deal.findOne(findByIdOrCustomId(contract.dealId));
    }
    if (!linkedDeal && clientCustomId && clientCustomId !== 'unassigned') {
      linkedDeal = await Deal.findOne({ clientId: clientCustomId, status: { $nin: ['Lost'] } });
    }

    // Create Payment record in Payment collection so it appears in Payments ledger
    let newPayment = null;
    try {
      newPayment = await Payment.create({
        customId: 'pay_' + Math.random().toString(36).substring(2, 9),
        dealId: linkedDeal ? (linkedDeal.customId || linkedDeal._id.toString()) : (contract.dealId || contract.customId),
        dealCode: linkedDeal?.dealCode || contract.customId || 'CONTRACT-BAL',
        clientId: clientCustomId,
        clientName: contract.companyName || contract.brandName || 'Client',
        amount: amountPaid,
        mode: paymentMode || 'UPI',
        reference: paymentRefNo || '',
        paidOn: nowStr.includes('/') ? nowStr.split('/').reverse().join('-') : nowStr,
        recordedBy: req.user?.name || 'Accounts Team',
        recordedById: req.user?.id || '',
        notes: `Balance settlement for Contract ${contract.customId}. ${notes || ''}`
      });
      broadcastRealtimeUpdate('PAYMENT_CREATED', { payment: newPayment });
    } catch (payErr) {
      console.error('Failed to create Payment document during settlement:', payErr);
    }

    if (linkedDeal) {
      const allDealPayments = await Payment.find({ dealId: linkedDeal.customId || linkedDeal._id.toString() });
      const dealTotalPaid = allDealPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      if (dealTotalPaid >= (Number(linkedDeal.total) || 0)) {
        linkedDeal.status = 'Paid';
      } else if (dealTotalPaid > 0) {
        linkedDeal.status = 'Partially Paid';
      }
      await linkedDeal.save();
      broadcastRealtimeUpdate('DEAL_UPDATED', { deal: linkedDeal });
    }

    if (!contract.settlements) contract.settlements = [];
    contract.settlements.push({
      amount: amountPaid,
      paymentMode: paymentMode || 'UPI',
      paymentRefNo: paymentRefNo || '',
      paymentDate: nowStr,
      invoiceNumber: invNum,
      notes: notes || '',
      createdAt: new Date()
    });

    const settlementLog = `[Settlement on ${nowStr}]: ₹${amountPaid.toLocaleString('en-IN')} paid via ${paymentMode || 'UPI'}${paymentRefNo ? ` (Ref: ${paymentRefNo})` : ''} [Inv: ${invNum}]. Balance remaining: ₹${contract.balancePayment.toLocaleString('en-IN')}.${notes ? ` Note: ${notes}` : ''}`;
    contract.remarks = contract.remarks ? `${contract.remarks} | ${settlementLog}` : settlementLog;

    await contract.save();

    // Recalculate client revenue and status
    if (client) {
      const allClientContracts = await SalesContract.find({
        $or: [
          { clientId: clientCustomId },
          { companyName: new RegExp('^' + escapeRegExp(contract.companyName.trim()) + '$', 'i') }
        ],
        isActive: true
      });
      const totalReleased = allClientContracts.reduce((sum, c) => sum + (Number(c.amountReleasedWithGst) || 0), 0);
      const anyPending = allClientContracts.some(c => (Number(c.balancePayment) || 0) > 0);
      client.revenue = `₹${totalReleased.toLocaleString('en-IN')}`;
      client.paymentStatus = anyPending ? 'pending' : (totalReleased > 0 ? 'paid' : 'pending');
      await client.save();
      broadcastRealtimeUpdate('CLIENT_UPDATED', { client });
    }

    broadcastRealtimeUpdate('CONTRACT_UPDATED', { contract });
    broadcastRealtimeUpdate('INVOICE_UPDATED', { invoice });

    res.json({
      success: true,
      message: `Balance payment of ₹${amountPaid.toLocaleString('en-IN')} recorded successfully.`,
      contract,
      invoice,
      payment: newPayment
    });
  } catch (err) {
    next(err);
  }
};

// Create a renewal contract and renewal invoice
export const createRenewalContractAndInvoice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = req.body;

    const parentContract = await SalesContract.findOne(findByIdOrCustomId(id));
    if (!parentContract) {
      return res.status(404).json({ success: false, message: 'Original contract not found.' });
    }

    const parentBalance = Number(parentContract.balancePayment) || 0;
    const parentIsPartial = parentBalance > 0;

    // Next srNo & customId
    const maxDoc = await SalesContract.findOne({}).sort({ srNo: -1 }).select('srNo');
    const nextSrNo = (maxDoc?.srNo || 0) + 1;
    const now = new Date();
    const customId = `SC-REN-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${nextSrNo}`;

    const basePrice = Number(body.fullContractValue || parentContract.fullContractValue || parentContract.planPrice || 0);
    const gstPercent = body.gstPercent !== undefined ? Number(body.gstPercent) : (parentContract.gstPercent || 18);
    const gstAmount = Math.round(basePrice * (gstPercent / 100));
    const totalWithGst = basePrice + gstAmount;

    const tdsPercent = body.tdsPercent !== undefined ? Number(body.tdsPercent) : (parentContract.tdsPercent || 0);
    const tdsAmount = Math.round(basePrice * (tdsPercent / 100));
    const totalPayable = totalWithGst - tdsAmount;

    const paymentType = body.paymentType || (Number(body.balancePayment) > 0 ? 'Partial' : 'Full');
    const amountReceived = Number(body.amountReleasedWithGst !== undefined ? body.amountReleasedWithGst : totalPayable);
    const balanceDue = Number(body.balancePayment !== undefined ? body.balancePayment : Math.max(0, totalPayable - amountReceived));

    const renewalRemarks = `RENEWAL CONTRACT (Previous Contract ${parentContract.customId} was ${parentIsPartial ? `PARTIAL with ₹${parentBalance.toLocaleString('en-IN')} remaining balance` : 'PAID IN FULL'}).${body.remarks ? ` Note: ${body.remarks}` : ''}`;

    const parentObj = parentContract.toObject();
    delete parentObj._id;
    delete parentObj.createdAt;
    delete parentObj.updatedAt;
    delete parentObj.__v;

    const effectiveRenewalStart = normalizeToDDMMYYYY(body.renewalFromDate || parentContract.renewalDate || body.dateOfSales || `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`);
    const renewalTerm = body.durationOfContract || parentContract.durationOfContract || '1 month';
    const computedNextRenDate = normalizeToDDMMYYYY(body.renewalDate) || computeNextRenewalDateFromStart(effectiveRenewalStart, renewalTerm);

    const startDt = parseContractDate(effectiveRenewalStart) || now;
    const contractMonth = startDt.toLocaleString('en-US', { month: 'long' });
    const contractYear = startDt.getFullYear();

    const renewalContract = await SalesContract.create({
      ...parentObj,
      customId,
      srNo: nextSrNo,
      month: contractMonth,
      year: contractYear,
      contractType: 'RENEWAL',
      fullContractValue: basePrice,
      gstPercent,
      gstAmount,
      tdsPercent,
      tdsAmount,
      totalPayable,
      amountReleasedWithGst: amountReceived,
      amountReleasedWithoutGst: Math.round(amountReceived / (1 + gstPercent / 100)),
      amountReleasedAfterTds: amountReceived,
      balancePayment: balanceDue,
      paymentType,
      dateOfSales: effectiveRenewalStart,
      dateOfLogin: effectiveRenewalStart,
      renewalFromDate: effectiveRenewalStart,
      renewalDate: computedNextRenDate,
      durationOfContract: renewalTerm,
      balancePaymentDate: body.balancePaymentDate || '',
      modeOfPayment: body.modeOfPayment || parentContract.modeOfPayment || 'UPI',
      paymentRefNo: body.paymentRefNo || '',
      invoiceNumber: body.invoiceNumber || ('INV-REN-' + Math.random().toString(36).substring(2, 7).toUpperCase()),
      remarks: renewalRemarks,
      autoRenewalConfig: {
        active: false,
        parentContractId: parentContract._id.toString()
      }
    });

    // Create corresponding Renewal Invoice
    const invoiceStatus = balanceDue === 0 ? 'paid' : 'pending';
    const renewalInvoice = await Invoice.create({
      customId: 'inv_' + Math.random().toString(36).substring(2, 9),
      client: renewalContract.companyName || renewalContract.brandName || 'Client',
      amount: `₹${totalPayable.toLocaleString('en-IN')}`,
      dueDate: renewalContract.balancePaymentDate || renewalContract.dateOfSales || now.toISOString().split('T')[0],
      date: now.toISOString().split('T')[0],
      status: invoiceStatus
    });

    // Interconnect with Production: Locate and update linked Project
    let targetProject = null;
    if (parentContract.projectId) {
      targetProject = await Project.findOne(findByIdOrCustomId(parentContract.projectId));
    }
    if (!targetProject) {
      const effComp = (parentContract.companyName || '').trim();
      const effBrand = (parentContract.brandName || effComp).trim();
      const escRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      targetProject = await Project.findOne({
        $or: [
          ...(effComp ? [
            { companyName: new RegExp(`^\\s*${escRegex(effComp)}\\s*$`, 'i') },
            { client: new RegExp(`^\\s*${escRegex(effComp)}\\s*$`, 'i') },
            { brandName: new RegExp(`^\\s*${escRegex(effComp)}\\s*$`, 'i') }
          ] : []),
          ...(effBrand ? [{ brandName: new RegExp(`^\\s*${escRegex(effBrand)}\\s*$`, 'i') }] : []),
          ...(parentContract.clientId ? [{ clientId: parentContract.clientId }] : [])
        ]
      });
    }

    let syncedTasks = [];
    if (targetProject) {
      const pCustomId = targetProject.customId || targetProject._id.toString();
      renewalContract.projectId = pCustomId;
      await renewalContract.save();

      const renewalDueFrom = renewalContract.renewalFromDate || parentContract.renewalDate || targetProject.renewalDate || renewalContract.dateOfSales;
      let nextRenDate = renewalContract.renewalDate || '';

      if (!nextRenDate && renewalDueFrom) {
        try {
          const parts = String(renewalDueFrom).split(/[/.-]/);
          let d, m, y;
          if (parts[0].length === 4) {
            y = parseInt(parts[0], 10);
            m = parseInt(parts[1], 10) - 1;
            d = parseInt(parts[2], 10);
          } else {
            d = parseInt(parts[0], 10);
            m = parseInt(parts[1], 10) - 1;
            y = parseInt(parts[2], 10);
          }
          if (y && m >= 0 && d) {
            const dt = new Date(y, m + 1, d);
            const pad = (n) => String(n).padStart(2, '0');
            nextRenDate = `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`;
            renewalContract.renewalDate = nextRenDate;
            await renewalContract.save();
          }
        } catch (e) {
          console.error('[createRenewalContractAndInvoice] Error computing nextRenDate:', e);
        }
      }

      targetProject.renewalDate = nextRenDate || renewalContract.renewalDate;
      targetProject.nextRenewalDate = nextRenDate || renewalContract.renewalDate;
      targetProject.lastRenewalDate = renewalDueFrom;
      targetProject.renewalStatus = 'RENEWED';
      if (['paused', 'on-hold', 'cancelled', 'inactive', 'planning'].includes(targetProject.status)) {
        targetProject.status = 'active';
      }

      const renLogEntry = {
        date: now.toISOString().split('T')[0],
        event: `Contract Renewed via Sales (${renewalContract.customId}). Renewed From: ${renewalDueFrom} → Next Due: ${nextRenDate || 'N/A'}. Invoice: ${renewalInvoice.customId}`
      };
      if (!Array.isArray(targetProject.activity)) {
        targetProject.activity = [];
      }
      targetProject.activity.unshift(renLogEntry);
      await targetProject.save();

      // Automatically generate deliverables and tasks for the renewed cycle
      try {
        const baseProjectStart = renewalDueFrom || targetProject.renewalDate || targetProject.handoverDate || targetProject.taskStartDate || targetProject.startDate || targetProject.createdAt;
        await generateDeliverablesForProjectBackend(targetProject, false, baseProjectStart);
      } catch (genErr) {
        console.error('[createRenewalContractAndInvoice] Error generating deliverables:', genErr);
      }

      const projIds = [targetProject.customId, targetProject._id.toString()].filter(Boolean);
      syncedTasks = await Task.find({ projectId: { $in: projIds } });

      // Realtime synchronization to Production team
      broadcastRealtimeUpdate('PROJECT_UPDATED', { project: targetProject });
      broadcastRealtimeUpdate('PROJECT_TASKS_SYNCED', { id: pCustomId, tasks: syncedTasks });
    }

    // Create Payment record for renewal if payment received
    if (amountReceived > 0) {
      try {
        const renPayment = await Payment.create({
          customId: 'pay_' + Math.random().toString(36).substring(2, 9),
          dealId: renewalContract.dealId || renewalContract.customId,
          dealCode: renewalContract.customId,
          clientId: renewalContract.clientId || (parentContract.clientId || 'unassigned'),
          clientName: renewalContract.companyName || renewalContract.brandName || 'Client',
          amount: amountReceived,
          mode: renewalContract.modeOfPayment || 'UPI',
          reference: renewalContract.paymentRefNo || '',
          paidOn: renewalContract.dateOfSales?.includes('/') 
            ? renewalContract.dateOfSales.split('/').reverse().join('-') 
            : new Date().toISOString().split('T')[0],
          recordedBy: req.user?.name || 'Sales Team',
          recordedById: req.user?.id || '',
          notes: `Payment for renewal contract ${renewalContract.customId}`
        });
        broadcastRealtimeUpdate('PAYMENT_CREATED', { payment: renPayment });
      } catch (payErr) {
        console.error('Failed to create Payment for renewal contract:', payErr);
      }
    }

    // Bidirectional sync to Client, Projects, Deals
    await syncContractToLinkedEntities(renewalContract);

    broadcastRealtimeUpdate('CONTRACT_CREATED', { contract: renewalContract });
    broadcastRealtimeUpdate('INVOICE_UPDATED', { invoice: renewalInvoice });

    res.status(201).json({
      success: true,
      message: `Renewal contract ${renewalContract.customId} created, project renewed, and ${syncedTasks.length} deliverables generated for Production!`,
      contract: renewalContract,
      invoice: renewalInvoice,
      project: targetProject,
      tasksCount: syncedTasks.length
    });
  } catch (err) {
    next(err);
  }
};

const updateChildSplitContractsDates = async (parentContract, oldDateStr, newDateStr) => {
  try {
    const parentId = parentContract.customId || parentContract._id.toString();
    const baseCustomId = parentId.replace(/_split_\d+$/i, '');
    const escapedBaseId = baseCustomId.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

    const childContracts = await SalesContract.find({
      _id: { $ne: parentContract._id },
      $or: [
        { 'autoRenewalConfig.parentContractId': parentContract.customId },
        { 'autoRenewalConfig.parentContractId': parentContract._id.toString() },
        { customId: new RegExp('^' + escapedBaseId + '_split_', 'i') }
      ]
    });

    if (!childContracts || childContracts.length === 0) return;

    const parts = String(newDateStr).trim().split(/[/.-]/);
    if (parts.length !== 3) return;
    let day = parseInt(parts[0], 10);
    let month = parseInt(parts[1], 10);
    let year = parseInt(parts[2], 10);
    if (parts[0].length === 4) {
      year = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10);
      day = parseInt(parts[2], 10);
    } else if (parts[2].length === 4) {
      let p1 = parseInt(parts[0], 10);
      let p2 = parseInt(parts[1], 10);
      if (p1 <= 12 && p2 > 12) {
        month = p1; day = p2;
      } else {
        day = p1; month = p2;
      }
    }

    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    for (const child of childContracts) {
      let cycleIdx = child.autoRenewalConfig?.currentCycle || 1;
      const splitMatch = (child.customId || '').match(/_split_(\d+)$/i);
      if (splitMatch) {
        cycleIdx = parseInt(splitMatch[1], 10);
      }
      
      const monthOffset = Math.max(0, cycleIdx - 1);
      
      let newM = month + monthOffset;
      let newY = year;
      while (newM > 12) {
        newM -= 12;
        newY += 1;
      }

      const formattedDay = String(day).padStart(2, '0');
      const formattedM = String(newM).padStart(2, '0');
      const childDateStr = `${formattedDay}/${formattedM}/${newY}`;
      const childMonthStr = monthNames[newM - 1];

      await SalesContract.updateOne(
        { _id: child._id },
        {
          $set: {
            dateOfSales: childDateStr,
            salesDate: childDateStr,
            dateOfLogin: childDateStr,
            loginDate: childDateStr,
            renewalFromDate: childDateStr,
            renewalDate: childDateStr,
            month: childMonthStr,
            year: newY
          }
        }
      );
    }
  } catch (err) {
    console.error('Error updating child split contract dates:', err);
  }
};

/**
 * Synchronize all non-deleted SalesContracts to linked Projects and Clients in bulk.
 */
export const syncAllContractsToProjectsController = async (req, res, next) => {
  try {
    const contracts = await SalesContract.find({ isDeleted: { $ne: true } });
    let count = 0;
    for (const c of contracts) {
      await syncContractToLinkedEntities(c);
      count++;
    }
    res.json({
      success: true,
      message: `Successfully synchronized ${count} sales contracts with projects.`,
      count
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Public Webhook: Ingest Package Orders / Proforma Invoices generated on Prital Website (prittal2)
 * Creates or links: Client, SalesContract, Project, Lead, Notification, and broadcasts SSE.
 */
export const handlePublicPackageOrder = async (req, res, next) => {
  try {
    const body = req.body || {};
    
    // Clean currency string or number to float
    const parseNum = (val) => {
      if (val === undefined || val === null || val === '') return 0;
      if (typeof val === 'number') return isNaN(val) ? 0 : val;
      const cleaned = String(val).replace(/[^0-9.-]+/g, '');
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : parsed;
    };

    const compName = (body.company_name || body.company || body.contact_person || body.name || 'Anonymous Client').trim();
    const brandName = (body.brand_name || body.brandName || body.brand || compName).trim();
    const contactPerson = (body.contact_person || body.name || compName).trim();
    const clientEmail = (body.client_email || body.email || '').trim();
    const clientPhone = (body.client_phone || body.phone || '').trim();
    const designation = (body.designation || '').trim();
    const fullAddress = (body.address || '').trim();
    const area = (body.area || body.locality || '').trim();
    const city = (body.city || '').trim();
    const state = (body.state || '').trim();
    const pinCode = (body.pin_code || body.pinCode || '').trim();
    const gstin = (body.gstin && body.gstin !== 'N/A') ? body.gstin.trim().toUpperCase() : '';
    const tanNo = (body.tan_no && body.tan_no !== 'N/A') ? body.tan_no.trim().toUpperCase() : '';
    const proformaCode = (body.proforma_invoice_no || body.proformaCode || body.docCode || '').trim();
    const selectedPkg = (body.selected_package || body.package || 'Custom Retainer').trim();
    const billingCycle = (body.billing_cycle || body.cycle || 'Monthly').trim();
    const servicesSold = (body.services_sold || selectedPkg).trim();
    const deliverablesSummary = (body.deliverables_summary || '').trim();
    const deliverablesQuota = body.deliverables_quota || body.deliverablesQuota || null;
    const clientNotes = (body.client_notes || body.notes || '').trim();
    const paymentMode = (body.payment_mode || 'UPI').trim();
    const paymentStatus = (body.payment_status || 'Pending').trim();

    // Extract TDS rate & compute TDS amounts early so net payable is accurately calculated
    const rawTds = body.tds_rate !== undefined ? body.tds_rate : (body.tdsPercent !== undefined ? body.tdsPercent : (body.tdsRate !== undefined ? body.tdsRate : 0));
    const tdsPercent = Number(rawTds) || 0;

    const payModeLower = paymentMode.toLowerCase();
    const isCashLikeMode = (payModeLower.includes('cash') || payModeLower.includes('m-upi')) && !payModeLower.includes('gst');
    const hasExplicitGst = body.hasGst === true || body.has_gst === true || body.isGstExplicit === true || Boolean(gstin && gstin.length >= 15);

    let gstPercent = 18;
    if (isCashLikeMode && !hasExplicitGst) {
      gstPercent = 0;
    } else if (body.gst_percent !== undefined && body.gst_percent !== null && body.gst_percent !== '') {
      gstPercent = Number(body.gst_percent);
    } else if (body.gst_rate !== undefined && body.gst_rate !== null && body.gst_rate !== '') {
      gstPercent = Number(body.gst_rate);
    } else if (body.gstPercent !== undefined && body.gstPercent !== null && body.gstPercent !== '') {
      gstPercent = Number(body.gstPercent);
    } else if (isCashLikeMode) {
      gstPercent = 0;
    }

    const gstAmount = gstPercent === 0 ? 0 : (
      (body.gst_amount !== undefined && body.gst_amount !== null && body.gst_amount !== '')
        ? parseNum(body.gst_amount)
        : ((body.gst_18_percent !== undefined && body.gst_18_percent !== null && body.gst_18_percent !== '')
            ? parseNum(body.gst_18_percent)
            : Math.round(baseAmount * (gstPercent / 100)))
    );
    const totalAmount = parseNum(body.total_amount_incl_gst) || (baseAmount + gstAmount);
    const totalTdsAmount = Math.round(baseAmount * (tdsPercent / 100));
    const netReceivableTotal = Math.max(0, totalAmount - totalTdsAmount);

    const receivedAmount = parseNum(body.received_amount);
    let balanceAmount = 0;
    if (body.balance_amount !== undefined && body.balance_amount !== null && body.balance_amount !== '') {
      balanceAmount = parseNum(body.balance_amount);
    } else {
      balanceAmount = Math.max(0, netReceivableTotal - receivedAmount);
    }

    const now = new Date();
    const dateFormatted = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

    // 1. Auto-assign srNo and unique customId for SalesContract
    const maxDoc = await SalesContract.findOne({}).sort({ srNo: -1 }).select('srNo');
    const nextSrNo = (maxDoc?.srNo || 0) + 1;
    const customId = `SC-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${nextSrNo}`;
    
    // Format a clean brand slug for the Proforma Invoice if none or generic
    const cleanBrandSlug = (brandName || compName || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => !['PVT', 'LTD', 'LIMITED', 'PRIVATE', 'CORP', 'LLP', 'INC', 'PRITTAL'].includes(w))
      .slice(0, 2)
      .join('')
      .substring(0, 14) || 'CLIENT';

    let invoiceNum = proformaCode || '';
    if (!invoiceNum) {
      invoiceNum = `PI-${cleanBrandSlug}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${nextSrNo}`;
    } else if (invoiceNum.includes('PRITTAL') || invoiceNum.startsWith('PI-CLIENT-')) {
      // Replace hardcoded PRITTAL or generic CLIENT with the actual brand name slug
      invoiceNum = invoiceNum.replace(/PI-(PRITTAL|CLIENT)-/i, `PI-${cleanBrandSlug}-`);
    }

    // 2. Determine if this order is a renewal for an existing client
    const isExplicitRenewal = body.sale_type === 'renewal' ||
      Boolean(body.renewal_from_date) ||
      /renewal|continuity/i.test(clientNotes) ||
      /renewal/i.test(selectedPkg);

    const clientConds = [
      ...(compName ? [{ companyName: new RegExp(`^\\s*${escapeRegExp(compName)}\\s*$`, 'i') }] : []),
      ...(brandName ? [{ brandName: new RegExp(`^\\s*${escapeRegExp(brandName)}\\s*$`, 'i') }] : []),
      ...(clientEmail ? [{ email: clientEmail }] : []),
      ...(clientPhone ? [{ customerPhone: clientPhone }] : [])
    ];

    let priorRenewalDueDate = body.renewal_from_date ? normalizeToDDMMYYYY(body.renewal_from_date) : '';

    const priorContract = await SalesContract.findOne({
      $or: clientConds,
      isActive: { $ne: false },
      isDeleted: { $ne: true }
    }).sort({ createdAt: -1 });

    const priorProject = await Project.findOne({
      $or: [
        ...(compName ? [{ companyName: new RegExp(`^\\s*${escapeRegExp(compName)}\\s*$`, 'i') }, { client: new RegExp(`^\\s*${escapeRegExp(compName)}\\s*$`, 'i') }] : []),
        ...(brandName ? [{ brandName: new RegExp(`^\\s*${escapeRegExp(brandName)}\\s*$`, 'i') }, { name: new RegExp(`^\\s*${escapeRegExp(brandName)}\\s*`, 'i') }] : []),
        ...(clientEmail ? [{ clientEmail: clientEmail }] : []),
        ...(clientPhone ? [{ clientPhone: clientPhone }] : [])
      ]
    });

    const isRenewal = isExplicitRenewal || Boolean(priorContract?.renewalDate || priorProject?.renewalDate);
    if (isRenewal && !priorRenewalDueDate) {
      priorRenewalDueDate = normalizeToDDMMYYYY(priorContract?.renewalDate || priorContract?.nextRenewalDate || priorProject?.renewalDate || priorProject?.nextRenewalDate);
    }

    const effectiveContractStartDate = (isRenewal && priorRenewalDueDate) ? priorRenewalDueDate : dateFormatted;
    const contractStartDt = parseContractDate(effectiveContractStartDate) || now;
    const contractMonth = contractStartDt.toLocaleString('en-US', { month: 'long' });
    const contractYear = contractStartDt.getFullYear();

    // Determine duration and renewal cycle (Annual is a plan; monthly renewal is only for quarterly and half-yearly)
    let cycles = 1;
    const cycleUpper = billingCycle.toUpperCase();
    if (cycleUpper.includes('QUARTERLY')) {
      cycles = 3;
    } else if (cycleUpper.includes('HALF YEARLY') || cycleUpper.includes('HALF-YEARLY')) {
      cycles = 6;
    }
    // Note: Annual is an annual plan; do not break contract into monthly renewals!

    let contractVal = baseAmount;
    let releasedWithGst = receivedAmount;
    let releasedWithoutGst = gstPercent > 0 ? Math.round(receivedAmount / (1 + (gstPercent / 100))) : receivedAmount;
    let balanceVal = balanceAmount;
    let autoRenewalConfig = { active: false };

    let renewalDateStr = '';

    if (cycles > 1) {
      contractVal = Math.round(baseAmount / cycles);
      releasedWithGst = Math.round(receivedAmount / cycles);
      releasedWithoutGst = gstPercent > 0 ? Math.round(releasedWithGst / (1 + (gstPercent / 100))) : releasedWithGst;
      const cycleTotalGst = Math.round(contractVal * (gstPercent / 100));
      const cycleTdsAmount = Math.round(contractVal * (tdsPercent / 100));
      const cycleTotalPayable = Math.max(0, contractVal + cycleTotalGst - cycleTdsAmount);
      balanceVal = Math.max(0, cycleTotalPayable - releasedWithGst);

      renewalDateStr = computeNextRenewalDateFromStart(effectiveContractStartDate, '1 month');

      autoRenewalConfig = {
        active: true,
        originalDuration: billingCycle,
        maxCycles: cycles,
        currentCycle: 1,
        parentContractId: null
      };
    } else {
      if (cycleUpper.includes('ANNUAL') || cycleUpper.includes('YEARLY')) {
        renewalDateStr = computeNextRenewalDateFromStart(effectiveContractStartDate, '1 year');
      } else if (cycleUpper.includes('HALF YEARLY') || cycleUpper.includes('HALF-YEARLY')) {
        renewalDateStr = computeNextRenewalDateFromStart(effectiveContractStartDate, '6 months');
      } else if (cycleUpper.includes('QUARTERLY')) {
        renewalDateStr = computeNextRenewalDateFromStart(effectiveContractStartDate, '3 months');
      } else if (cycleUpper.includes('ONE')) {
        renewalDateStr = '';
      } else {
        renewalDateStr = computeNextRenewalDateFromStart(effectiveContractStartDate, '1 month');
      }
    }

    const totalGstAmount = Math.round(contractVal * (gstPercent / 100));
    const tdsAmount = Math.round(contractVal * (tdsPercent / 100));
    const effectiveTotalPayable = Math.max(0, contractVal + totalGstAmount - tdsAmount);
    if (releasedWithGst >= effectiveTotalPayable) {
      balanceVal = 0;
    }
    const amountReleasedAfterTds = Math.max(0, releasedWithGst - (cycles > 1 ? Math.round(tdsAmount / cycles) : tdsAmount));

    // Determine normalized contract type
    const normalizedContractType = cycles === 3 
      ? 'QUARTERLY' 
      : cycles === 6 
        ? 'HALF YEARLY' 
        : (cycleUpper.includes('ANNUAL') || cycleUpper.includes('YEARLY'))
          ? 'ANNUAL' 
          : (cycleUpper.includes('ONE') ? 'ONE TIME' : 'MONTHLY');

    // 3. Create SalesContract record with monthly distribution & automated renewal date
    const contract = await SalesContract.create({
      customId,
      srNo: nextSrNo,
      month: contractMonth,
      year: contractYear,
      dateOfSales: effectiveContractStartDate,
      dateOfLogin: effectiveContractStartDate,
      renewalFromDate: isRenewal ? effectiveContractStartDate : '',
      branch: area || 'Rohini',
      area: area || '',
      city: city || '',
      state: state || '',
      pinCode: pinCode || '',
      soldBy: 'Website PI Self-Service',
      companyName: compName,
      brandName: brandName || compName,
      customerName: contactPerson,
      customerPhone: clientPhone,
      companyAddress: fullAddress,
      email: clientEmail,
      gstNumber: gstin,
      tanNumber: tanNo,
      invoiceNumber: invoiceNum,
      fullContractValue: contractVal,
      saleAmount: contractVal,
      gstPercent,
      gstAmount: totalGstAmount,
      tdsPercent,
      tdsAmount,
      tds: tdsPercent > 0 ? `${tdsPercent}%` : 'NA',
      totalPayable: effectiveTotalPayable,
      amountReleasedWithGst: releasedWithGst,
      amountReleasedWithoutGst: releasedWithoutGst,
      amountReleasedAfterTds,
      balancePayment: balanceVal,
      paymentType: balanceVal > 0 ? 'Partial' : 'Full',
      modeOfPayment: paymentMode,
      paymentCycle: billingCycle,
      durationOfContract: cycles > 1 ? '1 Month' : billingCycle,
      contractType: isRenewal ? 'RENEWAL' : normalizedContractType,
      renewalDate: renewalDateStr || '',
      vertical: 'PRITTAL',
      typeOfServices: selectedPkg,
      plan: selectedPkg,
      servicesBrief: deliverablesSummary || servicesSold,
      deliverablesQuota: (() => {
        let dq = deliverablesQuota ? { ...deliverablesQuota } : {};
        if (selectedPkg && (/basic|starter/i.test(selectedPkg) || /4\s*creative/i.test(deliverablesSummary || servicesSold))) {
          dq.creatives = 4;
          dq.aiReels = dq.aiReels ? Math.min(dq.aiReels, 4) : 4;
          dq.carousels = 0;
          dq.festival = true;
        }
        return Object.keys(dq).length > 0 ? dq : undefined;
      })(),
      remarks: `Proforma Invoice: ${invoiceNum} | Order via Package Builder.${cycles > 1 ? ` Term: ${billingCycle} (${cycles} Monthly cycles distributed @ ₹${contractVal.toLocaleString('en-IN')}/mo). Next Renewal: ${renewalDateStr}.` : ''}${tdsPercent > 0 ? ` TDS: ${tdsPercent}% (-₹${tdsAmount.toLocaleString('en-IN')}).` : ''}${clientNotes ? ' Notes: ' + clientNotes : ''}`,
      autoRenewalConfig,
      isActive: true
    });

    // 4. Synchronize linked entities (Client & Production Project)
    await syncContractToLinkedEntities(contract);

    // 5. Create or sync a Lead in CRM pipeline
    try {
      const todayIso = now.toISOString().split('T')[0];
      const leadRemark = `${/smo|social media/i.test(selectedPkg) ? 'SMO & Social Media' : /seo/i.test(selectedPkg) ? 'SEO' : /web/i.test(selectedPkg) ? 'Website' : 'Package'} PI ${invoiceNum} generated. Term: ${billingCycle} (${cycles > 1 ? `Total: ₹${totalAmount.toLocaleString('en-IN')} split into ${cycles} monthly cycles @ ₹${contractVal.toLocaleString('en-IN')}/mo (Net ₹${Math.round(netReceivableTotal / cycles).toLocaleString('en-IN')}/mo), Next Renewal: ${renewalDateStr}` : `Total: ₹${totalAmount.toLocaleString('en-IN')}`}). Mode: ${paymentMode}. Deliverables: ${deliverablesSummary || servicesSold}`;
      const serviceCat = /smo|social media|instagram|facebook/i.test(selectedPkg) ? 'SMO & Social Media' : /seo/i.test(selectedPkg) ? 'SEO' : /web/i.test(selectedPkg) ? 'Website' : 'Package Order';

      let existingLead = await Lead.findOne({
        $or: [
          { company: new RegExp(`^${compName.trim()}$`, 'i') },
          ...(clientEmail ? [{ email: clientEmail.trim().toLowerCase() }] : []),
          ...(clientPhone ? [{ phone: clientPhone.trim() }] : [])
        ]
      });

      if (existingLead) {
        if (area) existingLead.area = area;
        if (city) existingLead.city = city;
        if (state) existingLead.state = state;
        if (fullAddress) existingLead.address = fullAddress;
        existingLead.service = selectedPkg;
        existingLead.serviceCategory = serviceCat;
        existingLead.budget = `₹${totalAmount.toLocaleString('en-IN')}`;
        existingLead.callStatus = 'Completed';
        existingLead.status = 'won';
        existingLead.chances = 'High';
        existingLead.callingDate = existingLead.callingDate || todayIso;
        existingLead.assignedDate = existingLead.assignedDate || todayIso;
        existingLead.date = existingLead.date || todayIso;
        existingLead.remark = leadRemark;
        await existingLead.save();
        broadcastRealtimeUpdate('LEAD_UPDATED', { lead: existingLead });
      } else {
        const leadCustomId = `ld_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 4)}`;
        const newLead = await Lead.create({
          customId: leadCustomId,
          company: compName,
          contactPerson,
          email: clientEmail,
          phone: clientPhone,
          address: fullAddress,
          area: area || '',
          city: city || '',
          state: state || '',
          service: selectedPkg,
          serviceCategory: serviceCat,
          budget: `₹${totalAmount.toLocaleString('en-IN')}`,
          source: 'Website Package Builder',
          callStatus: 'Completed',
          chances: 'High',
          status: 'won',
          date: todayIso,
          callingDate: todayIso,
          assignedDate: todayIso,
          remark: leadRemark
        });
        broadcastRealtimeUpdate('LEAD_CREATED', { lead: newLead });
      }
    } catch (leadErr) {
      console.warn('Lead creation notice during package order sync:', leadErr.message);
    }

    // 6. Broadcast Real-Time Notification & SSE
    try {
      let orderCategory = 'Package';
      if (/smo|social media|instagram|facebook/i.test(selectedPkg)) {
        orderCategory = 'SMO & Social Media';
      } else if (/seo|search engine/i.test(selectedPkg)) {
        orderCategory = 'SEO';
      } else if (/web|ecommerce|wordpress|shopify|landing/i.test(selectedPkg)) {
        orderCategory = 'Website';
      } else if (/performance|ads|google ads|meta ads/i.test(selectedPkg)) {
        orderCategory = 'Performance Marketing';
      } else if (/branding/i.test(selectedPkg)) {
        orderCategory = 'Branding';
      } else {
        orderCategory = selectedPkg ? selectedPkg.split(' ')[0] : 'Service';
      }

      let notifMsg = '';
      if (cycles > 1) {
        notifMsg = `${brandName || compName} generated a Proforma Invoice for ${selectedPkg} (${billingCycle}).`;
      } else {
        notifMsg = `${brandName || compName} generated a Proforma Invoice for ${selectedPkg}.`;
      }

      await Notification.create({
        customId: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        userId: 'all',
        title: `✨ New ${orderCategory} Order / PI: ${invoiceNum}`,
        message: notifMsg,
        type: 'invoice_paid',
        isRead: false
      });
    } catch (notifErr) {
      console.warn('Notification notice:', notifErr.message);
    }

    broadcastRealtimeUpdate('CONTRACT_CREATED', { contract });

    return res.status(201).json({
      success: true,
      message: 'Proforma order synced to CRM successfully.',
      data: {
        contractId: contract.customId,
        invoiceNumber: contract.invoiceNumber,
        companyName: contract.companyName,
        brandName: contract.brandName,
        totalAmount
      }
    });
  } catch (err) {
    console.error('[handlePublicPackageOrder Error]:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to record proforma order in CRM.',
      error: err.message
    });
  }
};

/**
 * Public Webhook: Ingest General Website Inquiries / Contact Forms
 * Creates a Lead in CRM and emits notifications.
 */
export const handlePublicInquiry = async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = (body.name || body.contact_person || 'Website Visitor').trim();
    const compName = (body.company || body.company_name || name).trim();
    const email = (body.email || body.client_email || '').trim();
    const phone = (body.phone || body.client_phone || '').trim();
    const projectType = (body.projectType || body.service || 'General Inquiry').trim();
    const message = (body.message || body.notes || '').trim();

    const leadCustomId = `ld_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 4)}`;
    const lead = await Lead.create({
      customId: leadCustomId,
      company: compName,
      contactPerson: name,
      email,
      phone,
      service: projectType,
      serviceCategory: 'Website Lead',
      source: 'Website Contact Form',
      callStatus: 'Interested',
      chances: 'High',
      status: 'lead',
      remark: `Website inquiry received. Message: ${message}`
    });

    try {
      await Notification.create({
        customId: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        userId: 'all',
        title: `📩 New Website Inquiry: ${compName}`,
        message: `${name} submitted an inquiry for ${projectType}.`,
        type: 'lead_new',
        isRead: false
      });
    } catch (e) {}

    broadcastRealtimeUpdate('LEAD_CREATED', { lead });

    return res.status(201).json({
      success: true,
      message: 'Inquiry received and lead created in CRM successfully.',
      leadId: lead.customId
    });
  } catch (err) {
    console.error('[handlePublicInquiry Error]:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to record website inquiry.',
      error: err.message
    });
  }
};

/**
 * Public Webhook: Fetch existing active clients for website PI generation / renewal / upsell
 */
export const handlePublicGetClients = async (req, res, next) => {
  try {
    const { q } = req.query;
    let query = { isArchived: { $ne: true } };

    if (q && q.trim()) {
      const sanitized = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const reg = new RegExp(sanitized, 'i');
      query.$or = [
        { companyName: reg },
        { company: reg },
        { contact: reg },
        { displayName: reg },
        { email: reg },
        { phone: reg }
      ];
    }

    const clients = await Client.find(query)
      .select('customId companyName company displayName contact phone email billingAddress gstin currentPlan projects')
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();

    const formatted = clients.map(c => ({
      id: c.customId || c._id,
      companyName: c.companyName || c.company || c.displayName || 'Unnamed Client',
      name: c.contact || '',
      email: c.email || '',
      phone: c.phone || '',
      address: c.billingAddress?.street || '',
      city: c.billingAddress?.city || 'Delhi',
      state: c.billingAddress?.state || 'Delhi',
      pinCode: c.billingAddress?.postalCode || '',
      gstin: c.gstin || '',
      currentPlan: c.projects || c.currentPlan || ''
    }));

    return res.json({
      success: true,
      clients: formatted,
      data: formatted,
      count: formatted.length
    });
  } catch (err) {
    console.error('[handlePublicGetClients Error]:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve clients.',
      error: err.message
    });
  }
};

// Helper: Strictly clean and validate phone number (returns 10 core digits or empty string)
const getCleanPhoneNumber = (phone) => {
  if (!phone) return '';
  const str = String(phone).trim();
  if (['not in snippet', 'no phone', 'none', 'n/a', 'nil', '-', 'null', 'undefined'].includes(str.toLowerCase())) {
    return '';
  }
  const digits = str.replace(/\D/g, '');
  if (!digits) return '';

  let cleaned = digits;
  if (cleaned.startsWith('0091')) cleaned = cleaned.slice(4);
  else if (cleaned.startsWith('91') && cleaned.length >= 12) cleaned = cleaned.slice(2);
  else if (cleaned.startsWith('0') && cleaned.length >= 11) cleaned = cleaned.slice(1);

  if (cleaned.length > 10) cleaned = cleaned.slice(-10);

  // Must be exactly 10 digits
  if (cleaned.length !== 10) return '';

  // Reject dummy / repetitive patterns
  if (/^(\d)\1{9}$/.test(cleaned)) return ''; // e.g. 0000000000, 9999999999
  if (['1234567890', '0123456789', '9876543210'].includes(cleaned)) return '';

  return cleaned;
};

// Blacklist of public / shared aggregator hostnames (never treated as unique private company domains)
const SHARED_HOSTNAMES = new Set([
  'facebook.com', 'm.facebook.com', 'fb.com', 'fb.me',
  'instagram.com', 'instagr.am',
  'linkedin.com',
  'twitter.com', 'x.com',
  'youtube.com', 'youtu.be',
  'indiamart.com', 'm.indiamart.com', 'dir.indiamart.com',
  'justdial.com', 'jdmagicbox.com',
  'tradeindia.com',
  'google.com', 'maps.google.com', 'goo.gl', 'g.page', 'business.site',
  'sites.google.com', 'site.google.com',
  'wa.me', 'whatsapp.com', 'api.whatsapp.com',
  'linktr.ee', 'bio.link', 'campsite.bio',
  'wix.com', 'wixsite.com',
  'wordpress.com', 'wp.com',
  'weebly.com', 'blogger.com', 'blogspot.com',
  'github.io', 'gitlab.io',
  'amazon.in', 'amazon.com', 'flipkart.com',
  'sulekha.com', 'yellowpages.in', 'yellowpages.com'
]);

// Helper: Extract valid, private business domain (returns empty string for social/directory/placeholders)
const getPrivateDomain = (url) => {
  if (!url) return '';
  const trimmed = String(url).trim().toLowerCase();
  if (['no', 'none', 'n/a', 'na', 'no website', 'not available', 'nil', '-', 'null', 'undefined', 'not in snippet'].includes(trimmed)) {
    return '';
  }

  try {
    const withProto = trimmed.startsWith('http://') || trimmed.startsWith('https://') 
      ? trimmed 
      : `https://${trimmed}`;
    const parsed = new URL(withProto);
    let host = parsed.hostname.toLowerCase().replace(/^www\./, '');

    if (!host || !host.includes('.') || host.length < 4) return '';

    // Check if host matches or is a subdomain of a shared platform
    for (const shared of SHARED_HOSTNAMES) {
      if (host === shared || host.endsWith('.' + shared)) {
        return '';
      }
    }

    // Must have valid TLD (at least 2 letters)
    if (!/\.[a-z]{2,}$/i.test(host)) return '';

    return host;
  } catch {
    return '';
  }
};

/**
 * Scrape Google Maps Leads & detect duplicates against existing CRM leads (Synchronous / Batch)
 */
export const scrapeGoogleLeads = async (req, res, next) => {
  try {
    // Extend socket timeout for intensive deep scraping
    if (req.setTimeout) req.setTimeout(300000);
    if (res.setTimeout) res.setTimeout(300000);

    const { 
      query = '', 
      location = '', 
      state = '', 
      limit = 20, 
      offset = 0, 
      category = 'Manufacturer', 
      type = 'Shoes',
      excludeCompanies = [] 
    } = req.body;
    
    if (!query && !location && !state) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a search keyword, location or state.'
      });
    }

    const isShowAll = limit === 'all' || limit === 0 || limit === '0' || limit === 'all_leads';
    const parsedLimit = isShowAll ? 'all' : (parseInt(limit, 10) || 20);

    // 1. Scrape raw leads via Headless Chromium / Google Maps
    const rawLeads = await scrapeGoogleMapsLeads({
      query,
      location,
      state,
      limit: parsedLimit,
      offset: parseInt(offset, 10) || 0,
      category,
      type,
      excludeCompanies: Array.isArray(excludeCompanies) ? excludeCompanies : []
    });

    if (!rawLeads || rawLeads.length === 0) {
      return res.status(200).json({
        success: true,
        message: offset > 0 
          ? 'All leads for this area are listed. No further listings found on Google Maps.'
          : 'No leads found for this search keyword.',
        totalFound: 0,
        newCount: 0,
        duplicateCount: 0,
        hasMore: false,
        reachedEnd: true,
        allListed: true,
        leads: []
      });
    }

    // 2. Fetch existing leads from MongoDB for duplicate detection
    const existingLeads = await Lead.find({}, 'company phone email url assignedTo status createdAt customId').lean();

    const existingByPhone = new Map();
    const existingByDomain = new Map();

    existingLeads.forEach(lead => {
      const p = getCleanPhoneNumber(lead.phone || lead.number);
      if (p) existingByPhone.set(p, lead);

      const d = getPrivateDomain(lead.url || lead.website);
      if (d) existingByDomain.set(d, lead);
    });

    const batchSeenPhones = new Map();
    const batchSeenDomains = new Map();

    let newCount = 0;
    let duplicateCount = 0;

    // 3. Match each lead against existing database records and current batch
    const leadsWithDuplicateFlags = rawLeads.map((item, index) => {
      const pClean = getCleanPhoneNumber(item.phone);
      const dClean = getPrivateDomain(item.url);

      let isDuplicate = false;
      let duplicateType = '';
      let duplicateReason = '';
      let matchedLead = null;

      if (pClean && existingByPhone.has(pClean)) {
        isDuplicate = true;
        duplicateType = 'crm_match';
        matchedLead = existingByPhone.get(pClean);
        duplicateReason = `Already registered in CRM under "${matchedLead.company}" (Phone: ${item.phone || matchedLead.phone}, Assigned to: ${matchedLead.assignedTo || 'Unassigned'})`;
      } else if (dClean && existingByDomain.has(dClean)) {
        isDuplicate = true;
        duplicateType = 'crm_match';
        matchedLead = existingByDomain.get(dClean);
        duplicateReason = `Registered in CRM with same private domain (${dClean}) under "${matchedLead.company}" (Assigned to: ${matchedLead.assignedTo || 'Unassigned'})`;
      } else if (pClean && batchSeenPhones.has(pClean)) {
        isDuplicate = true;
        duplicateType = 'batch_duplicate';
        const priorItem = batchSeenPhones.get(pClean);
        duplicateReason = `Duplicate phone number (${item.phone}): identical to listing #${priorItem.index + 1} "${priorItem.company}" in this search`;
      } else if (dClean && batchSeenDomains.has(dClean)) {
        isDuplicate = true;
        duplicateType = 'batch_duplicate';
        const priorItem = batchSeenDomains.get(dClean);
        duplicateReason = `Duplicate private domain (${dClean}): identical to listing #${priorItem.index + 1} "${priorItem.company}" in this search`;
      }

      if (pClean && !batchSeenPhones.has(pClean)) {
        batchSeenPhones.set(pClean, { company: item.company, index });
      }
      if (dClean && !batchSeenDomains.has(dClean)) {
        batchSeenDomains.set(dClean, { company: item.company, index });
      }

      if (isDuplicate) {
        duplicateCount++;
      } else {
        newCount++;
      }

      return {
        id: `scraped_${index}_${Math.random().toString(36).substring(2, 9)}`,
        company: item.company,
        phone: item.phone,
        url: item.url,
        website: item.url || '',
        websiteExist: item.websiteExist || (item.url ? 'Yes' : 'No'),
        websiteStatus: item.websiteStatus || (item.url ? 'Good' : 'No'),
        instagram: item.instagram || 'No',
        facebook: item.facebook || 'No',
        linkedin: item.linkedin || 'No',
        youtube: item.youtube || 'No',
        socialActivities: [item.instagram, item.facebook, item.linkedin, item.youtube].some(x => String(x || '').toLowerCase() === 'yes')
          ? (item.socialActivities || 'Active')
          : 'Not Active',
        service: item.service || 'Website Design + Social Media Management + Review Generation',
        serviceCategory: item.serviceCategory || 'Lead Generation',
        remark: item.remark || '',
        chances: item.chances || 'High',
        address: item.address,
        area: item.area || location || '',
        state: item.state || state || '',
        category: item.category || category,
        type: item.type || type,
        gmbRating: item.gmbRating || '4.5',
        reviews: item.reviews || '10',
        source: 'Google Maps Scraper',
        status: 'lead',
        callStatus: '',
        assignedTo: '',
        assignedCallerId: '',
        callerId: '',
        isDuplicate,
        duplicateType,
        duplicateReason,
        matchedLead: matchedLead ? {
          company: matchedLead.company,
          phone: matchedLead.phone,
          status: matchedLead.status,
          assignedTo: matchedLead.assignedTo || 'Unassigned'
        } : null
      };
    });

    const reachedEnd = rawLeads.reachedEnd !== undefined ? rawLeads.reachedEnd : false;
    const hasMore = rawLeads.hasMore !== undefined ? rawLeads.hasMore : (!reachedEnd && rawLeads.length > 0);

    res.status(200).json({
      success: true,
      message: `Scraped ${rawLeads.length} leads from Google Maps (${newCount} new, ${duplicateCount} duplicates)`,
      totalFound: rawLeads.length,
      newCount,
      duplicateCount,
      hasMore,
      reachedEnd,
      allListed: reachedEnd || rawLeads.length === 0,
      leads: leadsWithDuplicateFlags
    });
  } catch (err) {
    console.error('[scrapeGoogleLeads Error]:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Failed to scrape leads from Google Maps'
    });
  }
};

/**
 * Scrape Google Maps Leads with Real-Time Progressive Streaming (SSE)
 * Streams lead batches directly to UI as they are discovered and rendered in Chromium.
 */
export const scrapeGoogleLeadsStream = async (req, res, next) => {
  try {
    if (req.setTimeout) req.setTimeout(600000);
    if (res.setTimeout) res.setTimeout(600000);

    const { 
      query = '', 
      location = '', 
      state = '', 
      limit = 20, 
      offset = 0, 
      category = 'Manufacturer', 
      type = 'Shoes',
      excludeCompanies = [] 
    } = req.body;

    if (!query && !location && !state) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a search keyword, location or state.'
      });
    }

    const origin = req.headers.origin || 'https://crm.prittal.com';
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true'
    });
    if (res.flushHeaders) res.flushHeaders();

    let isAborted = false;
    res.on('close', () => {
      if (!res.writableEnded) {
        isAborted = true;
      }
    });

    // Send initial connected ping
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);
    if (res.flush) res.flush();

    // Fetch existing leads from MongoDB for real-time duplicate checking
    const existingLeads = await Lead.find({}, 'company phone email url assignedTo status createdAt customId').lean();
    const existingByPhone = new Map();
    const existingByDomain = new Map();

    existingLeads.forEach(lead => {
      const p = getCleanPhoneNumber(lead.phone || lead.number);
      if (p) existingByPhone.set(p, lead);
      const d = getPrivateDomain(lead.url || lead.website);
      if (d) existingByDomain.set(d, lead);
    });

    const batchSeenPhones = new Map();
    const batchSeenDomains = new Map();

    let totalDiscovered = 0;
    let totalNew = 0;
    let totalDuplicates = 0;

    const onBatchExtracted = async (rawBatch) => {
      if (isAborted) return;
      if (!rawBatch || rawBatch.length === 0) return;

      const flaggedBatch = rawBatch.map((item, idx) => {
        const leadIndex = totalDiscovered + idx;
        const pClean = getCleanPhoneNumber(item.phone);
        const dClean = getPrivateDomain(item.url);

        let isDuplicate = false;
        let duplicateType = '';
        let duplicateReason = '';
        let matchedLead = null;

        if (pClean && existingByPhone.has(pClean)) {
          isDuplicate = true;
          duplicateType = 'crm_match';
          matchedLead = existingByPhone.get(pClean);
          duplicateReason = `Already registered in CRM under "${matchedLead.company}" (Phone: ${item.phone || matchedLead.phone}, Assigned to: ${matchedLead.assignedTo || 'Unassigned'})`;
        } else if (dClean && existingByDomain.has(dClean)) {
          isDuplicate = true;
          duplicateType = 'crm_match';
          matchedLead = existingByDomain.get(dClean);
          duplicateReason = `Registered in CRM with same private domain (${dClean}) under "${matchedLead.company}" (Assigned to: ${matchedLead.assignedTo || 'Unassigned'})`;
        } else if (pClean && batchSeenPhones.has(pClean)) {
          isDuplicate = true;
          duplicateType = 'batch_duplicate';
          const priorItem = batchSeenPhones.get(pClean);
          duplicateReason = `Duplicate phone number (${item.phone}): identical to listing #${priorItem.index + 1} "${priorItem.company}" in this search`;
        } else if (dClean && batchSeenDomains.has(dClean)) {
          isDuplicate = true;
          duplicateType = 'batch_duplicate';
          const priorItem = batchSeenDomains.get(dClean);
          duplicateReason = `Duplicate private domain (${dClean}): identical to listing #${priorItem.index + 1} "${priorItem.company}" in this search`;
        }

        if (pClean && !batchSeenPhones.has(pClean)) {
          batchSeenPhones.set(pClean, { company: item.company, index: leadIndex });
        }
        if (dClean && !batchSeenDomains.has(dClean)) {
          batchSeenDomains.set(dClean, { company: item.company, index: leadIndex });
        }

        if (isDuplicate) totalDuplicates++;
        else totalNew++;

        return {
          id: `scraped_${leadIndex}_${Math.random().toString(36).substring(2, 9)}`,
          company: item.company,
          phone: item.phone,
          url: item.url,
          website: item.url || '',
          websiteExist: item.websiteExist || (item.url ? 'Yes' : 'No'),
          websiteStatus: item.websiteStatus || (item.url ? 'Good' : 'No'),
          instagram: item.instagram || 'No',
          facebook: item.facebook || 'No',
          linkedin: item.linkedin || 'No',
          youtube: item.youtube || 'No',
          socialActivities: [item.instagram, item.facebook, item.linkedin, item.youtube].some(x => String(x || '').toLowerCase() === 'yes')
            ? (item.socialActivities || 'Active')
            : 'Not Active',
          service: item.service || 'Website Design + Social Media Management + Review Generation',
          serviceCategory: item.serviceCategory || 'Lead Generation',
          remark: item.remark || '',
          chances: item.chances || 'High',
          address: item.address,
          area: item.area || location || '',
          state: item.state || state || '',
          category: item.category || category,
          type: item.type || type,
          gmbRating: item.gmbRating || '4.5',
          reviews: item.reviews || '10',
          source: 'Google Maps Scraper',
          status: 'lead',
          callStatus: '',
          assignedTo: '',
          assignedCallerId: '',
          callerId: '',
          isDuplicate,
          duplicateType,
          duplicateReason,
          matchedLead: matchedLead ? {
            company: matchedLead.company,
            phone: matchedLead.phone,
            status: matchedLead.status,
            assignedTo: matchedLead.assignedTo || 'Unassigned'
          } : null
        };
      });

      totalDiscovered += flaggedBatch.length;

      // Stream newly discovered batch to UI immediately!
      res.write(`data: ${JSON.stringify({
        type: 'batch',
        leads: flaggedBatch,
        stats: {
          total: totalDiscovered,
          newCount: totalNew,
          duplicateCount: totalDuplicates
        }
      })}\n\n`);
      if (res.flush) res.flush();
    };

    const onProgress = (message) => {
      if (isAborted) return;
      res.write(`data: ${JSON.stringify({ type: 'progress', message })}\n\n`);
      if (res.flush) res.flush();
    };

    const isShowAll = limit === 'all' || limit === 0 || limit === '0' || limit === 'all_leads';
    const parsedLimit = isShowAll ? 'all' : (parseInt(limit, 10) || 20);

    const rawLeads = await scrapeGoogleMapsLeads({
      query,
      location,
      state,
      limit: parsedLimit,
      offset: parseInt(offset, 10) || 0,
      category,
      type,
      excludeCompanies: Array.isArray(excludeCompanies) ? excludeCompanies : [],
      onBatchExtracted,
      onProgress,
      isAborted: () => isAborted
    });

    const reachedEnd = rawLeads.reachedEnd !== undefined ? rawLeads.reachedEnd : true;
    res.write(`data: ${JSON.stringify({
      type: 'done',
      totalFound: totalDiscovered,
      newCount: totalNew,
      duplicateCount: totalDuplicates,
      allListed: reachedEnd || isShowAll
    })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[scrapeGoogleLeadsStream Error]:', err);
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message || 'Scrape stream failed' })}\n\n`);
      res.end();
    } catch {}
  }
};

/**
 * Automatically audit and synchronize all leads' social activities and smart pitches
 */
export const autoEnrichLeads = async (req, res, next) => {
  try {
    const leads = await Lead.find({});
    let updatedCount = 0;

    for (const lead of leads) {
      let changed = false;
      const updates = {};

      const hasSocial = [lead.instagram, lead.facebook, lead.linkedin, lead.youtube].some(
        x => String(x || '').toLowerCase() === 'yes'
      );

      if (!hasSocial && (lead.socialActivities || '').toLowerCase() !== 'not active') {
        updates.socialActivities = 'Not Active';
        changed = true;
      } else if (hasSocial && (!lead.socialActivities || lead.socialActivities.toLowerCase() === 'not active')) {
        updates.socialActivities = 'Active';
        changed = true;
      }

      const currentService = (lead.service || '').trim();
      const needsSmartPitch = !currentService || currentService.toLowerCase() === 'lead generation' || currentService === '--';

      if (needsSmartPitch) {
        const pitch = generateSmartPitch({
          websiteExist: lead.websiteExist || (lead.url ? 'Yes' : 'No'),
          websiteStatus: lead.websiteStatus || 'Medium',
          socialActivities: updates.socialActivities || lead.socialActivities,
          reviews: lead.reviews || '0',
          instagram: lead.instagram,
          facebook: lead.facebook,
          linkedin: lead.linkedin,
          youtube: lead.youtube
        });

        updates.service = pitch.service;
        updates.serviceCategory = pitch.serviceCategory;
        if (!lead.remark || lead.remark.trim() === '') {
          updates.remark = pitch.remark;
        }
        changed = true;
      }

      if (lead.address && cleanText(lead.address) !== lead.address) {
        updates.address = cleanText(lead.address);
        changed = true;
      }

      if (changed) {
        await Lead.updateOne({ _id: lead._id }, { $set: updates });
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      broadcastRealtimeUpdate('LEADS_BATCH_UPDATED', { updatedCount });
    }

    res.json({
      success: true,
      message: `Checked ${leads.length} leads. Updated ${updatedCount} leads with verified social presence and tailored pitches.`,
      totalChecked: leads.length,
      updatedCount
    });
  } catch (err) {
    next(err);
  }
};

