import mongoose from 'mongoose';
import dns from 'dns';
import bcrypt from 'bcryptjs';

// Ensure DNS resolution succeeds for Atlas mongodb+srv URIs on Windows
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // fallback
}

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

import { seedDefaultPlans } from '../utils/seedPlans.js';

export const connectDB = async () => {
  const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/prittal_crm';
  
  mongoose.connection.on('error', (err) => {
    console.error(`[MongoDB Runtime Error]: ${err.message}`);
  });

  try {
    const conn = await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 5000
    });
    console.log(`[MongoDB Connected]: ${conn.connection.host}`);
    
    // Ensure Super Admin account exists
    await ensureSuperAdmin();
    // Ensure default sales plans exist
    await seedDefaultPlans();
  } catch (error) {
    console.error(`[MongoDB Connection Error]: ${error.message}`);
    console.log('⚠️ Please ensure MongoDB is running locally or specify a valid MONGODB_URI in backend/.env');
  }
};

const wipeMockData = async () => {
  try {
    // Delete any legacy demo data from collections
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
      User.deleteMany({ role: { $ne: 'superadmin' } })
    ]);
    console.log('🧹 [Database Initialized]: Zero mock data. Ready for live user entries.');
  } catch (err) {
    console.error('Error clearing mock data on startup:', err.message);
  }
};

const ensureSuperAdmin = async () => {
  try {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('mahesh123', salt);

    const existingSuperAdmin = await User.findOne({
      $or: [{ username: 'mahesh' }, { email: 'mahesh@prittal.com' }, { role: 'superadmin' }]
    });

    if (!existingSuperAdmin) {
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
      console.log('👑 Super Admin account created: mahesh / mahesh123 (Role: superadmin)');
    } else {
      existingSuperAdmin.role = 'superadmin';
      existingSuperAdmin.username = 'mahesh';
      existingSuperAdmin.name = 'Mahesh (Super Admin)';
      existingSuperAdmin.email = existingSuperAdmin.email || 'mahesh@prittal.com';
      existingSuperAdmin.department = 'Executive';
      existingSuperAdmin.passwordHash = passwordHash;
      await existingSuperAdmin.save();
      console.log('👑 Super Admin account ready: mahesh / mahesh123');
    }
  } catch (err) {
    console.error('Error ensuring superadmin:', err.message);
  }
};
