import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch {}
dotenv.config();

const MONGODB_URI = "mongodb+srv://developmentprittal_db_user:nkYIoOAlkkBPGqXX@crm.xrqpczu.mongodb.net/prittal_crm?retryWrites=true&w=majority&appName=crm";

async function fixName() {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const collectionsRaw = await db.listCollections().toArray();
    const collections = collectionsRaw.map(c => c.name);
    console.log('Collections:', collections);

    for (const collName of collections) {
        const coll = db.collection(collName);
        const docs = await coll.find({}).toArray();
        let updatedCount = 0;

        for (const doc of docs) {
            let changed = false;
            let strDoc = JSON.stringify(doc);
            if (strDoc.includes('Maneesh') || strDoc.includes('maneesh')) {
                strDoc = strDoc.replace(/Maneesh/g, 'Manish').replace(/maneesh/g, 'manish');
                changed = true;
            }
            if (changed) {
                const updatedDoc = JSON.parse(strDoc);
                // preserve _id correctly if it's an ObjectId
                updatedDoc._id = doc._id;
                await coll.replaceOne({ _id: doc._id }, updatedDoc);
                updatedCount++;
            }
        }
        if (updatedCount > 0) {
            console.log(`Updated ${updatedCount} documents in ${collName}`);
        }
    }

    console.log('Done');
    process.exit(0);
}

fixName().catch(console.error);
