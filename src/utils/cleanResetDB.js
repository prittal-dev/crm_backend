import dns from 'dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

dotenv.config();

import { User } from '../models/User.js';
import { Lead } from '../models/Lead.js';
import { Proposal } from '../models/Proposal.js';
import { Client } from '../models/Client.js';
import { FollowUp } from '../models/FollowUp.js';
import { Project } from '../models/Project.js';
import { Task } from '../models/Task.js';
import { Milestone } from '../models/Milestone.js';
import { TeamMember } from '../models/TeamMember.js';
import { Invoice } from '../models/Invoice.js';
import { Document } from '../models/Document.js';
import { Notification } from '../models/Notification.js';
import { AuditLog } from '../models/AuditLog.js';

const resetDatabase = async () => {
  const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/prittal_crm';
  console.log(`Connecting to MongoDB at: ${mongoURI}`);

  try {
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 5000
    });
    console.log('MongoDB Connected.');

    console.log('Clearing all collections...');
    await Promise.all([
      Lead.deleteMany({}),
      Proposal.deleteMany({}),
      Client.deleteMany({}),
      FollowUp.deleteMany({}),
      Project.deleteMany({}),
      Task.deleteMany({}),
      Milestone.deleteMany({}),
      TeamMember.deleteMany({}),
      Invoice.deleteMany({}),
      Document.deleteMany({}),
      Notification.deleteMany({}),
      AuditLog.deleteMany({}),
      User.deleteMany({})
    ]);

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('mahesh123', salt);

    await User.create({
      customId: 'u_superadmin_mahesh',
      username: 'mahesh',
      name: 'Mahesh (Super Admin)',
      email: 'mahesh@prittal.com',
      passwordHash,
      department: 'Executive',
      role: 'superadmin',
      isVerified: true
    });

    console.log('----------------------------------------------------');
    console.log('SUCCESS: All dummy & demo data wiped clean!');
    console.log('Fresh Super Admin created:');
    console.log('Username: mahesh');
    console.log('Password: mahesh123');
    console.log('Role: superadmin');
    console.log('----------------------------------------------------');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error during database reset:', err);
    process.exit(1);
  }
};

resetDatabase();
