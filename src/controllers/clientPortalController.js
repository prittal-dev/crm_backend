import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { Client } from '../models/Client.js';
import { Project } from '../models/Project.js';
import { Task } from '../models/Task.js';
import { User } from '../models/User.js';
import { TeamMember } from '../models/TeamMember.js';
import { broadcastRealtimeUpdate } from '../services/realtimeService.js';

const isObjectId = (val) => Boolean(val && mongoose.Types.ObjectId.isValid(val) && String(new mongoose.Types.ObjectId(val)) === String(val));
const makeIdConditions = (customIdVal) => {
  if (!customIdVal) return [];
  const conds = [{ customId: customIdVal }];
  if (isObjectId(customIdVal)) {
    conds.push({ _id: customIdVal });
  }
  return conds;
};

// Date Parsing Helper (DD/MM/YYYY, YYYY-MM-DD, ISO)
const parseDateToObj = (dateStr) => {
  if (!dateStr) return null;
  const str = String(dateStr).trim();
  const dmyMatch = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (dmyMatch) {
    let p1 = parseInt(dmyMatch[1], 10);
    let p2 = parseInt(dmyMatch[2], 10);
    let day = p1;
    let month = p2 - 1;
    if (p1 <= 12 && p2 > 12) {
      month = p1 - 1;
      day = p2;
    }
    const year = parseInt(dmyMatch[3], 10);
    return new Date(year, month, day, 12, 0, 0);
  }
  const ymdMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymdMatch) {
    return new Date(parseInt(ymdMatch[1], 10), parseInt(ymdMatch[2], 10) - 1, parseInt(ymdMatch[3], 10), 12, 0, 0);
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
};

const getDaysRemainingUntil = (targetDateStr) => {
  const d = parseDateToObj(targetDateStr);
  if (!d) return { days: null, text: 'Not specified', isOverdue: false, overdueDays: 0 };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  const diffMs = d.getTime() - today.getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) {
    return { days: 0, text: 'Due Today', isOverdue: false, overdueDays: 0 };
  } else if (days > 0) {
    return { days, text: `In ${days} day${days > 1 ? 's' : ''}`, isOverdue: false, overdueDays: 0 };
  } else {
    const overdueDays = Math.abs(days);
    return { days, text: `${overdueDays} day${overdueDays > 1 ? 's' : ''} overdue`, isOverdue: true, overdueDays };
  }
};

const formatDisplayDate = (dateStr) => {
  const d = parseDateToObj(dateStr);
  if (!d) return dateStr || 'N/A';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const getTaskMonthKey = (t) => {
  const raw = t.dueDate || t.completedDate || t.publishedDate || t.createdAt;
  if (!raw) return '';
  const str = String(raw).trim();
  const ymd = str.match(/^(\d{4})[-/.](\d{1,2})/);
  if (ymd) return `${ymd[1]}-${String(ymd[2]).padStart(2, '0')}`;
  const dmy = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}`;
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  return '';
};

const getMonthLabel = (monthKey) => {
  if (!monthKey) return 'Current Month';
  if (monthKey.includes('-')) {
    const [y, m] = monthKey.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }
  return monthKey;
};

// Helper to build contract months for a project
const buildProjectMonths = (project, allTasks) => {
  const startRaw = project?.startDate || project?.handoverDate || project?.salesDate || project?.createdAt || '2026-05-18';
  const startObj = parseDateToObj(startRaw) || new Date();

  // Find maximum monthNumber present in tasks or default to 12
  const maxTaskMonth = (allTasks || []).reduce((max, t) => Math.max(max, Number(t.monthNumber) || 0), 0);
  const totalMonths = Math.max(12, maxTaskMonth || 1);

  const months = [];
  const now = new Date();

  for (let m = 1; m <= totalMonths; m++) {
    const anchorDate = new Date(startObj.getFullYear(), startObj.getMonth() + (m - 1), 1);
    const monthName = anchorDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const ymdKey = `${anchorDate.getFullYear()}-${String(anchorDate.getMonth() + 1).padStart(2, '0')}`;
    const mKey = `m${m}`;

    // Filter tasks belonging to monthNumber m (or fallback to dueDate matching calendar month)
    const mTasks = (allTasks || []).filter(t => {
      if (t.monthNumber !== undefined && t.monthNumber !== null && t.monthNumber !== '') {
        return Number(t.monthNumber) === m;
      }
      return getTaskMonthKey(t) === ymdKey;
    });

    const isCurrent = (now.getFullYear() === anchorDate.getFullYear() && now.getMonth() === anchorDate.getMonth());

    months.push({
      monthNumber: m,
      key: mKey,
      altKey: ymdKey,
      label: `Month ${m} (${monthName})`,
      shortLabel: monthName,
      monthName,
      isCurrent,
      taskCount: mTasks.length
    });
  }

  return months;
};

// Helper to resolve the active month object from a requested query parameter
const resolveActiveMonth = (requestedMonth, months) => {
  if (!months || months.length === 0) return null;
  if (!requestedMonth || requestedMonth === 'current') {
    return months.find(m => m.isCurrent) || months[0];
  }

  const clean = String(requestedMonth).toLowerCase().trim();
  // 1. Match on key ('m1', 'm2')
  let found = months.find(m => m.key.toLowerCase() === clean);
  if (found) return found;

  // 2. Match on monthNumber (e.g. '1', '2')
  const num = Number(clean.replace('m', ''));
  if (!isNaN(num)) {
    found = months.find(m => m.monthNumber === num);
    if (found) return found;
  }

  // 3. Match on altKey / YYYY-MM (e.g. '2026-05')
  found = months.find(m => m.altKey === clean);
  if (found) return found;

  // 4. Match on monthName partial
  found = months.find(m => m.monthName.toLowerCase().includes(clean));
  if (found) return found;

  return months.find(m => m.isCurrent) || months[0];
};

const isTaskInSelectedMonth = (t, activeMonthObj) => {
  if (!activeMonthObj) return true;
  if (t.monthNumber !== undefined && t.monthNumber !== null && t.monthNumber !== '') {
    return Number(t.monthNumber) === activeMonthObj.monthNumber;
  }
  return getTaskMonthKey(t) === activeMonthObj.altKey;
};

const JWT_SECRET = process.env.JWT_SECRET || 'crm_secret_key_production_grade_jwt_2026';

const generateClientToken = (clientPayload) => {
  return jwt.sign(
    {
      id: clientPayload.id,
      clientId: clientPayload.clientId,
      projectId: clientPayload.projectId,
      role: 'client',
      companyName: clientPayload.companyName,
      brandName: clientPayload.brandName,
      email: clientPayload.email,
      phone: clientPayload.phone
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
};

// ==========================================
// 1. CLIENT PORTAL LOGIN
// ==========================================
export const clientLogin = async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const cleanId = String(identifier || '').trim();
    const cleanPass = String(password || '').trim();

    if (!cleanId || !cleanPass) {
      return res.status(400).json({ success: false, message: 'Username/Email/Phone and password are required.' });
    }

    // 1. Search Client model first
    let clientDoc = await Client.findOne({
      $or: [
        { 'portalAccess.username': cleanId },
        { 'portalAccess.email': cleanId.toLowerCase() },
        { 'portalAccess.phone': cleanId },
        { companyName: new RegExp('^' + cleanId + '$', 'i') },
        { brandName: new RegExp('^' + cleanId + '$', 'i') },
        { displayName: new RegExp('^' + cleanId + '$', 'i') },
        { 'contacts.phone': cleanId },
        { 'contacts.email': cleanId.toLowerCase() }
      ]
    });

    // 2. If not found in Client, search Project model
    let projectDoc = null;
    if (!clientDoc) {
      projectDoc = await Project.findOne({
        $or: [
          { 'portalAccess.username': cleanId },
          { 'portalAccess.email': cleanId.toLowerCase() },
          { 'portalAccess.phone': cleanId },
          { companyName: new RegExp('^' + cleanId + '$', 'i') },
          { brandName: new RegExp('^' + cleanId + '$', 'i') },
          { name: new RegExp('^' + cleanId + '$', 'i') },
          { clientPhone: cleanId },
          { clientEmail: cleanId.toLowerCase() }
        ]
      });
    } else {
      // Find matching project for clientDoc
      projectDoc = await Project.findOne({
        $or: [
          { clientId: clientDoc.customId || clientDoc._id.toString() },
          { companyName: new RegExp('^' + clientDoc.companyName + '$', 'i') },
          { brandName: new RegExp('^' + (clientDoc.brandName || clientDoc.companyName) + '$', 'i') }
        ]
      });
    }

    const entity = clientDoc || projectDoc;
    if (!entity) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. Client account not found.' });
    }

    const access = entity.portalAccess;
    if (!access || access.enabled === false) {
      return res.status(403).json({
        success: false,
        message: 'Client portal access is currently pending or disabled. Please contact your Account Manager.'
      });
    }

    // Verify Password: Check hashed password OR matching temporary password
    let isMatch = false;
    if (access.passwordHash) {
      isMatch = await bcrypt.compare(cleanPass, access.passwordHash);
    }
    if (!isMatch && access.tempPassword && access.tempPassword === cleanPass) {
      isMatch = true;
    }

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid password. Please verify and try again.' });
    }

    // Update lastLogin timestamp
    entity.portalAccess.lastLogin = new Date();
    await entity.save();

    const clientPayload = {
      id: entity._id.toString(),
      clientId: clientDoc?.customId || clientDoc?._id.toString() || projectDoc?.clientId || projectDoc?.customId,
      projectId: projectDoc?.customId || projectDoc?._id.toString() || null,
      companyName: entity.companyName || entity.name || 'Client',
      brandName: entity.brandName || entity.displayName || entity.companyName || '',
      email: access.email || entity.clientEmail || '',
      phone: access.phone || entity.clientPhone || ''
    };

    const token = generateClientToken(clientPayload);

    return res.json({
      success: true,
      message: 'Login successful! Welcome to your Deliverables Portal.',
      token,
      client: clientPayload
    });
  } catch (err) {
    console.error('[clientLogin] Error:', err);
    return res.status(500).json({ success: false, message: 'Server error during login: ' + err.message });
  }
};

// ==========================================
// 2. CLIENT DASHBOARD & QUOTAS SUMMARY
// ==========================================
// 2. CLIENT DASHBOARD & QUOTAS SUMMARY
// ==========================================
export const getClientDashboard = async (req, res) => {
  try {
    const { clientId, projectId, companyName, brandName } = req.client;
    const requestedMonth = req.query.month;

    // Resolve all matching projects for this client
    const projectConditions = [];
    if (projectId) projectConditions.push(...makeIdConditions(projectId));
    if (clientId) {
      projectConditions.push({ clientId: clientId });
      projectConditions.push(...makeIdConditions(clientId));
    }
    if (companyName) projectConditions.push({ companyName: new RegExp('^' + companyName + '$', 'i') });
    if (brandName) projectConditions.push({ brandName: new RegExp('^' + brandName + '$', 'i') });

    const projects = projectConditions.length > 0 ? await Project.find({ $or: projectConditions }).lean() : [];
    const primaryProject = projects[0] || null;

    if (!primaryProject) {
      return res.json({
        success: true,
        client: req.client,
        project: null,
        months: [],
        selectedMonth: '',
        selectedMonthLabel: '',
        quotas: {
          creatives: { title: 'Static Creatives', total: 0, delivered: 0, percentage: 0, pending: 0 },
          reels: { title: 'Reels & Video Content', total: 0, delivered: 0, percentage: 0, pending: 0 },
          carousels: { title: 'Carousels & Slides', total: 0, delivered: 0, percentage: 0, pending: 0 },
          festivals: { title: 'Festival Posts', total: 0, delivered: 0, percentage: 0, pending: 0 }
        },
        monthlyTotals: { totalPromised: 0, totalDelivered: 0, percentage: 0 },
        contractProgress: { totalTasks: 0, completedTasks: 0, percentage: 0 },
        renewal: null,
        deliverables: [],
        accountManager: null
      });
    }

    const projectIds = [];
    projects.forEach(p => {
      if (p.customId) projectIds.push(p.customId);
      if (p._id) {
        projectIds.push(p._id.toString());
        projectIds.push(p._id);
      }
    });

    // Fetch all tasks across client projects
    const allTasks = await Task.find({
      projectId: { $in: projectIds }
    }).sort({ weekNumber: 1, dueDate: 1 }).lean();

    // Helper: is a task considered delivered?
    const isTaskDelivered = (t) => {
      const isDoneStatus = ['completed', 'done', 'published'].includes(t.status);
      const hasDeliverableAsset = Boolean(t.deliveryLink && String(t.deliveryLink).trim().length > 3);
      const hasLivePublish = Boolean(t.publishUrl && String(t.publishUrl).trim().length > 3);
      return isDoneStatus || hasDeliverableAsset || hasLivePublish;
    };

    // 1. Build Project Contract Months
    const months = buildProjectMonths(primaryProject, allTasks);
    const activeMonthObj = resolveActiveMonth(requestedMonth, months);
    const activeMonthKey = activeMonthObj ? activeMonthObj.key : (months[0]?.key || 'm1');
    const activeMonthLabel = activeMonthObj ? activeMonthObj.label : 'Current Month';

    // 2. Filter tasks for the selected month
    const selectedMonthTasks = allTasks.filter(t => isTaskInSelectedMonth(t, activeMonthObj));

    // 3. Quotas calculation for the selected month
    const quotaCfg = primaryProject.deliverablesQuota || {};
    const contentCfg = primaryProject.content || {};

    const scheduledCreatives = selectedMonthTasks.filter(t => {
      const tType = String(t.taskType || '').toLowerCase();
      const tName = String(t.name || '').toLowerCase();
      return (tType === 'creative' || tName.includes('creative') || tName.includes('post')) && !tName.includes('festival') && !tType.includes('festival');
    }).length;

    const scheduledReels = selectedMonthTasks.filter(t => {
      const tType = String(t.taskType || '').toLowerCase();
      const tName = String(t.name || '').toLowerCase();
      return ['reel', 'aireels', 'basicreels', 'short', 'video'].some(k => tType.includes(k) || tName.includes(k));
    }).length;

    const scheduledCarousels = selectedMonthTasks.filter(t => {
      const tType = String(t.taskType || '').toLowerCase();
      const tName = String(t.name || '').toLowerCase();
      return tType === 'carousel' || tName.includes('carousel');
    }).length;

    const scheduledFestivals = selectedMonthTasks.filter(t => {
      const tType = String(t.taskType || '').toLowerCase();
      const tName = String(t.name || '').toLowerCase();
      return tType === 'festival' || tName.includes('festival');
    }).length;

    const targetCreatives = Math.max(scheduledCreatives, quotaCfg.creatives || contentCfg.creatives || 4);
    const targetReels = Math.max(scheduledReels, (quotaCfg.aiReels || 0) + (quotaCfg.basicReels || 0) || contentCfg.shorts || contentCfg.aiVideos || 4);
    const targetCarousels = Math.max(scheduledCarousels, quotaCfg.carousels || contentCfg.carousels || 0);
    const targetFestivals = scheduledFestivals;

    let deliveredCreatives = 0;
    let deliveredReels = 0;
    let deliveredCarousels = 0;
    let deliveredFestivals = 0;
    let pendingReviewCount = 0;

    for (const t of selectedMonthTasks) {
      const tType = String(t.taskType || '').toLowerCase();
      const tName = String(t.name || '').toLowerCase();
      const delivered = isTaskDelivered(t);

      if (t.status === 'review' || t.clientApprovalStatus === 'pending') {
        if (t.deliveryLink && !isTaskDelivered(t)) {
          pendingReviewCount++;
        }
      }

      if (delivered) {
        if (tType === 'festival' || tName.includes('festival')) {
          deliveredFestivals++;
        } else if (tType.includes('reel') || tType.includes('short') || tType.includes('video') || tName.includes('reel') || tName.includes('short')) {
          deliveredReels++;
        } else if (tType.includes('carousel') || tName.includes('carousel')) {
          deliveredCarousels++;
        } else {
          deliveredCreatives++;
        }
      }
    }

    // 4. Week Summary count for selected month
    const weekSummary = { week1: 0, week2: 0, week3: 0, week4: 0, all: selectedMonthTasks.length };
    selectedMonthTasks.forEach(t => {
      const wk = Number(t.weekNumber);
      if (wk === 1) weekSummary.week1++;
      else if (wk === 2) weekSummary.week2++;
      else if (wk === 3) weekSummary.week3++;
      else if (wk === 4) weekSummary.week4++;
    });

    // 5. Account Manager Details
    let amInfo = {
      name: primaryProject.accountManager || 'Account Manager',
      email: 'support@prittal.com',
      phone: '+91 99999 99999',
      whatsappUrl: 'https://wa.me/919999999999'
    };

    if (primaryProject.accountManager && primaryProject.accountManager !== 'Unassigned') {
      const amUser = await User.findOne({ name: new RegExp('^' + primaryProject.accountManager + '$', 'i') }).lean();
      const amTeam = !amUser ? await TeamMember.findOne({ name: new RegExp('^' + primaryProject.accountManager + '$', 'i') }).lean() : null;
      const matched = amUser || amTeam;
      if (matched) {
        const cleanPhone = (matched.phone || '').replace(/\D/g, '');
        amInfo = {
          name: matched.name,
          email: matched.email || 'support@prittal.com',
          phone: matched.phone || '+91 99999 99999',
          whatsappUrl: cleanPhone ? `https://wa.me/${cleanPhone.startsWith('91') ? cleanPhone : '91' + cleanPhone}?text=Hello%20${encodeURIComponent(matched.name)},%20I%20have%20a%20question%20regarding%20my%20deliverables` : null
        };
      }
    }

    // 6. Contract & Renewal Information
    const rawRenewalDate = primaryProject.nextRenewalDate || primaryProject.renewalDate;
    const renewalCalc = getDaysRemainingUntil(rawRenewalDate);
    const renewalInfo = {
      startDate: formatDisplayDate(primaryProject.startDate || primaryProject.handoverDate || primaryProject.salesDate),
      renewalDate: formatDisplayDate(rawRenewalDate),
      rawRenewalDate: rawRenewalDate || '',
      daysRemaining: renewalCalc.days,
      daysRemainingText: renewalCalc.text,
      isOverdue: renewalCalc.isOverdue,
      status: primaryProject.renewalStatus || (renewalCalc.isOverdue ? 'DUE' : 'ACTIVE'),
      planDuration: primaryProject.planDuration || '1 Year',
      soldPlanName: primaryProject.soldPlanName || primaryProject.name || 'Social Media Retainer'
    };

    // 7. Overall Contract Progress
    const totalContractTasks = allTasks.length;
    const completedContractTasks = allTasks.filter(isTaskDelivered).length;
    const contractProgressPercentage = totalContractTasks > 0 ? Math.min(100, Math.round((completedContractTasks / totalContractTasks) * 100)) : 100;

    // Monthly Quota Breakdown
    const quotas = {
      creatives: {
        title: 'Static Creatives',
        total: targetCreatives,
        delivered: deliveredCreatives,
        percentage: targetCreatives > 0 ? Math.min(100, Math.round((deliveredCreatives / targetCreatives) * 100)) : 100,
        pending: Math.max(0, targetCreatives - deliveredCreatives)
      },
      reels: {
        title: 'Reels & Video Content',
        total: targetReels,
        delivered: deliveredReels,
        percentage: targetReels > 0 ? Math.min(100, Math.round((deliveredReels / targetReels) * 100)) : 100,
        pending: Math.max(0, targetReels - deliveredReels)
      },
      carousels: {
        title: 'Carousels & Slides',
        total: targetCarousels,
        delivered: deliveredCarousels,
        percentage: targetCarousels > 0 ? Math.min(100, Math.round((deliveredCarousels / targetCarousels) * 100)) : 100,
        pending: Math.max(0, targetCarousels - deliveredCarousels)
      },
      festivals: {
        title: 'Festival Posts',
        total: targetFestivals,
        delivered: deliveredFestivals,
        percentage: targetFestivals > 0 ? Math.min(100, Math.round((deliveredFestivals / targetFestivals) * 100)) : 100,
        pending: Math.max(0, targetFestivals - deliveredFestivals)
      }
    };

    const totalMonthPromised = targetCreatives + targetReels + targetCarousels + targetFestivals;
    const totalMonthDelivered = deliveredCreatives + deliveredReels + deliveredCarousels + deliveredFestivals;
    const monthPercentage = totalMonthPromised > 0 ? Math.min(100, Math.round((totalMonthDelivered / totalMonthPromised) * 100)) : 100;

    return res.json({
      success: true,
      client: req.client,
      project: {
        id: primaryProject.customId || primaryProject._id,
        name: primaryProject.name,
        companyName: primaryProject.companyName,
        brandName: primaryProject.brandName,
        services: primaryProject.services
      },
      months,
      selectedMonth: activeMonthKey,
      selectedMonthNumber: activeMonthObj ? activeMonthObj.monthNumber : 1,
      selectedMonthLabel: activeMonthLabel,
      weekSummary,
      quotas,
      monthlyTotals: {
        totalPromised: totalMonthPromised,
        totalDelivered: totalMonthDelivered,
        percentage: monthPercentage
      },
      contractProgress: {
        totalTasks: totalContractTasks,
        completedTasks: completedContractTasks,
        percentage: contractProgressPercentage
      },
      renewal: renewalInfo,
      accountManager: amInfo,
      pendingReviewCount
    });
  } catch (err) {
    console.error('[getClientDashboard] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch dashboard: ' + err.message });
  }
};

// ==========================================
// 3. GET CLIENT DELIVERABLES LIST
// ==========================================
export const getClientDeliverables = async (req, res) => {
  try {
    const { clientId, projectId, companyName, brandName } = req.client;
    const { month, week, type, search } = req.query;

    const projectConditions = [];
    if (projectId) projectConditions.push(...makeIdConditions(projectId));
    if (clientId) {
      projectConditions.push({ clientId: clientId });
      projectConditions.push(...makeIdConditions(clientId));
    }
    if (companyName) projectConditions.push({ companyName: new RegExp('^' + companyName + '$', 'i') });
    if (brandName) projectConditions.push({ brandName: new RegExp('^' + brandName + '$', 'i') });

    const projects = projectConditions.length > 0 ? await Project.find({ $or: projectConditions }).lean() : [];
    const primaryProject = projects[0] || null;
    const projectIds = [];
    projects.forEach(p => {
      if (p.customId) projectIds.push(p.customId);
      if (p._id) {
        projectIds.push(p._id.toString());
        projectIds.push(p._id);
      }
    });

    // Fetch all project tasks
    const allTasks = await Task.find({ projectId: { $in: projectIds } })
      .sort({ weekNumber: 1, dueDate: 1 })
      .lean();

    // 1. Filter by Month using Contract Cycle Logic
    let filtered = allTasks;
    const months = buildProjectMonths(primaryProject, allTasks);
    let activeMonthObj = null;

    if (month && month !== 'all') {
      activeMonthObj = resolveActiveMonth(month, months);
      if (activeMonthObj) {
        filtered = filtered.filter(t => isTaskInSelectedMonth(t, activeMonthObj));
      }
    } else if (!month) {
      activeMonthObj = resolveActiveMonth('current', months);
      if (activeMonthObj) {
        filtered = filtered.filter(t => isTaskInSelectedMonth(t, activeMonthObj));
      }
    }

    // 2. Filter by Week
    if (week && week !== 'all') {
      const wkNum = Number(week);
      filtered = filtered.filter(t => Number(t.weekNumber) === wkNum);
    }

    // 3. Filter by Type
    if (type && type !== 'all') {
      if (type === 'reel') {
        filtered = filtered.filter(t => {
          const tType = String(t.taskType || '').toLowerCase();
          const tName = String(t.name || '').toLowerCase();
          return ['reel', 'aireels', 'basicreels', 'short', 'video'].some(k => tType.includes(k) || tName.includes(k));
        });
      } else if (type === 'creative') {
        filtered = filtered.filter(t => {
          const tType = String(t.taskType || '').toLowerCase();
          const tName = String(t.name || '').toLowerCase();
          return (tType === 'creative' || tName.includes('creative') || tName.includes('post')) && !tName.includes('festival') && !tType.includes('festival');
        });
      } else if (type === 'festival') {
        filtered = filtered.filter(t => {
          const tType = String(t.taskType || '').toLowerCase();
          const tName = String(t.name || '').toLowerCase();
          return tType === 'festival' || tName.includes('festival');
        });
      } else if (type === 'carousel') {
        filtered = filtered.filter(t => {
          const tType = String(t.taskType || '').toLowerCase();
          const tName = String(t.name || '').toLowerCase();
          return tType === 'carousel' || tName.includes('carousel');
        });
      }
    }

    // 4. Filter by Search Query
    if (search && search.trim()) {
      const s = search.trim().toLowerCase();
      filtered = filtered.filter(t =>
        String(t.name || '').toLowerCase().includes(s) ||
        String(t.remarks || '').toLowerCase().includes(s)
      );
    }

    // Map into customer-friendly deliverable objects
    const deliverables = filtered.map(t => {
      const isDelivered = ['completed', 'done', 'published'].includes(t.status) || Boolean(t.deliveryLink);
      let displayStatus = 'Scheduled';
      if (['published'].includes(t.status) || t.publishUrl) {
        displayStatus = 'Published Live';
      } else if (isDelivered) {
        displayStatus = 'Delivered';
      } else if (t.status === 'review' || t.status === 'in_review') {
        displayStatus = 'Ready for Review';
      } else if (t.status === 'in_progress') {
        displayStatus = 'In Production';
      }

      return {
        id: t._id.toString(),
        name: t.name,
        taskType: t.taskType || 'creative',
        monthNumber: t.monthNumber || (activeMonthObj ? activeMonthObj.monthNumber : 1),
        weekNumber: t.weekNumber || 1,
        dueDate: t.dueDate || '',
        formattedDueDate: formatDisplayDate(t.dueDate),
        completedDate: t.completedDate || t.completedAt || '',
        formattedCompletedDate: formatDisplayDate(t.completedDate || t.completedAt),
        displayStatus,
        status: t.status,
        deliveryLink: t.deliveryLink || '',
        publishUrl: t.publishUrl || '',
        publishPlatform: t.publishPlatform || '',
        remarks: t.remarks || '',
        clientApprovalStatus: t.clientApprovalStatus || 'pending',
        clientFeedback: t.clientFeedback || null
      };
    });
    return res.json({
      success: true,
      count: deliverables.length,
      deliverables
    });
  } catch (err) {
    console.error('[getClientDeliverables] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch deliverables: ' + err.message });
  }
};

// ==========================================
// 4. CLIENT APPROVAL / REVISION SUBMISSION
// ==========================================
export const submitDeliverableReview = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { action, comment } = req.body; // action: 'approve' | 'revision'

    if (!taskId) {
      return res.status(400).json({ success: false, message: 'Task ID is required.' });
    }

    const task = await Task.findOne({
      $or: [
        { customId: taskId },
        ...(isObjectId(taskId) ? [{ _id: taskId }] : [])
      ]
    });
    if (!task) {
      return res.status(404).json({ success: false, message: 'Deliverable task not found.' });
    }

    const clientName = req.client.brandName || req.client.companyName || 'Client';

    if (action === 'approve') {
      task.clientApprovalStatus = 'approved';
      task.reviewedBy = `${clientName} (Approved)`;
      task.clientFeedback = {
        comment: comment || 'Approved by client.',
        submittedAt: new Date()
      };
      // Add to task history
      task.history.push({
        action: 'CLIENT_APPROVED',
        performedBy: clientName,
        performedByRole: 'Client',
        timestamp: new Date(),
        details: comment || 'Client approved this deliverable via Client Portal.'
      });
    } else if (action === 'revision') {
      task.clientApprovalStatus = 'changes_requested';
      task.status = 'changes_requested';
      task.revisionNotes = comment || 'Client requested modifications.';
      task.clientFeedback = {
        comment: comment || 'Revisions requested.',
        submittedAt: new Date()
      };
      task.history.push({
        action: 'CLIENT_CHANGES_REQUESTED',
        performedBy: clientName,
        performedByRole: 'Client',
        timestamp: new Date(),
        details: comment || 'Client requested changes on this deliverable.'
      });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid action. Must be "approve" or "revision".' });
    }

    await task.save();

    // Trigger real-time broadcast so Account Manager sees it live
    broadcastRealtimeUpdate('TASK_UPDATED', {
      task: task.toJSON(),
      message: `${clientName} ${action === 'approve' ? 'approved' : 'requested changes on'} ${task.name}`
    });

    return res.json({
      success: true,
      message: action === 'approve' ? 'Deliverable successfully approved!' : 'Changes submitted to Account Manager.',
      task: {
        id: task._id.toString(),
        clientApprovalStatus: task.clientApprovalStatus,
        status: task.status,
        revisionNotes: task.revisionNotes
      }
    });
  } catch (err) {
    console.error('[submitDeliverableReview] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to record review: ' + err.message });
  }
};

// ==========================================
// 5. ADMIN / AM: SET PORTAL ACCESS CREDENTIALS
// ==========================================
export const adminSetPortalAccess = async (req, res) => {
  try {
    const { targetId, targetType, username, password, email, phone, enabled = true } = req.body;

    if (!targetId) {
      return res.status(400).json({ success: false, message: 'targetId (Client ID or Project ID) is required.' });
    }

    let entity = null;
    const targetConds = makeIdConditions(targetId);
    if (targetType === 'project') {
      entity = await Project.findOne({ $or: targetConds });
    } else {
      entity = await Client.findOne({ $or: targetConds });
      if (!entity) {
        entity = await Project.findOne({ $or: targetConds });
      }
    }

    if (!entity) {
      return res.status(404).json({ success: false, message: 'Client or Project not found.' });
    }

    const cleanUsername = String(username || entity.brandName || entity.companyName || 'client')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 30);

    const cleanPassword = String(password || `${cleanUsername}@2026`).trim();
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(cleanPassword, salt);

    entity.portalAccess = {
      enabled: Boolean(enabled),
      username: cleanUsername,
      email: email || entity.clientEmail || '',
      phone: phone || entity.clientPhone || '',
      passwordHash,
      tempPassword: cleanPassword, // Stored so AM can copy and share directly
      lastLogin: entity.portalAccess?.lastLogin || null
    };

    await entity.save();

    const origin = req.headers.origin || 'http://localhost:5173';
    const portalUrl = `${origin}/client/login`;

    return res.json({
      success: true,
      message: 'Client portal credentials configured successfully!',
      credentials: {
        enabled: entity.portalAccess.enabled,
        username: cleanUsername,
        tempPassword: cleanPassword,
        portalUrl,
        whatsappShareText: `Hello! Your Prittal Deliverables Portal is ready.\n\nPortal Login: ${portalUrl}\nUsername: ${cleanUsername}\nPassword: ${cleanPassword}\n\nYou can track all your live creatives and reels here.`
      }
    });
  } catch (err) {
    console.error('[adminSetPortalAccess] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to set portal credentials: ' + err.message });
  }
};

// ==========================================
// 6. ADMIN / AM: GET PORTAL ACCESS CREDENTIALS
// ==========================================
export const adminGetPortalAccess = async (req, res) => {
  try {
    const { targetId } = req.params;
    const targetConds = makeIdConditions(targetId);

    let entity = await Client.findOne({ $or: targetConds });
    if (!entity) {
      entity = await Project.findOne({ $or: targetConds });
    }

    if (!entity) {
      return res.status(404).json({ success: false, message: 'Target client or project not found.' });
    }

    const access = entity.portalAccess || { enabled: false };
    const origin = req.headers.origin || 'http://localhost:5173';
    const portalUrl = `${origin}/client/login`;

    return res.json({
      success: true,
      portalAccess: {
        enabled: access.enabled || false,
        username: access.username || '',
        tempPassword: access.tempPassword || '',
        email: access.email || '',
        phone: access.phone || '',
        lastLogin: access.lastLogin || null,
        portalUrl,
        whatsappShareText: access.enabled ? `Hello! Your Prittal Deliverables Portal is ready.\n\nPortal Login: ${portalUrl}\nUsername: ${access.username}\nPassword: ${access.tempPassword}\n\nYou can track all your live creatives and reels here.` : ''
      }
    });
  } catch (err) {
    console.error('[adminGetPortalAccess] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve portal access: ' + err.message });
  }
};
