import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';

try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch (e) {}
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://developmentprittal_db_user:nkYIoOAlkkBPGqXX@crm.xrqpczu.mongodb.net/prittal_crm?retryWrites=true&w=majority&appName=crm";

function cleanString(str) {
  if (typeof str !== 'string') return str;
  // Replace variations of Manish Sir / Manish sir / Maneesh sir with "Manish"
  return str
    .replace(/\bman(?:eesh|ish)\s+sir\b/gi, 'Manish')
    .replace(/\bmaneesh\b/gi, 'Manish');
}

function cleanObject(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') {
    return cleanString(val);
  }
  if (Array.isArray(val)) {
    return val.map(item => cleanObject(item));
  }
  if (typeof val === 'object' && val.constructor === Object) {
    const res = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = cleanObject(v);
    }
    return res;
  }
  return val;
}

async function cleanAllCollections() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB.');

  const db = mongoose.connection.db;
  const collectionsRaw = await db.listCollections().toArray();
  const collections = collectionsRaw.map(c => c.name);

  console.log('Scanning all collections:', collections);
  let totalDocsUpdated = 0;

  for (const collName of collections) {
    const coll = db.collection(collName);
    const docs = await coll.find({}).toArray();
    let updatedCount = 0;

    for (const doc of docs) {
      const originalStr = JSON.stringify(doc);
      if (/man(?:eesh|ish)\s+sir/i.test(originalStr) || /maneesh/i.test(originalStr)) {
        const cleanedDoc = cleanObject(doc);
        cleanedDoc._id = doc._id; // Guarantee _id remains intact

        await coll.replaceOne({ _id: doc._id }, cleanedDoc);
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      console.log(`[${collName}] Updated ${updatedCount} document(s).`);
      totalDocsUpdated += updatedCount;
    }
  }

  console.log(`\n🎉 Total documents cleaned across all collections: ${totalDocsUpdated}`);
  await mongoose.disconnect();
  process.exit(0);
}

cleanAllCollections().catch(err => {
  console.error('Error cleaning database:', err);
  process.exit(1);
});
