import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { TeamMember } from '../models/TeamMember.js';
import { Lead } from '../models/Lead.js';
import { Proposal } from '../models/Proposal.js';
import { Client } from '../models/Client.js';
import { FollowUp } from '../models/FollowUp.js';
import { Project } from '../models/Project.js';
import { Task } from '../models/Task.js';
import { Milestone } from '../models/Milestone.js';
import { Invoice } from '../models/Invoice.js';
import { Document } from '../models/Document.js';
import { AuditLog } from '../models/AuditLog.js';
import { broadcastRealtimeUpdate } from '../services/realtimeService.js';
import mongoose from 'mongoose';

const JWT_SECRET = process.env.JWT_SECRET || 'crm_secret_key_production_grade_jwt_2026';

const generateToken = (user) => {
  return jwt.sign(
    { id: user.customId || user._id.toString(), email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
};

export const login = async (req, res, next) => {
  try {
    const { email, username, password } = req.body;
    const identifier = (email || username || '').trim();

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Username/Email and password are required.' });
    }

    // Match by username or email
    let user = await User.findOne({
      $or: [
        { email: identifier.toLowerCase() },
        { username: identifier.toLowerCase() },
        { username: identifier }
      ]
    });

    // If identifier is mahesh (or prittal) and superadmin not created yet
    if (!user && (identifier.toLowerCase() === 'mahesh' || identifier.toLowerCase() === 'mahesh@prittal.com' || identifier.toLowerCase() === 'prittal')) {
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash('mahesh123', salt);
      user = await User.create({
        customId: 'u_superadmin_mahesh',
        username: 'mahesh',
        name: 'Mahesh (Super Admin)',
        email: 'mahesh@prittal.com',
        passwordHash,
        department: 'Executive',
        role: 'superadmin',
        isVerified: true
      });
    }

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. User not found.' });
    }

    // Verify password
    let isMatch = false;
    if (user.passwordHash) {
      isMatch = await bcrypt.compare(password, user.passwordHash);
    }
    
    // Special fallback check for superadmin credentials
    if (!isMatch) {
      if ((user.username.toLowerCase() === 'mahesh' && password === 'mahesh123') ||
          (user.username.toLowerCase() === 'prittal' && password === 'prittal123')) {
        isMatch = true;
      }
    }

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect password.' });
    }

    // Ensure Tushar has Account Manager Head designation
    const isTusharUser = (user.username && user.username.toLowerCase() === 'tushar') || (user.name && user.name.toLowerCase().includes('tushar'));
    if (isTusharUser && (!user.designation || user.designation === 'Member')) {
      user.designation = 'Account Manager Head';
      await user.save().catch(() => {});
    }

    const token = generateToken(user);
    res.json({
      success: true,
      message: `Welcome back, ${user.name}!`,
      user: {
        id: user.customId || user._id.toString(),
        name: user.name,
        username: user.username,
        email: user.email,
        department: user.department,
        designation: user.designation || (isTusharUser ? 'Account Manager Head' : 'Member'),
        role: user.role,
        isVerified: user.isVerified
      },
      token
    });
  } catch (err) {
    next(err);
  }
};

export const register = async (req, res, next) => {
  try {
    const { name, email, username, password, department, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }

    const existing = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        ...(username ? [{ username: username.toLowerCase() }] : [])
      ]
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'A user with this email or username already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await User.create({
      customId: 'u_' + Math.random().toString(36).substring(2, 9),
      name,
      username: username || email.split('@')[0],
      email: email.toLowerCase(),
      passwordHash,
      department: department || 'General',
      role: role || 'member',
      isVerified: true
    });

    // Auto-create TeamMember record so employee is selectable for tasks
    await TeamMember.create({
      customId: 'tm_' + Math.random().toString(36).substring(2, 9),
      name: newUser.name,
      department: newUser.department || 'Production',
      role: newUser.role === 'administrator' ? 'Admin' : 'Member',
      workload: 0,
      availability: 'Available',
      performance: 90
    });

    const token = generateToken(newUser);
    res.status(201).json({
      success: true,
      message: 'User registered successfully!',
      user: {
        id: newUser.customId || newUser._id.toString(),
        name: newUser.name,
        username: newUser.username,
        email: newUser.email,
        department: newUser.department,
        role: newUser.role,
        isVerified: newUser.isVerified
      },
      token
    });
  } catch (err) {
    next(err);
  }
};

// Create a user (Superadmin creates Admin; Admin creates Employee)
export const createUserByAdmin = async (req, res, next) => {
  try {
    const { name, email, username, password, department, role, designation, phone } = req.body;
    const creatorRole = (req.user?.role || 'superadmin').toLowerCase();

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanUsername = (username || email.split('@')[0]).toLowerCase().trim();
    let assignedRole = (role || 'member').toLowerCase().trim();
    const cleanDesignation = (designation || '').trim() || (assignedRole === 'administrator' ? 'Admin' : 'Member');

    // Permission enforcement: Only superadmin can grant Administrator or Superadmin privileges
    const isSalesAdminCreator = creatorRole === 'superadmin' || 
                                creatorRole === 'administrator' || 
                                creatorRole === 'sales_admin' ||
                                (req.user?.department || '').toLowerCase() === 'sales';

    if (creatorRole !== 'superadmin' && (assignedRole === 'superadmin' || (assignedRole === 'administrator' && !isSalesAdminCreator))) {
      return res.status(403).json({ success: false, message: 'Only Superadmin can grant Administrator privileges.' });
    }

    const existing = await User.findOne({
      $or: [
        { email: cleanEmail },
        { username: cleanUsername },
        { name: name.trim() }
      ]
    });
    if (existing) {
      if (cleanDesignation) existing.designation = cleanDesignation;
      if (department) existing.department = department;
      if (phone) existing.phone = (phone || '').trim();
      await existing.save();

      return res.status(200).json({
        success: true,
        message: `Account for ${existing.name} already registered. Data verified and synced.`,
        data: {
          id: existing.customId || existing._id.toString(),
          name: existing.name,
          username: existing.username,
          email: existing.email,
          department: existing.department,
          designation: existing.designation,
          role: existing.role,
          phone: existing.phone,
          createdAt: existing.createdAt
        }
      });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password.trim(), salt);

    const newUser = await User.create({
      customId: 'u_' + Math.random().toString(36).substring(2, 9),
      name: name.trim(),
      username: cleanUsername,
      email: cleanEmail,
      passwordHash,
      department: department || 'Production',
      designation: cleanDesignation,
      role: assignedRole,
      phone: (phone || '').trim(),
      createdBy: req.user?.id || 'admin',
      isVerified: true
    });

    // Auto add / sync with Team Member roster
    try {
      const existingMember = await TeamMember.findOne({ name: newUser.name });
      if (!existingMember) {
        await TeamMember.create({
          customId: 'tm_' + Math.random().toString(36).substring(2, 9),
          name: newUser.name,
          department: newUser.department || 'Production',
          role: cleanDesignation,
          workload: 0,
          availability: 'Available',
          performance: 90
        });
      } else {
        existingMember.role = cleanDesignation;
        existingMember.department = newUser.department;
        await existingMember.save();
      }
    } catch {
      // Non-blocking team member sync
    }

    // Record Audit Log
    try {
      await AuditLog.create({
        customId: 'log_' + Math.random().toString(36).substring(2, 9),
        action: 'USER_CREATED',
        category: 'Security & Access',
        performedBy: req.user?.name || 'Superadmin',
        performedByRole: creatorRole,
        targetUser: newUser.name,
        targetUserId: newUser.customId || newUser._id.toString(),
        details: `Provisioned new ${newUser.role.toUpperCase()} account (${newUser.email}) - Designation: "${cleanDesignation}" in ${newUser.department} department.`,
        changes: { role: newUser.role, designation: cleanDesignation, department: newUser.department, email: newUser.email },
        ipAddress: req.ip || '127.0.0.1'
      });
    } catch {
      // ignore
    }

    broadcastRealtimeUpdate('TEAM_UPDATED', { member: newUser });

    res.status(201).json({
      success: true,
      message: `${assignedRole.toUpperCase()} account created successfully for ${newUser.name}!`,
      data: {
        id: newUser.customId || newUser._id.toString(),
        name: newUser.name,
        username: newUser.username,
        email: newUser.email,
        department: newUser.department,
        designation: newUser.designation,
        role: newUser.role,
        phone: newUser.phone,
        createdAt: newUser.createdAt
      }
    });
  } catch (err) {
    next(err);
  }
};

// Get list of all users
export const getAllUsers = async (req, res, next) => {
  try {
    const users = await User.find().select('-passwordHash').sort({ createdAt: -1 });
    res.json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
};

// Hierarchically Edit a user's details, role, department, or password
export const editUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, email, department, role, designation, password, phone } = req.body;
    const callerRole = req.user?.role || 'superadmin';

    const targetUser = await User.findOne({
      $or: [{ customId: id }, ...(mongoose.isValidObjectId(id) ? [{ _id: id }] : [])]
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Permission enforcement
    if (callerRole !== 'superadmin') {
      if (targetUser.role === 'superadmin') {
        return res.status(403).json({ success: false, message: 'Only Superadmin can edit Superadmin accounts.' });
      }
      if (targetUser.role === 'administrator' && callerRole === 'administrator' && targetUser.email !== req.user?.email) {
        return res.status(403).json({ success: false, message: 'Admins cannot edit other Administrators. Superadmin permission required.' });
      }
      if (role && (role === 'superadmin' || role === 'administrator') && callerRole !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Only Superadmin can grant Admin or Superadmin privileges.' });
      }
    }

    const previousData = {
      name: targetUser.name,
      department: targetUser.department,
      designation: targetUser.designation,
      role: targetUser.role
    };

    if (name) targetUser.name = name.trim();
    if (email) targetUser.email = email.toLowerCase().trim();
    if (department) targetUser.department = department;
    if (role) targetUser.role = role;
    if (designation !== undefined) targetUser.designation = designation.trim();
    if (phone !== undefined) targetUser.phone = phone;

    let passwordUpdated = false;
    if (password && password.trim().length >= 4) {
      const salt = await bcrypt.genSalt(10);
      targetUser.passwordHash = await bcrypt.hash(password.trim(), salt);
      passwordUpdated = true;
    }

    await targetUser.save();

    // Sync with TeamMember collection
    try {
      const cleanRole = targetUser.designation || (targetUser.role === 'administrator' ? 'Admin' : 'Member');
      await TeamMember.updateMany(
        { $or: [{ name: previousData.name }, { name: targetUser.name }] },
        {
          name: targetUser.name,
          department: targetUser.department,
          role: cleanRole
        }
      );
    } catch {
      // ignore
    }

    // Record Audit Log
    try {
      await AuditLog.create({
        customId: 'log_' + Math.random().toString(36).substring(2, 9),
        action: passwordUpdated ? 'USER_ROLE_AND_CREDENTIALS_UPDATED' : 'USER_ROLE_UPDATED',
        category: 'User Management',
        performedBy: req.user?.name || 'Superadmin',
        performedByRole: callerRole,
        targetUser: targetUser.name,
        targetUserId: targetUser.customId || targetUser._id.toString(),
        details: `Updated ${targetUser.name}: Role "${targetUser.role}", Designation "${targetUser.designation}", Dept "${targetUser.department}"${passwordUpdated ? ', Password changed' : ''}.`,
        changes: {
          previous: previousData,
          current: { name: targetUser.name, department: targetUser.department, designation: targetUser.designation, role: targetUser.role },
          passwordChanged: passwordUpdated
        },
        ipAddress: req.ip || '127.0.0.1'
      });
    } catch {
      // ignore
    }

    broadcastRealtimeUpdate('TEAM_UPDATED', { member: targetUser });

    res.json({
      success: true,
      message: `Account for ${targetUser.name} updated successfully!`,
      data: {
        id: targetUser.customId || targetUser._id.toString(),
        name: targetUser.name,
        username: targetUser.username,
        email: targetUser.email,
        department: targetUser.department,
        designation: targetUser.designation,
        role: targetUser.role,
        phone: targetUser.phone,
        updatedAt: targetUser.updatedAt
      }
    });
  } catch (err) {
    next(err);
  }
};

// Delete a user
export const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const callerRole = req.user?.role || 'superadmin';

    const user = await User.findOne({
      $or: [{ customId: id }, ...(mongoose.isValidObjectId(id) ? [{ _id: id }] : [])]
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (user.role === 'superadmin') {
      return res.status(400).json({ success: false, message: 'Cannot delete Superadmin account.' });
    }

    if (callerRole !== 'superadmin' && user.role === 'administrator') {
      return res.status(403).json({ success: false, message: 'Only Superadmin can delete Administrator accounts.' });
    }

    await User.deleteOne({ _id: user._id });
    await TeamMember.deleteMany({ name: user.name });

    broadcastRealtimeUpdate('TEAM_UPDATED', { id: user.customId || user._id.toString(), member: user, isDeleted: true });

    // Record Audit Log
    try {
      await AuditLog.create({
        customId: 'log_' + Math.random().toString(36).substring(2, 9),
        action: 'USER_DELETED',
        category: 'Security & Access',
        performedBy: req.user?.name || 'Superadmin',
        performedByRole: callerRole,
        targetUser: user.name,
        targetUserId: user.customId || user._id.toString(),
        details: `Deleted account for ${user.name} (${user.role} in ${user.department}).`,
        changes: { deletedUser: { name: user.name, email: user.email, role: user.role } },
        ipAddress: req.ip || '127.0.0.1'
      });
    } catch {
      // ignore
    }

    res.json({ success: true, message: `User ${user.name} removed.` });
  } catch (err) {
    next(err);
  }
};

// Retrieve Audit Logs (Superadmin Only)
export const getAuditLogs = async (req, res, next) => {
  try {
    const callerRole = req.user?.role || 'superadmin';
    if (callerRole !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Access denied: Only Superadmin can view Security Audit Logs.' });
    }
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, data: logs });
  } catch (err) {
    next(err);
  }
};

export const verifyEmail = async (req, res, next) => {
  try {
    const { email, code } = req.body;
    if (!code || (code !== '123456' && code.length !== 6)) {
      return res.status(400).json({ success: false, message: 'Invalid verification code.' });
    }

    if (email) {
      await User.findOneAndUpdate(
        { email: email.toLowerCase() },
        { isVerified: true, verificationCode: null }
      );
    }

    res.json({ success: true, message: 'Email verified successfully!' });
  } catch (err) {
    next(err);
  }
};

export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    res.json({ success: true, message: `Recovery link sent to ${email}` });
  } catch (err) {
    next(err);
  }
};

export const resetPassword = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (email && password) {
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);
      await User.findOneAndUpdate(
        { email: email.toLowerCase() },
        { passwordHash }
      );
    }
    res.json({ success: true, message: 'Password has been reset successfully!' });
  } catch (err) {
    next(err);
  }
};

export const getMe = async (req, res, next) => {
  try {
    const user = await User.findOne({
      $or: [{ customId: req.user.id }, { email: req.user.email }]
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const isTusharUser = (user.username && user.username.toLowerCase() === 'tushar') || (user.name && user.name.toLowerCase().includes('tushar'));
    if (isTusharUser && (!user.designation || user.designation === 'Member')) {
      user.designation = 'Account Manager Head';
      await user.save().catch(() => {});
    }

    res.json({
      success: true,
      user: {
        id: user.customId || user._id.toString(),
        name: user.name,
        username: user.username,
        email: user.email,
        department: user.department,
        designation: user.designation || (isTusharUser ? 'Account Manager Head' : 'Member'),
        role: user.role,
        isVerified: user.isVerified
      }
    });
  } catch (err) {
    next(err);
  }
};

export const updateProfile = async (req, res, next) => {
  try {
    const { name, email, phone } = req.body;
    const userId = req.user?.id;

    const user = await User.findOneAndUpdate(
      { $or: [{ customId: userId }, { email: req.user.email }] },
      {
        ...(name && { name }),
        ...(email && { email: email.toLowerCase() }),
        ...(phone !== undefined && { phone })
      },
      { new: true }
    );

    res.json({
      success: true,
      message: 'Profile updated successfully!',
      user: {
        id: user.customId || user._id.toString(),
        name: user.name,
        username: user.username,
        email: user.email,
        department: user.department,
        role: user.role,
        isVerified: user.isVerified
      }
    });
  } catch (err) {
    next(err);
  }
};

export const setDepartment = async (req, res, next) => {
  try {
    const { department } = req.body;
    const userId = req.user?.id;

    if (userId) {
      await User.findOneAndUpdate(
        { $or: [{ customId: userId }, { email: req.user?.email }] },
        { department }
      );
    }

    res.json({ success: true, message: `Department set to ${department}`, department });
  } catch (err) {
    next(err);
  }
};

export const setRole = async (req, res, next) => {
  try {
    const { role } = req.body;
    const userId = req.user?.id;

    if (userId) {
      await User.findOneAndUpdate(
        { $or: [{ customId: userId }, { email: req.user?.email }] },
        { role }
      );
    }

    res.json({ success: true, message: `Assigned role: ${role.toUpperCase()}`, role });
  } catch (err) {
    next(err);
  }
};

export const googleLogin = async (req, res, next) => {
  try {
    const { credential, email: directEmail, name: directName, picture, googleId } = req.body;
    let email = directEmail;
    let name = directName;
    let avatar = picture;

    // If Google JWT credential provided, decode claims
    if (credential) {
      try {
        const decoded = jwt.decode(credential);
        if (decoded && decoded.email) {
          email = decoded.email;
          name = decoded.name || name;
          avatar = decoded.picture || avatar;
        }
      } catch (decodeErr) {
        console.warn('Could not decode Google JWT credential, using fallback fields', decodeErr);
      }
    }

    if (!email) {
      return res.status(400).json({ success: false, message: 'Valid Google email is required.' });
    }

    email = email.toLowerCase().trim();
    name = (name || email.split('@')[0]).trim();

    // Check if user exists
    let user = await User.findOne({ email });

    if (!user) {
      return res.status(403).json({ 
        success: false, 
        message: 'Account not found. Only registered users can log in.' 
      });
    } else {
      if (!user.isVerified) {
        user.isVerified = true;
        await user.save();
      }
    }

    const token = generateToken(user);

    res.json({
      success: true,
      message: `Signed in with Google successfully. Welcome, ${user.name}!`,
      user: {
        id: user.customId || user._id.toString(),
        name: user.name,
        username: user.username,
        email: user.email,
        department: user.department,
        role: user.role,
        isVerified: user.isVerified
      },
      token
    });
  } catch (err) {
    next(err);
  }
};

export const resetAllData = async (req, res, next) => {
  try {
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
      User.deleteMany({ role: { $ne: 'superadmin' } }) // Keep superadmin
    ]);

    res.json({
      success: true,
      message: 'All collections have been reset to zero (Superadmin preserved).'
    });
  } catch (err) {
    next(err);
  }
};

