import mongoose from 'mongoose';
import dns from 'dns';

// Fix Node.js DNS SRV resolution for MongoDB Atlas on Windows
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {
  // fallback
}

const LOCAL_URI = 'mongodb://127.0.0.1:27017/prittal_crm';
const ATLAS_URI = 'mongodb+srv://developmentprittal_db_user:nkYIoOAlkkBPGqXX@crm.xrqpczu.mongodb.net/prittal_crm?retryWrites=true&w=majority&appName=crm';

async function migrateData() {
  console.log('--- Starting Migration from Local MongoDB to Atlas ---');

  // 1. Connect to Local MongoDB
  console.log('Connecting to Local MongoDB:', LOCAL_URI);
  const localConn = await mongoose.createConnection(LOCAL_URI).asPromise();
  console.log('Connected to Local MongoDB successfully.');

  // 2. Connect to Atlas MongoDB
  console.log('Connecting to Atlas MongoDB...');
  const atlasConn = await mongoose.createConnection(ATLAS_URI).asPromise();
  console.log('Connected to Atlas MongoDB successfully.');

  // 3. Get all collections from local database
  const collections = await localConn.db.listCollections().toArray();
  console.log(`Found ${collections.length} collections in local database:`, collections.map(c => c.name));

  for (const colInfo of collections) {
    const colName = colInfo.name;
    if (colName.startsWith('system.')) continue;

    console.log(`\nMigrating collection: [${colName}]...`);
    const localCollection = localConn.db.collection(colName);
    const atlasCollection = atlasConn.db.collection(colName);

    const docs = await localCollection.find({}).toArray();
    console.log(`  Read ${docs.length} documents from local [${colName}].`);

    if (docs.length > 0) {
      // Clear target collection in Atlas first to avoid duplicates
      await atlasCollection.deleteMany({});
      
      // Insert into Atlas
      const insertResult = await atlasCollection.insertMany(docs);
      console.log(`  Inserted ${insertResult.insertedCount} documents into Atlas [${colName}].`);
    } else {
      console.log(`  Collection [${colName}] is empty, skipping insert.`);
    }
  }

  console.log('\n--- Verification on Atlas ---');
  const atlasCollections = await atlasConn.db.listCollections().toArray();
  for (const colInfo of atlasCollections) {
    const count = await atlasConn.db.collection(colInfo.name).countDocuments();
    console.log(`Atlas collection [${colInfo.name}]: ${count} documents`);
  }

  await localConn.close();
  await atlasConn.close();
  console.log('\nMigration to MongoDB Atlas completed successfully!');
}

migrateData().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
