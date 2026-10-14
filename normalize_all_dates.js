import dns from 'dns';
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch {}
import mongoose from 'mongoose';
import 'dotenv/config';

const MONTH_NAMES = {
  'january': 1, 'jan': 1,
  'february': 2, 'feb': 2,
  'march': 3, 'mar': 3,
  'april': 4, 'apr': 4,
  'may': 5,
  'june': 6, 'jun': 6,
  'july': 7, 'jul': 7,
  'august': 8, 'aug': 8,
  'september': 9, 'sep': 9,
  'october': 10, 'oct': 10,
  'november': 11, 'nov': 11,
  'december': 12, 'dec': 12
};

const normalizeToDDMMYYYY = (val, expectedMonthName = '') => {
  if (!val || typeof val !== 'string') return val;
  const str = val.trim();
  
  // Check YYYY-MM-DD
  const ymd = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymd) {
    const y = parseInt(ymd[1], 10);
    const m = parseInt(ymd[2], 10);
    const d = parseInt(ymd[3], 10);
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  }

  // Check DD/MM/YYYY or MM/DD/YYYY
  const dmy = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (dmy) {
    let p1 = parseInt(dmy[1], 10);
    let p2 = parseInt(dmy[2], 10);
    let y = parseInt(dmy[3], 10);
    
    if (p1 > 12 && p2 <= 12) {
      // p1 is day, p2 is month (e.g. 18/05/2026) -> keep as DD/MM/YYYY
      return `${String(p1).padStart(2, '0')}/${String(p2).padStart(2, '0')}/${y}`;
    }
    if (p1 <= 12 && p2 > 12) {
      // p1 is month, p2 is day (e.g. 05/18/2026) -> convert to DD/MM/YYYY
      return `${String(p2).padStart(2, '0')}/${String(p1).padStart(2, '0')}/${y}`;
    }
    if (p1 <= 12 && p2 <= 12) {
      // Ambiguous! Check if expectedMonthName matches p1 or p2
      const expM = expectedMonthName ? MONTH_NAMES[expectedMonthName.toLowerCase()] : null;
      if (expM) {
        if (p1 === expM && p2 !== expM) {
          // p1 is the month, p2 is the day! Convert to DD/MM/YYYY: p2 / p1
          return `${String(p2).padStart(2, '0')}/${String(p1).padStart(2, '0')}/${y}`;
        }
        if (p2 === expM && p1 !== expM) {
          // p2 is already the month, p1 is the day! Already DD/MM/YYYY
          return `${String(p1).padStart(2, '0')}/${String(p2).padStart(2, '0')}/${y}`;
        }
      }
      // If no expected month or both match, in Excel ambiguous dates were MM/DD/YYYY:
      return `${String(p2).padStart(2, '0')}/${String(p1).padStart(2, '0')}/${y}`;
    }
  }

  return val;
};

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const db = mongoose.connection.db;
  const docs = await db.collection('salescontracts').find({}).toArray();
  
  let updatedCount = 0;
  for (const doc of docs) {
    const month = doc.month || '';
    
    // Fix AS Footkraft split slices if they were erroneously put into Jan/Feb/Mar
    if (doc.companyName && doc.companyName.includes('Footkraft') && doc.customId && doc.customId.includes('split')) {
      let mName = 'September';
      let sDate = '01/09/2026';
      let rDate = '01/10/2026';
      if (doc.customId.endsWith('2')) {
        mName = 'October';
        sDate = '01/10/2026';
        rDate = '01/11/2026';
      } else if (doc.customId.endsWith('3')) {
        mName = 'November';
        sDate = '01/11/2026';
        rDate = '01/12/2026';
      }
      await db.collection('salescontracts').updateOne(
        { _id: doc._id },
        {
          $set: {
            month: mName,
            dateOfSales: sDate,
            dateOfLogin: sDate,
            renewalDate: rDate
          }
        }
      );
      updatedCount++;
      continue;
    }

    const newSales = normalizeToDDMMYYYY(doc.dateOfSales, month);
    const newLogin = normalizeToDDMMYYYY(doc.dateOfLogin, month);
    const newRen = normalizeToDDMMYYYY(doc.renewalDate, '');
    const newBal = normalizeToDDMMYYYY(doc.balancePaymentDate, '');

    const updates = {};
    if (newSales && newSales !== doc.dateOfSales) updates.dateOfSales = newSales;
    if (newLogin && newLogin !== doc.dateOfLogin) updates.dateOfLogin = newLogin;
    if (newRen && newRen !== doc.renewalDate) updates.renewalDate = newRen;
    if (newBal && newBal !== doc.balancePaymentDate) updates.balancePaymentDate = newBal;

    if (Object.keys(updates).length > 0) {
      await db.collection('salescontracts').updateOne(
        { _id: doc._id },
        { $set: updates }
      );
      console.log(`Updated [${doc.companyName}] (${doc.customId}):`, updates);
      updatedCount++;
    }
  }

  console.log(`Completed: updated ${updatedCount} contracts to unambiguous DD/MM/YYYY.`);
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
