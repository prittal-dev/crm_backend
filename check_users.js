import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const users = await db.collection('users').find({}).toArray();
  console.log('All Users:', users.map(u => ({ id: u._id, customId: u.customId, name: u.name, username: u.username, role: u.role, dept: u.department })));
  const members = await db.collection('teammembers').find({}).toArray();
  console.log('All TeamMembers:', members.map(m => ({ id: m._id, customId: m.customId, name: m.name, username: m.username, role: m.role, dept: m.department })));
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
