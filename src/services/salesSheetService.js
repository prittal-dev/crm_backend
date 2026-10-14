import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { SalesContract } from '../models/SalesContract.js';
import { Project } from '../models/Project.js';
import { Client } from '../models/Client.js';
import { Deal } from '../models/Deal.js';
import { broadcastRealtimeUpdate } from './realtimeService.js';
import { executeFullSalesSheetSync } from '../utils/sync_sales_deals_full.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to normalize names for reliable matching
const normalizeName = (str) => {
  if (!str) return '';
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, '').trim();
};

export const parseExcelSalesSheet = () => {
  return new Promise((resolve, reject) => {
    const pythonScript = path.resolve(__dirname, '../../../frontend/excel/export_sales_sheet.py');
    const excelFile = path.resolve(__dirname, '../../../frontend/excel/Sales Sheet Update.xlsx');

    execFile('python', [pythonScript], { env: { ...process.env, SALES_SHEET_PATH: excelFile }, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`Failed to parse Sales Sheet Excel: ${error.message}`));
      }
      try {
        const records = JSON.parse(stdout);
        resolve(records);
      } catch (err) {
        reject(new Error(`Invalid JSON from Python parser: ${err.message}`));
      }
    });
  });
};

export const syncSalesContractsFromExcel = async () => {
  const records = await parseExcelSalesSheet();
  if (!Array.isArray(records) || records.length === 0) {
    return { count: 0, contracts: [] };
  }

  // Load active projects, clients, and deals for cross-linking
  const [projects, clients, deals] = await Promise.all([
    Project.find({}),
    Client.find({}),
    Deal.find({})
  ]);

  const syncedContracts = [];

  for (const row of records) {
    const normCompany = normalizeName(row.companyName);
    const normBrand = normalizeName(row.brandName);

    // 1. Find matching project
    const matchedProject = projects.find(p => {
      const pComp = normalizeName(p.companyName || p.client);
      const pBrand = normalizeName(p.brandName || p.name);
      return (
        (normCompany && (pComp.includes(normCompany) || normCompany.includes(pComp))) ||
        (normBrand && (pBrand.includes(normBrand) || normBrand.includes(pBrand) || pComp.includes(normBrand)))
      );
    });

    // 2. Find matching client
    let matchedClient = clients.find(c => {
      const cComp = normalizeName(c.companyName || c.company);
      const cGst = (c.gstin || '').toUpperCase().trim();
      const rowGst = (row.gstNumber || '').toUpperCase().trim();
      return (
        (rowGst && cGst && rowGst === cGst) ||
        (normCompany && (cComp.includes(normCompany) || normCompany.includes(cComp)))
      );
    });

    // If no client exists yet for this Excel contract company, find or create one
    if (!matchedClient && row.companyName) {
      const compName = row.companyName.trim();
      let existingClient = await Client.findOne({
        $or: [
          { companyName: new RegExp('^' + compName + '$', 'i') },
          { company: new RegExp('^' + compName + '$', 'i') }
        ]
      });

      if (existingClient) {
        matchedClient = existingClient;
        clients.push(matchedClient);
      } else {
        const customClientId = `c_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 4)}`;
        matchedClient = await Client.create({
          customId: customClientId,
          companyName: compName,
          company: compName,
          brandName: row.brandName || '',
          contact: row.customerName || 'Primary Contact',
          phone: row.customerPhone || '',
          email: row.customerEmail || '',
          status: 'Active',
          type: 'Company',
          industry: row.vertical || 'Digital Retainer',
          gstin: row.gstNumber || '',
          pan: row.tan || '',
          contacts: [
            {
              name: row.customerName || 'Primary Contact',
              phone: row.customerPhone || '',
              email: row.customerEmail || '',
              roleTitle: 'Key Decision Maker',
              isPrimary: true
            }
          ],
          billingAddress: {
            street: row.customerAddress || '',
            city: row.branch || '',
            state: '',
            postalCode: '',
            country: 'India'
          },
          ownerName: (row.soldBy ? String(row.soldBy).replace(/man(?:eesh|ish)\s*sir/gi, 'Manish').replace(/maneesh/gi, 'Manish').trim() : 'Sales Team')
        });
        clients.push(matchedClient);
      }
    }

    // 3. Find matching deal
    const matchedDeal = deals.find(d => {
      const dClient = normalizeName(d.clientName);
      return normCompany && (dClient.includes(normCompany) || normCompany.includes(dClient));
    });

    if (matchedClient && (matchedClient.isArchived || matchedClient.isDeleted)) {
      continue;
    }

    const contractCustomId = row.customId || `contract_${row.rowNum}`;

    // Check if contract already exists
    const existing = await SalesContract.findOne({ customId: contractCustomId });
    if (existing && (existing.isDeleted || existing.isActive === false)) {
      continue;
    }

    const cleanedSoldBy = row.soldBy ? String(row.soldBy).replace(/man(?:eesh|ish)\s*sir/gi, 'Manish').replace(/maneesh/gi, 'Manish').trim() : '';
    const contractData = {
      ...row,
      soldBy: cleanedSoldBy || row.soldBy,
      customId: contractCustomId,
      projectId: matchedProject ? (matchedProject.customId || matchedProject._id.toString()) : (existing?.projectId || null),
      clientId: matchedClient ? (matchedClient.customId || matchedClient._id.toString()) : (existing?.clientId || null),
      dealId: matchedDeal ? (matchedDeal.customId || matchedDeal._id.toString()) : (existing?.dealId || null)
    };

    // If existing contract already has user-entered prices, preserve them
    if (existing) {
      if (existing.fullContractValue && !contractData.fullContractValue) {
        contractData.fullContractValue = existing.fullContractValue;
      }
      if (existing.amountReleasedWithGst && !contractData.amountReleasedWithGst) {
        contractData.amountReleasedWithGst = existing.amountReleasedWithGst;
      }
      if (existing.amountReleasedWithoutGst && !contractData.amountReleasedWithoutGst) {
        contractData.amountReleasedWithoutGst = existing.amountReleasedWithoutGst;
      }
      if (existing.amountReleasedAfterTds && !contractData.amountReleasedAfterTds) {
        contractData.amountReleasedAfterTds = existing.amountReleasedAfterTds;
      }
      if (existing.balancePayment && !contractData.balancePayment) {
        contractData.balancePayment = existing.balancePayment;
      }
      if (existing.saleAmount && !contractData.saleAmount) {
        contractData.saleAmount = existing.saleAmount;
      }
    }

    const saved = await SalesContract.findOneAndUpdate(
      { customId: contractCustomId },
      { $set: contractData },
      { new: true, upsert: true }
    );

    // If matched with a project, enrich the project with renewal date and GST if not present
    if (matchedProject && row.renewalDate) {
      const pUpdates = {};
      if (!matchedProject.renewalDate || matchedProject.renewalDate === 'N/A') {
        pUpdates.renewalDate = row.renewalDate;
      }
      if (row.servicesBrief && (!matchedProject.finalRemarks || matchedProject.finalRemarks === '')) {
        pUpdates.finalRemarks = row.servicesBrief;
      }
      if (Object.keys(pUpdates).length > 0) {
        await Project.updateOne({ _id: matchedProject._id }, { $set: pUpdates });
      }
    }

    syncedContracts.push(saved);
  }

  // Synchronize all deals, projects, clients, payments, and activity logs datewise
  try {
    await executeFullSalesSheetSync();
  } catch (syncErr) {
    console.warn('[SalesSheetSync] Full deal/project/client sync notice:', syncErr.message);
  }

  broadcastRealtimeUpdate('SALES_CONTRACTS_SYNCED', { count: syncedContracts.length });
  broadcastRealtimeUpdate('DEALS_SYNCED', { count: syncedContracts.length });
  return { count: syncedContracts.length, contracts: syncedContracts };
};
