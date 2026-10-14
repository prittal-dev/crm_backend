import { Project } from '../models/Project.js';
import { SalesContract } from '../models/SalesContract.js';
import { Task } from '../models/Task.js';
import { Milestone } from '../models/Milestone.js';
import { TeamMember } from '../models/TeamMember.js';
import { User } from '../models/User.js';
import { Notification } from '../models/Notification.js';
import { AuditLog } from '../models/AuditLog.js';
import { broadcastRealtimeUpdate } from '../services/realtimeService.js';
import { generateDeliverablesForProjectBackend } from '../utils/taskGenerator.js';
import { getProjectServiceProfile } from '../utils/serviceProjectUtils.js';
import { 
  realignDeliverableDatesForProject, 
  realignAllProjectsDeliverables,
  deduplicateProjectTasksInDb,
  deduplicateAllProjectsTasksInDb,
  pruneTasksPastRenewalForProject,
  pruneAllProjectsTasksPastRenewal
} from '../utils/deliverableHealer.js';
import mongoose from 'mongoose';

const escapeRegex = (str) => String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeYMD = (val) => {
  if (!val) return '';
  const str = String(val).trim();
  const dmyMatch = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (dmyMatch) {
    let p1 = parseInt(dmyMatch[1], 10);
    let p2 = parseInt(dmyMatch[2], 10);
    let day = p1, month = p2;
    if (p1 <= 12 && p2 > 12) { month = p1; day = p2; }
    return `${dmyMatch[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const ymdMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${String(parseInt(ymdMatch[2], 10)).padStart(2, '0')}-${String(parseInt(ymdMatch[3], 10)).padStart(2, '0')}`;
  }
  return str.split('T')[0];
};

const findByIdOrCustomId = (id) => {
  if (!id) return { _id: null };
  const conditions = [{ customId: id }];
  if (mongoose.isValidObjectId(id)) {
    conditions.push({ _id: id });
  }
  return { $or: conditions };
};

const normalizeProjectCounts = (proj) => {
  const p = proj.toObject ? proj.toObject() : { ...proj };
  const serviceOnly = getProjectServiceProfile(p).isServiceOnly;
  const postedLogs = (p.dailyLogs || []).filter(l => l.status && !l.status.toUpperCase().includes('PENDING') && !l.status.toUpperCase().includes('HOLIDAY') && !l.status.toUpperCase().includes('OFF') && !l.status.toUpperCase().includes('—'));
  const festivalsCount = postedLogs.filter(l => l.postType === 'festival' || (l.status && l.status.toUpperCase().includes('FESTIVAL'))).length;
  const creativesCount = postedLogs.filter(l => (l.postType === 'creative' || (l.status && l.status.toUpperCase().includes('CREATIVE') && !l.status.toUpperCase().includes('FESTIVAL'))) && l.postType !== 'festival').length;
  const reelsCount = postedLogs.filter(l => l.postType === 'reel' || (l.status && (l.status.toUpperCase().includes('REEL') || l.status.toUpperCase().includes('VIDEO')))).length;
  const blogsCount = postedLogs.filter(l => l.postType === 'blog' || (l.status && l.status.toUpperCase().includes('BLOG'))).length;

  const hasFest = serviceOnly ? false : (p.content?.festivalContent !== undefined ? Boolean(p.content.festivalContent) : Boolean(p.deliverablesQuota?.festival ?? true));
  const quotaCreatives = serviceOnly ? 0 : Number(p.content?.creatives ?? p.deliverablesQuota?.creatives ?? 4);
  const quotaReels = serviceOnly ? 0 : Number(p.content?.shorts ?? p.content?.aiVideos ?? p.deliverablesQuota?.aiReels ?? p.deliverablesQuota?.basicReels ?? 4);

  p.deliverablesQuota = {
    ...p.deliverablesQuota,
    creatives: quotaCreatives,
    aiReels: quotaReels,
    festival: hasFest
  };

  const rawDoneCreatives = Math.max(p.deliveredCounts?.creatives || 0, creativesCount);
  const rawDoneReels = Math.max(p.deliveredCounts?.reels || 0, reelsCount);
  const rawDoneFestivals = Math.max(p.deliveredCounts?.festivals || 0, festivalsCount);
  const rawDoneBlogs = Math.max(p.deliveredCounts?.blogs || 0, blogsCount);

  p.deliveredCounts = {
    creatives: quotaCreatives > 0 ? Math.min(rawDoneCreatives, quotaCreatives) : rawDoneCreatives,
    reels: quotaReels > 0 ? Math.min(rawDoneReels, quotaReels) : rawDoneReels,
    festivals: hasFest ? Math.min(rawDoneFestivals, 1) : rawDoneFestivals,
    blogs: rawDoneBlogs
  };

  const totalTarget = quotaCreatives + quotaReels + (hasFest ? 1 : 0);
  if (totalTarget > 0) {
    p.progress = Math.min(100, Math.round(((p.deliveredCounts.creatives + p.deliveredCounts.reels + p.deliveredCounts.festivals) / totalTarget) * 100));
  }

  // Sanitize nextRenewalDate for Annual/Yearly plans (ensure exactly 1 year, not 2+ years ahead)
  const planNorm = String(p.planDuration || '').toUpperCase();
  const isAnnual = planNorm.includes('YEAR') || planNorm.includes('ANNUAL');
  if (isAnnual && p.nextRenewalDate) {
    const baseDate = p.renewalDate || p.startDate || p.handoverDate || '';
    const syMatch = String(baseDate).match(/\b(20\d{2})\b/);
    const nyMatch = String(p.nextRenewalDate).match(/\b(20\d{2})\b/);
    if (syMatch && nyMatch) {
      const sy = parseInt(syMatch[1], 10);
      const ny = parseInt(nyMatch[1], 10);
      if (ny - sy >= 2) {
        const d = new Date(baseDate);
        if (!isNaN(d.getTime())) {
          d.setFullYear(d.getFullYear() + 1);
          const pad = n => String(n).padStart(2, '0');
          p.nextRenewalDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        }
      }
    }
  }

  return p;
};

// --- PROJECTS ---
export const getProjects = async (req, res, next) => {
    try {
      const rawProjects = await Project.find().sort({ createdAt: -1 }).lean();
      const contracts = await SalesContract.find({ isDeleted: { $ne: true }, isActive: { $ne: false } }).lean();

      // Pre-index contracts for O(1) lookup
      const contractsByProjectId = new Map();
      const contractsByClientId = new Map();
      const contractsByCleanComp = new Map();
      const contractsByCleanBrand = new Map();

      for (const c of contracts) {
        if (c.projectId) {
          if (!contractsByProjectId.has(c.projectId)) contractsByProjectId.set(c.projectId, []);
          contractsByProjectId.get(c.projectId).push(c);
        }
        if (c.clientId) {
          if (!contractsByClientId.has(c.clientId)) contractsByClientId.set(c.clientId, []);
          contractsByClientId.get(c.clientId).push(c);
        }
        const compKey = (c.companyName || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        if (compKey) {
          if (!contractsByCleanComp.has(compKey)) contractsByCleanComp.set(compKey, []);
          contractsByCleanComp.get(compKey).push(c);
        }
        const brandKey = (c.brandName || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        if (brandKey) {
          if (!contractsByCleanBrand.has(brandKey)) contractsByCleanBrand.set(brandKey, []);
          contractsByCleanBrand.get(brandKey).push(c);
        }
      }

      const projects = rawProjects.map(proj => {
        const p = normalizeProjectCounts(proj);
        const pComp = (p.companyName || p.client || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        const pBrand = (p.brandName || p.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        const pId = p.customId || (p._id ? p._id.toString() : '');
        const pMongoId = p._id ? p._id.toString() : '';

        const matchedSet = new Set();
        if (p.customId && contractsByProjectId.has(p.customId)) {
          contractsByProjectId.get(p.customId).forEach(c => matchedSet.add(c));
        }
        if (pMongoId && contractsByProjectId.has(pMongoId)) {
          contractsByProjectId.get(pMongoId).forEach(c => matchedSet.add(c));
        }
        if (p.clientId && contractsByClientId.has(p.clientId)) {
          contractsByClientId.get(p.clientId).forEach(c => matchedSet.add(c));
        }
        if (pComp && contractsByCleanComp.has(pComp)) {
          contractsByCleanComp.get(pComp).forEach(c => matchedSet.add(c));
        }
        if (pBrand && contractsByCleanBrand.has(pBrand)) {
          contractsByCleanBrand.get(pBrand).forEach(c => matchedSet.add(c));
        }

        // Substring fallback only if exact/indexed matches yielded nothing
        if (matchedSet.size === 0 && (pComp || pBrand)) {
          for (const c of contracts) {
            const cComp = (c.companyName || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
            const cBrand = (c.brandName || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
            if (
              (pComp && cComp && (pComp.includes(cComp) || cComp.includes(pComp))) ||
              (pBrand && cBrand && (pBrand.includes(cBrand) || cBrand.includes(pBrand)))
            ) {
              matchedSet.add(c);
            }
          }
        }

        const matched = Array.from(matchedSet);
        p.salesContracts = matched;
        p.connectedPlans = matched.map(c => ({
          id: c.customId || c._id,
          plan: c.plan || c.typeOfServices,
          serviceType: c.typeOfServices,
          dateOfSales: c.dateOfSales,
          value: c.fullContractValue || c.saleAmount || 0,
          duration: c.durationOfContract || '1 year',
          renewalDate: c.renewalDate,
          servicesBrief: c.servicesBrief || c.remarks || '',
          status: c.status || 'Active'
        }));

        if (matched.length > 0) {
          const distinctServices = Array.from(new Set([...(Array.isArray(p.services) ? p.services : []), ...matched.map(c => c.typeOfServices).filter(Boolean)]));
          p.services = distinctServices;

          const distinctPlans = [];
          matched.forEach(c => {
            const planText = (c.plan || c.typeOfServices || '').trim();
            if (planText && !distinctPlans.includes(planText)) distinctPlans.push(planText);
          });
          if (distinctPlans.length > 0) {
            p.soldPlanName = distinctPlans.join(' + ');
          }

          // Note: DB sync is handled periodically by syncProjectsWithSalesContracts on schedule
        }

        return p;
      });
      res.json({ success: true, data: projects });
  } catch (err) {
    next(err);
  }
};

export const getProjectById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const rawProject = await Project.findOne(findByIdOrCustomId(id)).lean();
    if (!rawProject) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }
    const p = normalizeProjectCounts(rawProject);
    const pComp = (p.companyName || p.client || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    const pBrand = (p.brandName || p.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    const pId = p.customId || (p._id ? p._id.toString() : '');

    const escapeRegExp = (str) => String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const contracts = await SalesContract.find({
      $or: [
        { projectId: p.customId },
        { projectId: p._id ? p._id.toString() : '' },
        ...(p.clientId ? [{ clientId: p.clientId }] : []),
        ...(p.brandName ? [{ brandName: new RegExp('^' + escapeRegExp(p.brandName) + '$', 'i') }] : []),
        ...(p.companyName ? [{ companyName: new RegExp('^' + escapeRegExp(p.companyName) + '$', 'i') }] : [])
      ],
      isActive: { $ne: false },
      isDeleted: { $ne: true }
    }).sort({ srNo: 1, dateOfSales: 1 }).lean();

    p.salesContracts = contracts;
    p.connectedPlans = contracts.map(c => ({
      id: c.customId || c._id,
      plan: c.plan || c.typeOfServices,
      serviceType: c.typeOfServices,
      dateOfSales: c.dateOfSales,
      value: c.fullContractValue || c.saleAmount || 0,
      duration: c.durationOfContract || '1 year',
      renewalDate: c.renewalDate,
      servicesBrief: c.servicesBrief || c.remarks || '',
      status: c.status || 'Active'
    }));

    if (contracts.length > 0) {
      const distinctServices = Array.from(new Set([...(Array.isArray(p.services) ? p.services : []), ...contracts.map(c => c.typeOfServices).filter(Boolean)]));
      p.services = distinctServices;

      const distinctPlans = [];
      contracts.forEach(c => {
        const planText = (c.plan || c.typeOfServices || '').trim();
        if (planText && !distinctPlans.includes(planText)) distinctPlans.push(planText);
      });
      if (distinctPlans.length > 0) {
        p.soldPlanName = distinctPlans.join(' + ');
      }

          // Note: DB sync is handled periodically by syncProjectsWithSalesContracts on schedule
    }

    res.json({ success: true, data: p });
  } catch (err) {
    next(err);
  }
};

export const createProject = async (req, res, next) => {
  try {
    const data = req.body;
    const newProj = await Project.create({
      customId: 'proj_' + Math.random().toString(36).substring(2, 9),
      name: data.name || 'Untitled Campaign',
      companyName: data.companyName || data.client || 'Client Entity',
      brandName: data.brandName || data.name || 'Brand',
      client: data.companyName || data.client || 'Client Entity',
      salesTeam: Array.isArray(data.salesTeam) ? data.salesTeam : [req.user?.name || ''],
      accountManager: data.accountManager || '',
      productionManager: data.productionManager || '',
      graphicDesigner: data.graphicDesigner || '',
      videoEditor: data.videoEditor || '',
      assignedMembers: Array.isArray(data.assignedMembers) ? data.assignedMembers : [],
      salesDate: data.salesDate || new Date().toISOString().split('T')[0],
      handoverDate: data.handoverDate || new Date().toISOString().split('T')[0],
      startDate: data.startDate || new Date().toISOString().split('T')[0],
      deadline: data.deadline || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      renewalDate: data.renewalDate || new Date().toISOString().split('T')[0],
      nextRenewalDate: data.nextRenewalDate || '',
      renewalStatus: data.renewalStatus || 'NEW',
      planDuration: data.planDuration || 'Monthly',
      deliverablesQuota: data.deliverablesQuota || { creatives: 8, aiReels: 4, basicReels: 0, carousels: 0, longVideos: 0, festival: true, blogs: 0, gmb: false },
      content: data.content || { creatives: 8, carousels: 0, shorts: 4, aiVideos: 0, longVideos: 0, festivalContent: 1, blogs: 0 },
      social: data.social || { facebook: '', instagram: '', linkedin: '', twitter: '', youtube: '', whatsapp: '' },
      finalRemarks: data.finalRemarks || '',
      activity: data.activity || [{ date: 'Today', event: 'Project Kickoff' }],
      manager: data.productionManager || data.accountManager || 'Tushar',
      members: data.assignedMembers || ['Yash', 'Ayush'],
      budget: data.budget || '₹25,000',
      progress: typeof data.progress === 'number' ? data.progress : 0,
      status: data.status || 'active'
    });

    await generateDeliverablesForProjectBackend(newProj, true);

    broadcastRealtimeUpdate('PROJECT_CREATED', { project: newProj });

    res.status(201).json({ success: true, message: `Project ${newProj.name} created.`, data: newProj });
  } catch (err) {
    next(err);
  }
};

export const updateProject = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (updates.accountManager && updates.accountManager !== 'Unassigned') {
      updates.assignedAmName = updates.accountManager;
      if (!updates.assignedAmId) {
        const amUser = await User.findOne({ name: new RegExp(`^${updates.accountManager.trim()}$`, 'i') });
        if (amUser) {
          updates.assignedAmId = amUser.customId || amUser._id.toString();
        }
      }
      if (updates.handoffStatus === 'Awaiting Admin Assignment') {
        updates.handoffStatus = 'Awaiting Team Assignment';
      }
    }

    if (updates.graphicDesigner && updates.graphicDesigner !== 'Unassigned') {
      const existing = await Project.findOne(findByIdOrCustomId(id));
      if (existing) {
        const members = new Set(Array.isArray(updates.assignedMembers) ? updates.assignedMembers : (existing.assignedMembers || []));
        members.add(updates.graphicDesigner);
        updates.assignedMembers = Array.from(members);
        updates.members = Array.from(members);
      }
    }

    const updated = await Project.findOneAndUpdate(
      findByIdOrCustomId(id),
      updates,
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    const hasQuotaOrDateChanges = Boolean(
      updates.deliverablesQuota ||
      updates.content ||
      updates.renewalDate ||
      updates.handoverDate ||
      updates.startDate ||
      updates.taskStartDate
    );
    if (hasQuotaOrDateChanges) {
      await generateDeliverablesForProjectBackend(updated, true);
    }

    const hasTeamChanges = Boolean(
      updates.graphicDesigner ||
      updates.videoEditor ||
      updates.uiUxDesigner ||
      updates.frontendDeveloper ||
      updates.backendDeveloper ||
      updates.webDeveloper ||
      updates.assignedMembers
    );
    if (hasTeamChanges) {
      const projIds = [updated.customId, updated._id.toString()].filter(Boolean);
      const dbUsers = await User.find({}).lean();
      const findUserId = (targetName) => {
        if (!targetName) return '';
        const tLower = targetName.toLowerCase().trim();
        const tClean = tLower.replace(/\s*\(.*?\)/g, '').trim();
        const matched = dbUsers.find(u => {
          const uUsername = (u.username || '').toLowerCase().trim();
          const uName = (u.name || '').toLowerCase().trim();
          const uClean = uName.replace(/\s*\(.*?\)/g, '').trim();
          return uUsername === tLower || uName === tLower || uClean === tClean || uUsername === tClean;
        });
        return matched ? (matched.customId || matched._id.toString()) : '';
      };

      if (updated.graphicDesigner && updated.graphicDesigner !== 'Unassigned') {
        const gdId = findUserId(updated.graphicDesigner);
        await Task.updateMany(
          {
            projectId: { $in: projIds },
            taskType: { $in: ['creative', 'festival', 'carousel'] },
            status: { $ne: 'done' }
          },
          { $set: { assignedTo: updated.graphicDesigner, assignedToId: gdId } }
        );
      }
      if (updated.videoEditor && updated.videoEditor !== 'Unassigned') {
        const veId = findUserId(updated.videoEditor);
        await Task.updateMany(
          {
            projectId: { $in: projIds },
            taskType: 'reel',
            status: { $ne: 'done' }
          },
          { $set: { assignedTo: updated.videoEditor, assignedToId: veId } }
        );
      }
      if (updated.uiUxDesigner && updated.uiUxDesigner !== 'Unassigned') {
        const uxId = findUserId(updated.uiUxDesigner);
        await Task.updateMany(
          {
            projectId: { $in: projIds },
            taskType: 'web_design',
            status: { $ne: 'done' }
          },
          { $set: { assignedTo: updated.uiUxDesigner, assignedToId: uxId } }
        );
      }
      if (updated.frontendDeveloper && updated.frontendDeveloper !== 'Unassigned') {
        const feId = findUserId(updated.frontendDeveloper);
        await Task.updateMany(
          {
            projectId: { $in: projIds },
            taskType: 'web_development',
            status: { $ne: 'done' }
          },
          { $set: { assignedTo: updated.frontendDeveloper, assignedToId: feId } }
        );
      }
      if (updated.backendDeveloper && updated.backendDeveloper !== 'Unassigned') {
        const beId = findUserId(updated.backendDeveloper);
        await Task.updateMany(
          {
            projectId: { $in: projIds },
            taskType: { $in: ['content_upload', 'deployment'] },
            status: { $ne: 'done' }
          },
          { $set: { assignedTo: updated.backendDeveloper, assignedToId: beId } }
        );
      }
      if (updated.webDeveloper && updated.webDeveloper !== 'Unassigned') {
        const wdId = findUserId(updated.webDeveloper);
        // If webDeveloper is specified and specific frontend/backend were not explicitly split
        const targetTypes = [];
        if (!updated.uiUxDesigner || updated.uiUxDesigner === 'Unassigned') targetTypes.push('web_design');
        if (!updated.frontendDeveloper || updated.frontendDeveloper === 'Unassigned') targetTypes.push('web_development');
        if (!updated.backendDeveloper || updated.backendDeveloper === 'Unassigned') targetTypes.push('content_upload', 'deployment');
        targetTypes.push('website_qa');

        if (targetTypes.length > 0) {
          await Task.updateMany(
            {
              projectId: { $in: projIds },
              taskType: { $in: targetTypes },
              status: { $ne: 'done' }
            },
            { $set: { assignedTo: updated.webDeveloper, assignedToId: wdId } }
          );
        }
      }
    }

    broadcastRealtimeUpdate('PROJECT_UPDATED', { project: updated });

    res.json({ success: true, message: 'Project updated.', data: updated });
  } catch (err) {
    next(err);
  }
};

export const updateProjectProgress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { progress } = req.body;

    const updated = await Project.findOneAndUpdate(
      findByIdOrCustomId(id),
      { progress: Number(progress) },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    broadcastRealtimeUpdate('PROJECT_UPDATED', { project: updated });

    res.json({ success: true, message: 'Progress updated.', data: updated });
  } catch (err) {
    next(err);
  }
};

// --- TASKS ---
export const getTasks = async (req, res, next) => {
    try {
      const filter = {};
      if (req.query.projectId) {
        filter.projectId = req.query.projectId;
      }
      if (req.query.assignedTo) {
        filter.assignedTo = req.query.assignedTo;
      }
      if (req.query.monthNumber) {
        filter.monthNumber = Number(req.query.monthNumber);
      }
      let tasks = await Task.find(filter).sort({ createdAt: -1 }).lean();
      res.json({ success: true, data: tasks });
  } catch (err) {
    next(err);
  }
};

export const createTask = async (req, res, next) => {
  try {
    const { 
      id,
      customId,
      name, 
      projectId, 
      assignedTo, 
      assignedToId, 
      priority, 
      dueDate, 
      status, 
      description,
      taskType,
      weekNumber,
      monthNumber,
      deliveryLink,
      deliveredCount,
      completedDate,
      remarks,
      accountManager
    } = req.body;
    
    const assignedByName = req.user?.name || 'Manager';
    const taskId = customId || id || ('t_' + Math.random().toString(36).substring(2, 9));

    // Check if task already exists with this customId to avoid duplicate key error
    let task = await Task.findOne(findByIdOrCustomId(taskId));
    if (!task && projectId && name) {
      const proj = await Project.findOne(findByIdOrCustomId(projectId));
      const projIds = [projectId];
      if (proj) {
        if (proj._id) projIds.push(String(proj._id));
        if (proj.customId) projIds.push(proj.customId);
      }
      task = await Task.findOne({
        projectId: { $in: projIds },
        name: new RegExp(`^${name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i'),
        weekNumber: typeof weekNumber === 'number' ? weekNumber : 1,
        monthNumber: typeof monthNumber === 'number' ? monthNumber : 1
      });
    }

    if (task) {
      if (name !== undefined) task.name = name;
      if (projectId !== undefined) task.projectId = projectId;
      if (taskType !== undefined) task.taskType = taskType;
      if (weekNumber !== undefined) task.weekNumber = weekNumber;
      if (monthNumber !== undefined) task.monthNumber = monthNumber;
      if (assignedTo !== undefined) task.assignedTo = assignedTo;
      if (assignedToId !== undefined) task.assignedToId = assignedToId;
      if (status !== undefined) task.status = status;
      if (dueDate !== undefined) task.dueDate = dueDate;
      if (completedDate !== undefined) task.completedDate = completedDate;
      if (deliveredCount !== undefined) task.deliveredCount = deliveredCount;
      if (deliveryLink !== undefined) task.deliveryLink = deliveryLink;
      if (remarks !== undefined) task.remarks = remarks;
      if (req.body.publishUrl !== undefined) task.publishUrl = req.body.publishUrl;
      if (req.body.publishedDate !== undefined) task.publishedDate = req.body.publishedDate;
      if (req.body.publishPlatform !== undefined) task.publishPlatform = req.body.publishPlatform;
      if (req.body.publishedCreator !== undefined) task.publishedCreator = req.body.publishedCreator;
      if (req.body.publishRemarks !== undefined) task.publishRemarks = req.body.publishRemarks;
      await task.save();
      broadcastRealtimeUpdate('TASK_UPDATED', { task });
      return res.status(200).json({ success: true, message: `Task "${task.name}" updated.`, data: task });
    }

    const newTask = await Task.create({
      customId: taskId,
      name: name || 'New Task',
      projectId: projectId || 'proj1',
      taskType: taskType || 'creative',
      weekNumber: typeof weekNumber === 'number' ? weekNumber : 1,
      monthNumber: typeof monthNumber === 'number' ? monthNumber : 1,
      assignedToId: assignedToId || '',
      assignedTo: assignedTo || '',
      assignedBy: assignedByName,
      accountManager: accountManager || '',
      description: description || '',
      priority: priority || 'medium',
      dueDate: dueDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      completedDate: completedDate || '',
      deliveredCount: typeof deliveredCount === 'number' ? deliveredCount : 1,
      deliveryLink: deliveryLink || '',
      publishUrl: req.body.publishUrl || '',
      publishedDate: req.body.publishedDate || '',
      publishPlatform: req.body.publishPlatform || '',
      publishedCreator: req.body.publishedCreator || '',
      publishRemarks: req.body.publishRemarks || '',
      remarks: remarks || '',
      status: status || 'todo',
      history: [
        {
          action: 'TASK_CREATED',
          performedBy: assignedByName || req.user?.name || 'Staff Member',
          performedByRole: req.user?.role || 'superadmin',
          performedById: req.user?.id || '',
          timestamp: new Date(),
          details: `Task created and assigned to ${assignedTo || 'Unassigned'} (Target Due Date: ${dueDate || 'Unset'})`,
          newValue: { status: status || 'todo', assignedTo: assignedTo || '', dueDate: dueDate || '' }
        }
      ]
    });

    // Save initial audit log entry
    AuditLog.create({
      customId: 'aud_' + Math.random().toString(36).substring(2, 9),
      action: 'TASK_CREATED',
      category: 'Task Management',
      performedBy: assignedByName || req.user?.name || 'Staff Member',
      performedByRole: req.user?.role || 'superadmin',
      targetUser: newTask.assignedTo || '',
      targetUserId: newTask.assignedToId || '',
      details: `Created task "${newTask.name}" for project ${newTask.projectId}. Assigned to: ${newTask.assignedTo || 'Unassigned'} (Due: ${newTask.dueDate || 'Unset'})`,
      changes: { dueDate: newTask.dueDate, status: newTask.status, assignedTo: newTask.assignedTo },
      timestamp: new Date()
    }).catch((e) => console.warn('AuditLog create error:', e.message));

    // Increment member workload
    if (newTask.assignedTo) {
      await TeamMember.findOneAndUpdate(
        { $or: [{ customId: newTask.assignedToId }, { name: newTask.assignedTo }] },
        { $inc: { workload: 1 } }
      );
    }

    // Auto-generate in-app Notification for the assigned employee
    if (newTask.assignedTo) {
      await Notification.create({
        customId: 'notif_' + Math.random().toString(36).substring(2, 9),
        userId: newTask.assignedToId || newTask.assignedTo,
        recipientName: newTask.assignedTo,
        title: `🎯 New Task: "${newTask.name}"`,
        message: `Assigned by ${assignedByName} • Due: ${newTask.dueDate || 'Today'}`,
        type: 'task_assigned',
        relatedId: newTask.customId
      }).catch((e) => console.warn('Notification create warning:', e.message));
    }

    broadcastRealtimeUpdate('TASK_CREATED', { task: newTask });
    res.status(201).json({ success: true, message: `Task "${newTask.name}" created and assigned to ${newTask.assignedTo}.`, data: newTask });
  } catch (err) {
    next(err);
  }
};

export const updateTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const targetWeek = typeof updates.weekNumber === 'number' ? updates.weekNumber : (updates.weekNumber ? parseInt(updates.weekNumber, 10) : 1);
    const targetMonth = typeof updates.monthNumber === 'number' ? updates.monthNumber : (updates.monthNumber ? parseInt(updates.monthNumber, 10) : 1);

    let task = null;
    if (id) {
      task = await Task.findOne(findByIdOrCustomId(id));
    }

    if (!task && updates.projectId && updates.name) {
      const proj = await Project.findOne(findByIdOrCustomId(updates.projectId));
      const projIds = [updates.projectId];
      if (proj) {
        if (proj._id) projIds.push(String(proj._id));
        if (proj.customId) projIds.push(proj.customId);
      }
      const weekQuery = updates.originalWeekNumber !== undefined
        ? { $in: [targetWeek, updates.originalWeekNumber] }
        : targetWeek;
      task = await Task.findOne({
        projectId: { $in: projIds },
        name: new RegExp(`^${updates.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i'),
        weekNumber: weekQuery,
        monthNumber: targetMonth
      });
    }

    let isNewTask = false;
    let oldAssignee = '';
    let oldStatus = 'todo';

    if (!task) {
      isNewTask = true;
      task = new Task({
        customId: id || updates.customId || ('t_' + Math.random().toString(36).substring(2, 9)),
        name: updates.name || 'Deliverable',
        projectId: updates.projectId || 'proj1',
        taskType: updates.taskType || 'creative',
        weekNumber: targetWeek,
        monthNumber: targetMonth,
        status: updates.status || 'todo'
      });
    } else {
      oldAssignee = task.assignedTo;
      oldStatus = task.status;
    }

    const actorName = updates.performedBy || req.user?.name || 'Staff Member';
    const actorRole = updates.performedByRole || req.user?.role || 'member';
    const actorId = updates.performedById || req.user?.id || '';

    const newHistoryEntries = [];

    if (isNewTask) {
      newHistoryEntries.push({
        action: 'TASK_CREATED',
        performedBy: actorName,
        performedByRole: actorRole,
        performedById: actorId,
        timestamp: new Date(),
        details: `Task created and assigned to ${updates.assignedTo || 'Unassigned'} (Due: ${updates.dueDate || 'Unset'})`,
        newValue: { status: task.status, assignedTo: task.assignedTo, dueDate: task.dueDate }
      });
    } else {
      if (updates.status !== undefined && updates.status !== oldStatus) {
        let statusDetail = `Status changed from "${oldStatus}" to "${updates.status}"`;
        if (updates.status === 'done') statusDetail = `Task marked as COMPLETED by ${actorName}`;
        else if (updates.status === 'in_progress') statusDetail = `Task marked IN PROGRESS (Work Started) by ${actorName}`;
        else if (updates.status === 'review') statusDetail = `Task submitted for REVIEW & APPROVAL by ${actorName}`;
        else if (updates.status === 'changes_requested') statusDetail = `Changes requested on task by ${actorName}`;

        newHistoryEntries.push({
          action: 'STATUS_CHANGED',
          performedBy: actorName,
          performedByRole: actorRole,
          performedById: actorId,
          timestamp: new Date(),
          details: statusDetail,
          previousValue: oldStatus,
          newValue: updates.status
        });
      }
      if (updates.dueDate !== undefined && updates.dueDate !== task.dueDate) {
        newHistoryEntries.push({
          action: 'DUE_DATE_CHANGED',
          performedBy: actorName,
          performedByRole: actorRole,
          performedById: actorId,
          timestamp: new Date(),
          details: `Due date rescheduled from "${task.dueDate || 'Unset'}" to "${updates.dueDate}"`,
          previousValue: task.dueDate,
          newValue: updates.dueDate
        });
      }
      if (updates.assignedTo !== undefined && updates.assignedTo !== oldAssignee) {
        newHistoryEntries.push({
          action: 'ASSIGNEE_CHANGED',
          performedBy: actorName,
          performedByRole: actorRole,
          performedById: actorId,
          timestamp: new Date(),
          details: `Assignee reassigned from "${oldAssignee || 'Unassigned'}" to "${updates.assignedTo}"`,
          previousValue: oldAssignee,
          newValue: updates.assignedTo
        });
      }
      if (updates.deliveryLink !== undefined && updates.deliveryLink !== task.deliveryLink && updates.deliveryLink) {
        newHistoryEntries.push({
          action: 'DELIVERY_SUBMITTED',
          performedBy: actorName,
          performedByRole: actorRole,
          performedById: actorId,
          timestamp: new Date(),
          details: `Delivery proof link added: "${updates.deliveryLink}"`,
          previousValue: task.deliveryLink,
          newValue: updates.deliveryLink
        });
      }
      if (updates.publishUrl !== undefined && updates.publishUrl !== task.publishUrl && updates.publishUrl) {
        newHistoryEntries.push({
          action: 'POST_PUBLISHED',
          performedBy: actorName,
          performedByRole: actorRole,
          performedById: actorId,
          timestamp: new Date(),
          details: `Live post published on ${updates.publishPlatform || 'Social Media'}: ${updates.publishUrl}`,
          newValue: updates.publishUrl
        });
      }
      if (updates.workStartedAt !== undefined && updates.workStartedAt !== task.workStartedAt && updates.workStartedAt && !task.workStartedAt) {
        newHistoryEntries.push({
          action: 'WORK_STARTED',
          performedBy: actorName,
          performedByRole: actorRole,
          performedById: actorId,
          timestamp: new Date(),
          details: `Work started at ${new Date(updates.workStartedAt).toLocaleTimeString()} (${new Date(updates.workStartedAt).toLocaleDateString()})`,
          newValue: updates.workStartedAt
        });
      }
      if (updates.submittedAt !== undefined && updates.submittedAt !== task.submittedAt && updates.submittedAt) {
        newHistoryEntries.push({
          action: 'WORK_SUBMITTED',
          performedBy: actorName,
          performedByRole: actorRole,
          performedById: actorId,
          timestamp: new Date(),
          details: `Delivered & submitted for review at ${new Date(updates.submittedAt).toLocaleTimeString()} (${new Date(updates.submittedAt).toLocaleDateString()})`,
          newValue: updates.submittedAt
        });
      }
      if (updates.revisionNotes !== undefined && updates.revisionNotes !== task.revisionNotes && updates.revisionNotes) {
        newHistoryEntries.push({
          action: 'CHANGES_REQUESTED',
          performedBy: actorName,
          performedByRole: actorRole,
          performedById: actorId,
          timestamp: new Date(),
          details: `Revision notes: "${updates.revisionNotes}"`,
          newValue: updates.revisionNotes
        });
      }
      if (updates.delayReason !== undefined && updates.delayReason !== task.delayReason && updates.delayReason) {
        newHistoryEntries.push({
          action: 'DELAY_REASON_LOGGED',
          performedBy: actorName,
          performedByRole: actorRole,
          performedById: actorId,
          timestamp: new Date(),
          details: `Delay reason: "${updates.delayReason}"`,
          newValue: updates.delayReason
        });
      }
      if (updates.remarks !== undefined && updates.remarks !== task.remarks && updates.remarks) {
        newHistoryEntries.push({
          action: 'REMARKS_UPDATED',
          performedBy: actorName,
          performedByRole: actorRole,
          performedById: actorId,
          timestamp: new Date(),
          details: `Remarks: "${updates.remarks}"`,
          newValue: updates.remarks
        });
      }
    }

    // Apply updates
    if (updates.name !== undefined) task.name = updates.name;
    if (updates.projectId !== undefined) task.projectId = updates.projectId;
    if (updates.taskType !== undefined) task.taskType = updates.taskType;
    if (updates.weekNumber !== undefined) task.weekNumber = updates.weekNumber;
    if (updates.monthNumber !== undefined) task.monthNumber = updates.monthNumber;
    if (updates.assignedTo !== undefined) task.assignedTo = updates.assignedTo;
    if (updates.assignedToId !== undefined) task.assignedToId = updates.assignedToId;
    if (updates.assignedBy !== undefined) task.assignedBy = updates.assignedBy;
    if (updates.accountManager !== undefined) task.accountManager = updates.accountManager;
    if (updates.priority !== undefined) task.priority = updates.priority;
    if (updates.dueDate !== undefined) task.dueDate = updates.dueDate;
    if (updates.completedDate !== undefined) task.completedDate = updates.completedDate;
    if (updates.deliveredCount !== undefined) task.deliveredCount = updates.deliveredCount;
    if (updates.deliveryLink !== undefined) task.deliveryLink = updates.deliveryLink;
    if (updates.publishUrl !== undefined) task.publishUrl = updates.publishUrl;
    if (updates.publishedDate !== undefined) task.publishedDate = updates.publishedDate;
    if (updates.publishPlatform !== undefined) task.publishPlatform = updates.publishPlatform;
    if (updates.publishedCreator !== undefined) task.publishedCreator = updates.publishedCreator;
    if (updates.publishRemarks !== undefined) task.publishRemarks = updates.publishRemarks;
    if (updates.remarks !== undefined) task.remarks = updates.remarks;
    if (updates.delayReason !== undefined) task.delayReason = updates.delayReason;
    if (updates.isDelayed !== undefined) task.isDelayed = updates.isDelayed;
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.status !== undefined) task.status = updates.status;
    if (updates.startedAt !== undefined) task.startedAt = updates.startedAt;
    if (updates.workStartedAt !== undefined) task.workStartedAt = updates.workStartedAt;
    if (updates.submittedAt !== undefined) task.submittedAt = updates.submittedAt;
    if (updates.completedAt !== undefined) task.completedAt = updates.completedAt;
    if (updates.timeSpentMinutes !== undefined) task.timeSpentMinutes = updates.timeSpentMinutes;
    if (updates.timeSpentFormatted !== undefined) task.timeSpentFormatted = updates.timeSpentFormatted;
    if (updates.accumulatedSeconds !== undefined) task.accumulatedSeconds = updates.accumulatedSeconds;
    if (updates.revisionNotes !== undefined) task.revisionNotes = updates.revisionNotes;
    if (updates.reviewedBy !== undefined) task.reviewedBy = updates.reviewedBy;
    if (updates.isClientHandled !== undefined) task.isClientHandled = updates.isClientHandled;
    if (updates.reviewedAt !== undefined) task.reviewedAt = updates.reviewedAt;
    if (updates.isCustomMoved !== undefined) task.isCustomMoved = updates.isCustomMoved;
    if (updates.originalDueDate !== undefined) task.originalDueDate = updates.originalDueDate;
    if (updates.originalWeekNumber !== undefined) task.originalWeekNumber = updates.originalWeekNumber;
    if (updates.isRolledOver !== undefined) task.isRolledOver = updates.isRolledOver;
    if (updates.isFixedDate !== undefined) task.isFixedDate = updates.isFixedDate;

    if (updates.isLocked !== undefined) task.isLocked = updates.isLocked;
    if (updates.fixedDateReason !== undefined) task.fixedDateReason = updates.fixedDateReason;
    if (updates.festivalDescription !== undefined) task.festivalDescription = updates.festivalDescription;

    if (newHistoryEntries.length > 0) {
      if (!task.history) task.history = [];
      task.history.push(...newHistoryEntries);

      // Async write each entry to AuditLog
      for (const entry of newHistoryEntries) {
        AuditLog.create({
          customId: 'aud_' + Math.random().toString(36).substring(2, 9),
          action: entry.action,
          category: 'Task Management',
          performedBy: entry.performedBy,
          performedByRole: entry.performedByRole,
          targetUser: task.assignedTo || '',
          targetUserId: task.assignedToId || '',
          details: `[${task.name}] ${entry.details}`,
          changes: {
            taskId: task.customId || String(task._id),
            taskName: task.name,
            previousValue: entry.previousValue,
            newValue: entry.newValue
          },
          timestamp: entry.timestamp || new Date()
        }).catch((e) => console.warn('AuditLog save error:', e.message));
      }
    }

    await task.save();



    // Rebalance workload if assignee changed
    if (updates.assignedTo && updates.assignedTo !== oldAssignee) {
      if (oldAssignee) {
        await TeamMember.findOneAndUpdate({ name: oldAssignee }, { $inc: { workload: -1 } });
      }
      await TeamMember.findOneAndUpdate({ name: updates.assignedTo }, { $inc: { workload: 1 } });
    } else if (updates.status && updates.status !== oldStatus && task.assignedTo) {
      if (updates.status === 'done' && oldStatus !== 'done') {
        const member = await TeamMember.findOne({ name: task.assignedTo });
        if (member) {
          member.workload = Math.max(0, (member.workload || 1) - 1);
          await member.save();
        }
      } else if (oldStatus === 'done' && updates.status !== 'done') {
        await TeamMember.findOneAndUpdate({ name: task.assignedTo }, { $inc: { workload: 1 } });
        // Also remove task from project dailyLogs if reverted from done (ONLY for social media deliverable tasks)
        const isWebsiteOrSeo = /web|seo|product_shoot/i.test(task.taskType || '') || /website|wirefram|frontend|backend/i.test(task.name || '');
        if (!isWebsiteOrSeo && task.projectId) {
          const project = await Project.findOne(findByIdOrCustomId(task.projectId));
          if (project) {
            const taskIdStr = task.customId || String(task._id);
            const altTaskIdStr = String(task._id);
            project.dailyLogs = (project.dailyLogs || []).filter(l => {
              if (l.taskId && (l.taskId === taskIdStr || l.taskId === altTaskIdStr || (task.customId && l.taskId === task.customId))) return false;
              return true;
            });
            const postedLogs = (project.dailyLogs || []).filter(l => l.status && !l.status.toUpperCase().includes('PENDING') && !l.status.toUpperCase().includes('HOLIDAY') && !l.status.toUpperCase().includes('OFF'));
            const creativesCount = postedLogs.filter(l => (l.postType === 'creative' || (l.status && l.status.toUpperCase().includes('CREATIVE') && !l.status.toUpperCase().includes('FESTIVAL'))) && l.postType !== 'festival').length;
            const reelsCount = postedLogs.filter(l => l.postType === 'reel' || (l.status && l.status.toUpperCase().includes('REEL'))).length;
            const festivalsCount = postedLogs.filter(l => l.postType === 'festival' || (l.status && l.status.toUpperCase().includes('FESTIVAL'))).length;
            const blogsCount = postedLogs.filter(l => l.postType === 'blog' || (l.status && l.status.toUpperCase().includes('BLOG'))).length;

            const qCreatives = Number(project.deliverablesQuota?.creatives) || 0;
            const qReels = Number(project.deliverablesQuota?.aiReels || project.deliverablesQuota?.basicReels) || 0;
            const festivalTarget = project.deliverablesQuota?.festival ? 1 : 0;
            const blogsTarget = Number(project.deliverablesQuota?.blogs || 0);

            const displayCreatives = qCreatives > 0 ? Math.min(creativesCount, qCreatives) : creativesCount;
            const displayReels = qReels > 0 ? Math.min(reelsCount, qReels) : reelsCount;
            const displayFestivals = festivalTarget > 0 ? Math.min(festivalsCount, festivalTarget) : festivalsCount;
            const displayBlogs = blogsTarget > 0 ? Math.min(blogsCount, blogsTarget) : blogsCount;

            project.deliveredCounts = {
              creatives: displayCreatives,
              reels: displayReels,
              festivals: displayFestivals,
              blogs: displayBlogs
            };

            const totalTarget = qCreatives + qReels + festivalTarget + blogsTarget;
            const totalDelivered = displayCreatives + displayReels + displayFestivals + displayBlogs;
            project.progress = totalTarget > 0 ? Math.min(100, Math.round((totalDelivered / totalTarget) * 100)) : 0;
            await project.save();
            broadcastRealtimeUpdate('PROJECT_UPDATED', { project });
          }
        }
      }
    }

    // If task is completed or deliveryLink is added, auto-sync with Project dailyLogs (only for social media deliverables, not website stages)
    const isWebsiteOrSeo = /web|seo|product_shoot/i.test(task.taskType || '') || /website|wirefram|frontend|backend/i.test(task.name || '');
    if (task.projectId && (task.status === 'done' || task.deliveryLink)) {
      const project = await Project.findOne(findByIdOrCustomId(task.projectId));
      if (!isWebsiteOrSeo && project) {
        const compDate = task.completedDate || new Date().toISOString().split('T')[0];
        const isFest = task.taskType === 'festival' || task.name?.toLowerCase().includes('festival');
        const postType = task.taskType || (task.name.toLowerCase().includes('reel') ? 'reel' : (isFest ? 'festival' : 'creative'));
        const logStatus = postType === 'reel' ? `${task.deliveredCount || 1} REEL POSTED` : (postType === 'festival' ? `${task.deliveredCount || 1} FESTIVAL CREATIVE POSTED` : `${task.deliveredCount || 1} CREATIVE POSTED`);

        const taskIdStr = task.customId || String(task._id);
        const altTaskIdStr = String(task._id);
        const existingLogIndex = (project.dailyLogs || []).findIndex(l => {
          if (l.taskId && (l.taskId === taskIdStr || l.taskId === altTaskIdStr || (task.customId && l.taskId === task.customId))) return true;
          return l.date === compDate && (l.postType || 'creative') === postType;
        });
        if (existingLogIndex >= 0) {
          project.dailyLogs[existingLogIndex].postUrl = task.deliveryLink || project.dailyLogs[existingLogIndex].postUrl;
          project.dailyLogs[existingLogIndex].status = logStatus;
          project.dailyLogs[existingLogIndex].taskId = taskIdStr;
          project.dailyLogs[existingLogIndex].creator = task.assignedTo || project.dailyLogs[existingLogIndex].creator || '';
          project.dailyLogs[existingLogIndex].remarks = task.remarks || `Delivered via Task: ${task.name}`;
          project.dailyLogs[existingLogIndex].loggedBy = req.user?.name || task.assignedTo || 'Team Member';
          project.dailyLogs[existingLogIndex].updatedAt = new Date();
        } else {
          project.dailyLogs.push({
            date: compDate,
            dayName: new Date(compDate).toLocaleDateString('en-US', { weekday: 'short' }),
            status: logStatus,
            postType: postType,
            postUrl: task.deliveryLink || '',
            creator: task.assignedTo || '',
            taskId: taskIdStr,
            remarks: task.remarks || `Delivered via Task: ${task.name}`,
            loggedBy: req.user?.name || task.assignedTo || 'Team Member',
            updatedAt: new Date()
          });
        }

        // Recalculate deliveredCounts and progress for project
        const postedLogs = (project.dailyLogs || []).filter(l => l.status && !l.status.toUpperCase().includes('PENDING') && !l.status.toUpperCase().includes('HOLIDAY') && !l.status.toUpperCase().includes('OFF'));
        const creativesCount = postedLogs.filter(l => (l.postType === 'creative' || (l.status && l.status.toUpperCase().includes('CREATIVE') && !l.status.toUpperCase().includes('FESTIVAL'))) && l.postType !== 'festival').length;
        const reelsCount = postedLogs.filter(l => l.postType === 'reel' || (l.status && l.status.toUpperCase().includes('REEL'))).length;
        const festivalsCount = postedLogs.filter(l => l.postType === 'festival' || (l.status && l.status.toUpperCase().includes('FESTIVAL'))).length;
        const blogsCount = postedLogs.filter(l => l.postType === 'blog' || (l.status && l.status.toUpperCase().includes('BLOG'))).length;

        const qCreatives = Number(project.deliverablesQuota?.creatives) || 0;
        const qReels = Number(project.deliverablesQuota?.aiReels || project.deliverablesQuota?.basicReels) || 0;
        const festivalTarget = project.deliverablesQuota?.festival ? 1 : 0;
        const blogsTarget = Number(project.deliverablesQuota?.blogs || 0);

        const displayCreatives = qCreatives > 0 ? Math.min(creativesCount, qCreatives) : creativesCount;
        const displayReels = qReels > 0 ? Math.min(reelsCount, qReels) : reelsCount;
        const displayFestivals = festivalTarget > 0 ? Math.min(festivalsCount, festivalTarget) : festivalsCount;
        const displayBlogs = blogsTarget > 0 ? Math.min(blogsCount, blogsTarget) : blogsCount;

        project.deliveredCounts = {
          creatives: displayCreatives,
          reels: displayReels,
          festivals: displayFestivals,
          blogs: displayBlogs
        };

        const totalTarget = qCreatives + qReels + festivalTarget + blogsTarget;
        const totalDelivered = displayCreatives + displayReels + displayFestivals + displayBlogs;
        project.progress = totalTarget > 0 ? Math.min(100, Math.round((totalDelivered / totalTarget) * 100)) : 0;

        await project.save();
        broadcastRealtimeUpdate('PROJECT_UPDATED', { project });
      }

      // Notify Account Manager and Admin
      const notifyTarget = task.accountManager || project?.accountManager || 'Admin';
      const actionTitle = isWebsiteOrSeo ? `🚀 Website Stage Completed: "${task.name}"` : `✅ Deliverable Submitted: "${task.name}"`;
      const actionMsg = isWebsiteOrSeo
        ? `${task.assignedTo || 'Developer'} completed stage "${task.name}" for ${project?.companyName || 'Project'}. Link: ${task.deliveryLink || 'Attached'}`
        : `${task.assignedTo} completed ${task.deliveredCount || 1} ${task.taskType || 'creative'}(s) for ${project?.companyName || 'Project'}. Link: ${task.deliveryLink || 'Attached'}`;

      await Notification.create({
        customId: 'notif_' + Math.random().toString(36).substring(2, 9),
        userId: notifyTarget,
        recipientName: notifyTarget,
        title: actionTitle,
        message: actionMsg,
        type: 'deliverable_submitted',
        relatedId: task.customId
      }).catch(e => console.warn('Notif error:', e.message));
    }

    broadcastRealtimeUpdate('TASK_UPDATED', { task });
    res.json({ success: true, message: 'Task updated successfully.', data: task });
  } catch (err) {
    next(err);
  }
};

export const updateTaskStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, deliveryLink, completedDate, deliveredCount, remarks } = req.body;

    const task = await Task.findOne(findByIdOrCustomId(id));
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }

    const oldStatus = task.status;
    const assigneeName = task.assignedTo;

    const actorName = req.body.performedBy || req.user?.name || assigneeName || 'Staff Member';
    const actorRole = req.body.performedByRole || req.user?.role || 'member';
    const actorId = req.user?.id || '';

    const statusHistory = [];
    if (status !== undefined && status !== oldStatus) {
      statusHistory.push({
        action: 'STATUS_CHANGED',
        performedBy: actorName,
        performedByRole: actorRole,
        performedById: actorId,
        timestamp: new Date(),
        details: `Status changed from "${oldStatus}" to "${status}"`,
        previousValue: oldStatus,
        newValue: status
      });
    }
    if (deliveryLink !== undefined && deliveryLink !== task.deliveryLink && deliveryLink) {
      statusHistory.push({
        action: 'DELIVERY_SUBMITTED',
        performedBy: actorName,
        performedByRole: actorRole,
        performedById: actorId,
        timestamp: new Date(),
        details: `Delivery proof link added: "${deliveryLink}"`,
        previousValue: task.deliveryLink,
        newValue: deliveryLink
      });
    }

    task.status = status;
    if (deliveryLink !== undefined) task.deliveryLink = deliveryLink;
    if (completedDate !== undefined) task.completedDate = completedDate;
    if (deliveredCount !== undefined) task.deliveredCount = deliveredCount;
    if (remarks !== undefined) task.remarks = remarks;

    if (statusHistory.length > 0) {
      if (!task.history) task.history = [];
      task.history.push(...statusHistory);

      for (const entry of statusHistory) {
        AuditLog.create({
          customId: 'aud_' + Math.random().toString(36).substring(2, 9),
          action: entry.action,
          category: 'Task Management',
          performedBy: entry.performedBy,
          performedByRole: entry.performedByRole,
          targetUser: task.assignedTo || '',
          targetUserId: task.assignedToId || '',
          details: `[${task.name}] ${entry.details}`,
          changes: {
            taskId: task.customId || String(task._id),
            taskName: task.name,
            previousValue: entry.previousValue,
            newValue: entry.newValue
          },
          timestamp: entry.timestamp || new Date()
        }).catch((e) => console.warn('AuditLog save error:', e.message));
      }
    }

    await task.save();

    // Rebalance workload
    if (assigneeName) {
      if (status === 'done' && oldStatus !== 'done') {
        const member = await TeamMember.findOne({ name: assigneeName });
        if (member) {
          member.workload = Math.max(0, (member.workload || 1) - 1);
          await member.save();
        }
      } else if (oldStatus === 'done' && status !== 'done') {
        await TeamMember.findOneAndUpdate(
          { name: assigneeName },
          { $inc: { workload: 1 } }
        );
      }
    }

    broadcastRealtimeUpdate('TASK_UPDATED', { task });
    res.json({ success: true, message: `Task status updated to ${status}`, data: task });
  } catch (err) {
    next(err);
  }
};

// --- MILESTONES ---
export const getMilestones = async (req, res, next) => {
  try {
    const milestones = await Milestone.find();
    res.json({ success: true, data: milestones });
  } catch (err) {
    next(err);
  }
};

export const createMilestone = async (req, res, next) => {
  try {
    const { projectId, title, status } = req.body;
    const newMilestone = await Milestone.create({
      customId: 'm_' + Math.random().toString(36).substring(2, 9),
      projectId: projectId || 'proj1',
      title: title || 'Milestone Title',
      status: status || 'upcoming'
    });

    broadcastRealtimeUpdate('MILESTONE_UPDATED', { milestone: newMilestone });
    res.status(201).json({ success: true, message: 'Milestone created.', data: newMilestone });
  } catch (err) {
    next(err);
  }
};

export const updateMilestoneStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const updated = await Milestone.findOneAndUpdate(
      findByIdOrCustomId(id),
      { status },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Milestone not found.' });
    }
    broadcastRealtimeUpdate('MILESTONE_UPDATED', { milestone: updated });
    res.json({ success: true, message: `Milestone status set to ${status}`, data: updated });
  } catch (err) {
    next(err);
  }
};

// --- TEAM MEMBERS ---
export const getTeamMembers = async (req, res, next) => {
  try {
    const [team, users] = await Promise.all([
      TeamMember.find(),
      User.find()
    ]);

    // Build map of users by lowercase name and email
    const userMap = new Map();
    users.forEach(u => {
      if (u.name) userMap.set(u.name.toLowerCase().trim(), u);
      if (u.username) userMap.set(u.username.toLowerCase().trim(), u);
      if (u.email) userMap.set(u.email.toLowerCase().trim(), u);
    });

    const enrichedTeam = team.map(member => {
      const matchedUser = userMap.get(member.name?.toLowerCase().trim());
      if (matchedUser) {
        const userDesig = matchedUser.designation || (matchedUser.role === 'administrator' ? 'Admin' : matchedUser.role === 'superadmin' ? 'Super Admin' : 'Member');
        return {
          ...member.toObject(),
          role: userDesig,
          department: matchedUser.department || member.department
        };
      }
      return member;
    });

    // Also include any User accounts not yet in TeamMember collection
    const existingTeamNames = new Set(team.map(m => m.name?.toLowerCase().trim()));
    users.forEach(u => {
      if (u.name && !existingTeamNames.has(u.name.toLowerCase().trim())) {
        const userDesig = u.designation || (u.role === 'administrator' ? 'Admin' : u.role === 'superadmin' ? 'Super Admin' : 'Member');
        enrichedTeam.push({
          id: u.customId || u._id.toString(),
          customId: u.customId || u._id.toString(),
          name: u.name,
          department: u.department || 'Production',
          role: userDesig,
          workload: 0,
          availability: 'Available',
          performance: 95
        });
      }
    });

    res.json({ success: true, data: enrichedTeam });
  } catch (err) {
    next(err);
  }
};

export const createTeamMember = async (req, res, next) => {
  try {
    const { name, department, role, workload, availability, performance } = req.body;
    const newMember = await TeamMember.create({
      customId: 'tm_' + Math.random().toString(36).substring(2, 9),
      name: name || 'New Member',
      department: department || 'Production',
      role: role || 'Member',
      workload: typeof workload === 'number' ? workload : 0,
      availability: availability || 'Available',
      performance: typeof performance === 'number' ? performance : 90
    });

    broadcastRealtimeUpdate('TEAM_UPDATED', { member: newMember });
    res.status(201).json({ success: true, message: `Team member ${newMember.name} added.`, data: newMember });
  } catch (err) {
    next(err);
  }
};

export const updateTeamMember = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const updated = await TeamMember.findOneAndUpdate(
      findByIdOrCustomId(id),
      updates,
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Team member not found.' });
    }
    broadcastRealtimeUpdate('TEAM_UPDATED', { member: updated });
    res.json({ success: true, message: 'Team member updated.', data: updated });
  } catch (err) {
    next(err);
  }
};

export const deleteTeamMember = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deleted = await TeamMember.findOneAndDelete(findByIdOrCustomId(id));
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Team member not found.' });
    }
    broadcastRealtimeUpdate('TEAM_UPDATED', { id, member: deleted });
    res.json({ success: true, message: `Team member ${deleted.name} removed.`, data: deleted });
  } catch (err) {
    next(err);
  }
};

export const deleteProject = async (req, res, next) => {
  try {
    const { id } = req.params;
    let deleted = null;

    // 1. Try finding by ObjectId
    if (mongoose.isValidObjectId(id)) {
      deleted = await Project.findByIdAndDelete(id);
    }
    // 2. Exact customId match
    if (!deleted) {
      deleted = await Project.findOneAndDelete({ customId: id });
    }
    // 3. Case-insensitive customId match (e.g. PROJ_UNIKPLAY vs proj_unikplay)
    if (!deleted && id) {
      deleted = await Project.findOneAndDelete({
        customId: { $regex: new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      });
    }
    // 4. Fallback: try by name or companyName
    if (!deleted && id) {
      deleted = await Project.findOneAndDelete({
        $or: [
          { name: id },
          { name: { $regex: new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
          { companyName: id },
          { companyName: { $regex: new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }
        ]
      });
    }

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Project not found in database.' });
    }

    // Cascade delete associated tasks
    const targetCustomId = deleted.customId;
    const targetId = deleted._id.toString();
    await Task.deleteMany({
      $or: [
        { projectId: targetCustomId },
        { projectId: targetId },
        { projectName: deleted.name }
      ]
    });

    broadcastRealtimeUpdate('PROJECT_DELETED', { id, project: deleted });

    res.json({ success: true, message: `Project "${deleted.name}" deleted successfully.`, data: deleted });
  } catch (err) {
    next(err);
  }
};

export const deleteTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deleted = await Task.findOneAndDelete(findByIdOrCustomId(id));
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }
    broadcastRealtimeUpdate('TASK_DELETED', { id, task: deleted });
    res.json({ success: true, message: 'Task deleted.', data: deleted });
  } catch (err) {
    next(err);
  }
};

export const deleteMilestone = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deleted = await Milestone.findOneAndDelete(findByIdOrCustomId(id));
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Milestone not found.' });
    }
    broadcastRealtimeUpdate('MILESTONE_DELETED', { id, milestone: deleted });
    res.json({ success: true, message: 'Milestone deleted.', data: deleted });
  } catch (err) {
    next(err);
  }
};

// --- NOTIFICATIONS ---
export const getNotifications = async (req, res, next) => {
  try {
    const userId = req.query.userId || req.user?.id || req.user?.customId || req.user?.username || req.user?.name;
    const userName = req.query.userName || req.user?.name;
    const userRole = req.query.role || req.user?.role;

    const identifiers = [userId, userName, req.user?.email, req.user?.username].filter(Boolean);

    // Filter out notifications cleared by this user
    const clearedFilter = identifiers.length > 0
      ? { clearedBy: { $nin: identifiers } }
      : {};

    let query = {};
    if (userRole === 'superadmin' || userRole === 'administrator') {
      // Superadmin / Admin can see system alerts, notices targeted to all/superadmin/admin, or specifically to them
      query = {
        ...clearedFilter,
        $or: [
          { userId: { $in: ['all', 'superadmin', 'admin', 'system', ...identifiers] } },
          { recipientName: { $in: ['all', 'Superadmin', 'Admin', 'Everyone', ...identifiers] } },
          { userId: { $exists: false } }
        ]
      };
    } else if (identifiers.length > 0) {
      // Regular employee: ONLY see notifications specifically addressed to them or 'all'
      query = {
        ...clearedFilter,
        $or: [
          { userId: { $in: ['all', 'everyone', ...identifiers] } },
          { recipientName: { $in: ['all', 'Everyone', ...identifiers] } },
          { recipientName: new RegExp(`^${escapeRegex(userName || userId)}$`, 'i') },
          { userId: new RegExp(`^${escapeRegex(userId || userName)}$`, 'i') }
        ]
      };
    } else {
      query = {
        ...clearedFilter,
        userId: 'all'
      };
    }

    const notifs = await Notification.find(query).sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, data: notifs });
  } catch (err) {
    next(err);
  }
};

export const markNotificationRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.body?.userId || req.query?.userId || req.user?.name || req.user?.id;

    if (id === 'all') {
      let query = {};
      if (userId) {
        query = {
          $or: [
            { userId: { $in: ['all', userId] } },
            { recipientName: { $in: ['all', userId] } }
          ]
        };
      }
      await Notification.updateMany(query, { isRead: true });
      return res.json({ success: true, message: 'All notifications marked as read.' });
    }

    const updated = await Notification.findOneAndUpdate(
      findByIdOrCustomId(id),
      { isRead: true },
      { new: true }
    );
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};

export const clearNotifications = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.body?.userId || req.query?.userId || req.user?.name || req.user?.id || 'anonymous';

    if (!id || id === 'all') {
      // Mark all visible notifications as cleared by this user
      await Notification.updateMany(
        {},
        { $addToSet: { clearedBy: userId } }
      );
      return res.json({ success: true, message: 'All notifications cleared successfully.' });
    }

    // Clear single notification
    await Notification.findOneAndUpdate(
      findByIdOrCustomId(id),
      { $addToSet: { clearedBy: userId } }
    );
    res.json({ success: true, message: 'Notification cleared.' });
  } catch (err) {
    next(err);
  }
};

// --- DAILY DELIVERABLES LOGGING ---
export const logProjectDailyStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { date, dayName, status, postType, postUrl, creator, taskId, remarks, pendingReason } = req.body;
    const loggedByName = req.user?.name || 'Account Manager';

    const project = await Project.findOne(findByIdOrCustomId(id));
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    if (!project.dailyLogs) {
      project.dailyLogs = [];
    }

    const targetDate = date || new Date().toISOString().split('T')[0];
    const isDeleteAction = status === 'N/A' || status === 'DELETE' || !status;

    let resolvedTaskId = taskId;
    let targetTask = null;

    if (resolvedTaskId) {
      targetTask = await Task.findOne(findByIdOrCustomId(resolvedTaskId));
    }

    const searchType = postType || 'creative';

    // Auto-match a pending task if no taskId is provided
    if (!targetTask && !isDeleteAction && status && !status.toUpperCase().includes('PENDING') && !status.toUpperCase().includes('HOLIDAY') && !status.toUpperCase().includes('OFF')) {
      const projIds = [id];
      if (project._id) projIds.push(project._id.toString());
      if (project.customId) projIds.push(project.customId);

      // 1. Match task on targetDate with matching taskType first!
      targetTask = await Task.findOne({
        projectId: { $in: projIds },
        taskType: searchType,
        $or: [{ dueDate: targetDate }, { completedDate: targetDate }]
      });

      // 2. Fallback to oldest pending task of that type (strictly on or before targetDate to prevent marking future weeks/tasks done!)
      if (!targetTask) {
        targetTask = await Task.findOne({
          projectId: { $in: projIds },
          taskType: searchType,
          dueDate: { $lte: targetDate },
          status: { $ne: 'done' }
        }).sort({ dueDate: 1 });
      }

      if (targetTask) {
        resolvedTaskId = targetTask.customId || targetTask._id.toString();
      }
    }

    const resolvedTaskCustomId = targetTask?.customId || '';
    const resolvedTaskMongoId = targetTask?._id ? targetTask._id.toString() : '';

    if (isDeleteAction) {
      project.dailyLogs = (project.dailyLogs || []).filter(l => {
        if (resolvedTaskId && l.taskId && (l.taskId === resolvedTaskId || l.taskId === resolvedTaskCustomId || l.taskId === resolvedTaskMongoId)) return false;
        if (l.date === targetDate && (l.postType || 'creative') === searchType) return false;
        return true;
      });
    } else {
      const newEntry = {
        date: targetDate,
        dayName: dayName || new Date(targetDate).toLocaleDateString('en-US', { weekday: 'short' }),
        status: status || '1 CREATIVE POSTED',
        postType: searchType,
        postUrl: postUrl || '',
        creator: creator || (targetTask?.assignedTo || ''),
        taskId: resolvedTaskId || '',
        remarks: remarks || (targetTask ? `Delivered via Task: ${targetTask.name}` : ''),
        pendingReason: pendingReason || '',
        loggedBy: loggedByName,
        updatedAt: new Date()
      };

      // Filter out previous entry for THIS deliverable (by taskId or by date + postType)
      project.dailyLogs = (project.dailyLogs || []).filter(l => {
        if (resolvedTaskId && l.taskId && (l.taskId === resolvedTaskId || l.taskId === resolvedTaskCustomId || l.taskId === resolvedTaskMongoId)) return false;
        if (l.date === targetDate && (l.postType || 'creative') === searchType) return false;
        return true;
      });
      project.dailyLogs.push(newEntry);
    }

    // Sync with target task ONLY (NEVER mutate other team members' tasks on the same date!)
    if (targetTask && !isDeleteAction) {
      let taskUpdated = false;

      if (targetTask.status !== 'done') {
        const oldStatus = targetTask.status;
        targetTask.status = 'done';
        targetTask.completedDate = targetDate;

        if (targetTask.assignedTo && oldStatus !== 'done') {
          const member = await TeamMember.findOne({ name: targetTask.assignedTo });
          if (member) {
            member.workload = Math.max(0, (member.workload || 1) - 1);
            await member.save();
          }
        }
        taskUpdated = true;
      }

      if (postUrl) {
        if (!targetTask.deliveryLink) targetTask.deliveryLink = postUrl;
        targetTask.publishUrl = postUrl;
        taskUpdated = true;
      }

      if (targetDate && targetTask.publishedDate !== targetDate) {
        targetTask.publishedDate = targetDate;
        taskUpdated = true;
      }

      if (creator && targetTask.publishedCreator !== creator) {
        targetTask.publishedCreator = creator;
        taskUpdated = true;
      }

      if (remarks && (targetTask.remarks !== remarks || targetTask.publishRemarks !== remarks)) {
        targetTask.remarks = remarks;
        targetTask.publishRemarks = remarks;
        taskUpdated = true;
      }

      if (taskUpdated) {
        await targetTask.save();
        broadcastRealtimeUpdate('TASK_UPDATED', { task: targetTask });
      }
    } else if (targetTask && isDeleteAction) {
      if (targetTask.status === 'done') {
        targetTask.status = 'todo';
        targetTask.deliveryLink = '';
        targetTask.completedDate = '';
        targetTask.publishedDate = '';
        targetTask.publishUrl = '';
        targetTask.publishedCreator = '';

        if (targetTask.assignedTo) {
          await TeamMember.findOneAndUpdate({ name: targetTask.assignedTo }, { $inc: { workload: 1 } });
        }

        await targetTask.save();
        broadcastRealtimeUpdate('TASK_UPDATED', { task: targetTask });
      }
    }


    // Recalculate deliveredCounts and progress
    const postedLogs = (project.dailyLogs || []).filter(l => l.status && !l.status.toUpperCase().includes('PENDING') && !l.status.toUpperCase().includes('HOLIDAY') && !l.status.toUpperCase().includes('OFF'));
    const creativesCount = postedLogs.filter(l => (l.postType === 'creative' || (l.status && l.status.toUpperCase().includes('CREATIVE') && !l.status.toUpperCase().includes('FESTIVAL'))) && l.postType !== 'festival').length;
    const reelsCount = postedLogs.filter(l => l.postType === 'reel' || (l.status && l.status.toUpperCase().includes('REEL'))).length;
    const festivalsCount = postedLogs.filter(l => l.postType === 'festival' || (l.status && l.status.toUpperCase().includes('FESTIVAL'))).length;
    const blogsCount = postedLogs.filter(l => l.postType === 'blog' || (l.status && l.status.toUpperCase().includes('BLOG'))).length;

    const qCreatives = Number(project.deliverablesQuota?.creatives) || 0;
    const qReels = Number(project.deliverablesQuota?.aiReels || project.deliverablesQuota?.basicReels) || 0;
    const festivalTarget = project.deliverablesQuota?.festival ? 1 : 0;
    const blogsTarget = Number(project.deliverablesQuota?.blogs || 0);

    const displayCreatives = qCreatives > 0 ? Math.min(creativesCount, qCreatives) : creativesCount;
    const displayReels = qReels > 0 ? Math.min(reelsCount, qReels) : reelsCount;
    const displayFestivals = festivalTarget > 0 ? Math.min(festivalsCount, festivalTarget) : festivalsCount;
    const displayBlogs = blogsTarget > 0 ? Math.min(blogsCount, blogsTarget) : blogsCount;

    project.deliveredCounts = {
      creatives: displayCreatives,
      reels: displayReels,
      festivals: displayFestivals,
      blogs: displayBlogs
    };

    const totalTarget = qCreatives + qReels + festivalTarget + blogsTarget;
    const totalDelivered = displayCreatives + displayReels + displayFestivals + displayBlogs;
    project.progress = totalTarget > 0 ? Math.min(100, Math.round((totalDelivered / totalTarget) * 100)) : 0;

    await project.save();
    broadcastRealtimeUpdate('PROJECT_UPDATED', { project });
    broadcastRealtimeUpdate('PROJECT_LOG_UPDATED', { id, project });
    res.json({ success: true, message: 'Daily deliverable log updated successfully.', data: project });
  } catch (err) {
    next(err);
  }
};

// --- HIGH-SPEED BATCH COMPLETE WEEK HANDLER ---
export const completeProjectWeekHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { weekNum, monthNumber, tasksToComplete } = req.body;
    const loggedByName = req.user?.name || 'Account Manager';

    const project = await Project.findOne(findByIdOrCustomId(id));
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    if (!project.dailyLogs) {
      project.dailyLogs = [];
    }

    const targetProjId = project.customId || project._id.toString();
    const projIds = [id, targetProjId, project._id?.toString(), project.customId].filter(Boolean);

    const todayStr = new Date().toISOString().split('T')[0];
    const incomingTasks = Array.isArray(tasksToComplete) && tasksToComplete.length > 0 ? tasksToComplete : [];

    // 1. Find existing tasks in DB matching IDs or project + week
    const taskIds = incomingTasks.map(t => t.id || t._id || t.customId).filter(Boolean);
    const idQuery = [];
    taskIds.forEach(tid => {
      idQuery.push({ customId: tid });
      idQuery.push({ id: tid });
      if (mongoose.isValidObjectId(tid)) {
        idQuery.push({ _id: tid });
      }
    });

    const targetMonthNum = Number(monthNumber) || 1;
    const targetWeekNum = Number(weekNum) || 1;

    let dbTasks = [];
    if (idQuery.length > 0) {
      dbTasks = await Task.find({
        projectId: { $in: projIds },
        monthNumber: targetMonthNum,
        weekNumber: targetWeekNum,
        $or: idQuery
      });
    }

    const remainingDbTasks = await Task.find({
      projectId: { $in: projIds },
      weekNumber: targetWeekNum,
      monthNumber: targetMonthNum,
      status: { $ne: 'done' }
    });

    const tasksMap = new Map();
    dbTasks.forEach(t => tasksMap.set(t.customId || t._id.toString(), t));
    remainingDbTasks.forEach(t => tasksMap.set(t.customId || t._id.toString(), t));

    const finalTasksToSave = [];
    const teamMemberWorkloadDec = new Map();

    // Process tasks from incoming array or tasksMap
    const processedKeys = new Set();

    for (const inc of incomingTasks) {
      const incId = inc.id || inc._id || inc.customId;
      let matchedTask = null;
      for (const [key, t] of tasksMap.entries()) {
        if (key === incId || t.customId === incId || (t._id && t._id.toString() === incId)) {
          matchedTask = t;
          processedKeys.add(key);
          break;
        }
      }

      if (!matchedTask && inc.name) {
        matchedTask = await Task.findOne({
          projectId: { $in: projIds },
          name: new RegExp(`^${inc.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i'),
          weekNumber: Number(weekNum),
          monthNumber: targetMonthNum
        });
      }

      const compDate = (inc.completedDate || inc.dueDate || todayStr).split('T')[0];
      const isFest = inc.taskType === 'festival' || inc.name?.toLowerCase().includes('festival');
      const isReel = inc.taskType === 'reel' || inc.name?.toLowerCase().includes('reel') || inc.name?.toLowerCase().includes('short');
      const postType = isFest ? 'festival' : (isReel ? 'reel' : (inc.taskType || 'creative'));
      const count = Number(inc.deliveredCount) || 1;
      const creatorName = inc.publishedCreator || inc.assignedTo || (
        isReel
          ? (project.videoEditor || 'Video Editor')
          : (project.graphicDesigner || 'Graphic Designer')
      );

      if (!matchedTask) {
        matchedTask = new Task({
          customId: incId && !incId.startsWith('syn_') ? incId : ('t_' + Math.random().toString(36).substring(2, 9)),
          name: inc.name || 'Deliverable',
          projectId: targetProjId,
          taskType: postType,
          weekNumber: Number(weekNum) || 1,
          monthNumber: Number(monthNumber) || 1,
          dueDate: compDate,
          status: 'done',
          completedDate: compDate,
          deliveredCount: count,
          deliveryLink: inc.deliveryLink || '',
          remarks: inc.remarks || `Week ${weekNum} deliverable completed: ${inc.name || 'Task'}`,
          assignedTo: creatorName,
          publishedCreator: creatorName
        });
      } else {
        const oldStatus = matchedTask.status;
        matchedTask.status = 'done';
        matchedTask.completedDate = compDate;
        matchedTask.publishedCreator = creatorName;
        matchedTask.deliveredCount = count;
        if (inc.deliveryLink) matchedTask.deliveryLink = inc.deliveryLink;
        matchedTask.remarks = inc.remarks || `Week ${weekNum} deliverable completed: ${matchedTask.name}`;

        if (oldStatus !== 'done' && matchedTask.assignedTo) {
          teamMemberWorkloadDec.set(matchedTask.assignedTo, (teamMemberWorkloadDec.get(matchedTask.assignedTo) || 0) + 1);
        }
      }

      finalTasksToSave.push(matchedTask);

      // Add to project.dailyLogs
      const logStatus = isFest ? `${count} FESTIVAL CREATIVE POSTED` : (isReel ? `${count} REEL POSTED` : `${count} CREATIVE POSTED`);
      const taskIdStr = matchedTask.customId || matchedTask._id?.toString() || incId;

      project.dailyLogs = (project.dailyLogs || []).filter(l => {
        if (l.taskId && (l.taskId === taskIdStr || l.taskId === incId)) return false;
        return true;
      });

      project.dailyLogs.push({
        date: compDate,
        dayName: new Date(compDate).toLocaleDateString('en-US', { weekday: 'short' }),
        status: logStatus,
        postType: postType,
        postUrl: matchedTask.deliveryLink || '',
        creator: creatorName,
        taskId: taskIdStr,
        remarks: matchedTask.remarks,
        pendingReason: '',
        loggedBy: loggedByName,
        updatedAt: new Date()
      });
    }

    // Process any remaining db tasks not covered in incoming (ONLY for the target month AND target week)
    for (const [key, t] of tasksMap.entries()) {
      if (processedKeys.has(key)) continue;
      // Skip tasks from other months or other weeks to prevent cross-week / cross-month completion
      const taskMonth = Number(t.monthNumber) || 1;
      const taskWeek = Number(t.weekNumber) || 1;
      if (taskMonth !== targetMonthNum || taskWeek !== targetWeekNum) continue;
      const compDate = (t.dueDate || todayStr).split('T')[0];
      const isFest = t.taskType === 'festival' || t.name?.toLowerCase().includes('festival');
      const isReel = t.taskType === 'reel' || t.name?.toLowerCase().includes('reel') || t.name?.toLowerCase().includes('short');
      const postType = isFest ? 'festival' : (isReel ? 'reel' : (t.taskType || 'creative'));
      const count = Number(t.deliveredCount) || 1;
      const creatorName = t.publishedCreator || t.assignedTo || (
        isReel
          ? (project.videoEditor || 'Video Editor')
          : (project.graphicDesigner || 'Graphic Designer')
      );

      const oldStatus = t.status;
      t.status = 'done';
      t.completedDate = compDate;
      t.publishedCreator = creatorName;
      t.remarks = t.remarks || `Week ${weekNum} deliverable completed: ${t.name}`;
      finalTasksToSave.push(t);

      if (oldStatus !== 'done' && t.assignedTo) {
        teamMemberWorkloadDec.set(t.assignedTo, (teamMemberWorkloadDec.get(t.assignedTo) || 0) + 1);
      }

      const logStatus = isFest ? `${count} FESTIVAL CREATIVE POSTED` : (isReel ? `${count} REEL POSTED` : `${count} CREATIVE POSTED`);
      const taskIdStr = t.customId || t._id.toString();

      project.dailyLogs = (project.dailyLogs || []).filter(l => {
        if (l.taskId && (l.taskId === taskIdStr || l.taskId === t._id?.toString() || l.taskId === t.customId)) return false;
        return true;
      });

      project.dailyLogs.push({
        date: compDate,
        dayName: new Date(compDate).toLocaleDateString('en-US', { weekday: 'short' }),
        status: logStatus,
        postType: postType,
        postUrl: t.deliveryLink || '',
        creator: creatorName,
        taskId: taskIdStr,
        remarks: t.remarks,
        pendingReason: '',
        loggedBy: loggedByName,
        updatedAt: new Date()
      });
    }

    // Save all tasks in parallel
    const savedTasks = await Promise.all(finalTasksToSave.map(t => t.save()));

    // Decrement team workloads
    for (const [memberName, decCount] of teamMemberWorkloadDec.entries()) {
      await TeamMember.findOneAndUpdate(
        { name: memberName },
        { $inc: { workload: -decCount } }
      );
    }

    // Recalculate deliveredCounts and progress on project
    const postedLogs = (project.dailyLogs || []).filter(l => l.status && !l.status.toUpperCase().includes('PENDING') && !l.status.toUpperCase().includes('HOLIDAY') && !l.status.toUpperCase().includes('OFF'));
    const creativesCount = postedLogs.filter(l => (l.postType === 'creative' || (l.status && l.status.toUpperCase().includes('CREATIVE') && !l.status.toUpperCase().includes('FESTIVAL'))) && l.postType !== 'festival').length;
    const reelsCount = postedLogs.filter(l => l.postType === 'reel' || (l.status && l.status.toUpperCase().includes('REEL'))).length;
    const festivalsCount = postedLogs.filter(l => l.postType === 'festival' || (l.status && l.status.toUpperCase().includes('FESTIVAL'))).length;
    const blogsCount = postedLogs.filter(l => l.postType === 'blog' || (l.status && l.status.toUpperCase().includes('BLOG'))).length;

    const qCreatives = Number(project.deliverablesQuota?.creatives) || 0;
    const qReels = Number(project.deliverablesQuota?.aiReels || project.deliverablesQuota?.basicReels) || 0;
    const festivalTarget = project.deliverablesQuota?.festival ? 1 : 0;
    const blogsTarget = Number(project.deliverablesQuota?.blogs || 0);

    const displayCreatives = qCreatives > 0 ? Math.min(creativesCount, qCreatives) : creativesCount;
    const displayReels = qReels > 0 ? Math.min(reelsCount, qReels) : reelsCount;
    const displayFestivals = festivalTarget > 0 ? Math.min(festivalsCount, festivalTarget) : festivalsCount;
    const displayBlogs = blogsTarget > 0 ? Math.min(blogsCount, blogsTarget) : blogsCount;

    project.deliveredCounts = {
      creatives: displayCreatives,
      reels: displayReels,
      festivals: displayFestivals,
      blogs: displayBlogs
    };

    const totalTarget = qCreatives + qReels + festivalTarget + blogsTarget;
    const totalDelivered = displayCreatives + displayReels + displayFestivals + displayBlogs;
    project.progress = totalTarget > 0 ? Math.min(100, Math.round((totalDelivered / totalTarget) * 100)) : 0;

    await project.save();

    // Broadcast realtime updates
    broadcastRealtimeUpdate('PROJECT_UPDATED', { project });
    broadcastRealtimeUpdate('PROJECT_LOG_UPDATED', { id, project });
    savedTasks.forEach(t => broadcastRealtimeUpdate('TASK_UPDATED', { task: t }));

    return res.json({
      success: true,
      message: `Week ${weekNum} marked as completed (${savedTasks.length} deliverables).`,
      data: { project, tasks: savedTasks }
    });
  } catch (err) {
    console.error('Error in completeProjectWeekHandler:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to complete project week' });
  }
};

export const seedAgencyDataHandler = async (req, res, next) => {
  try {
    const { seedLiveAgencyData } = await import('../utils/seedLiveAgencyData.js');
    const result = await seedLiveAgencyData();
    res.json({ success: true, message: 'Successfully seeded live agency dataset from Excel.', data: result });
  } catch (err) {
    next(err);
  }
};

export const clearWorkspaceDataHandler = async (req, res, next) => {
  try {
    // Delete all projects, tasks, deliverables, milestones, and notifications from database
    await Project.deleteMany({});
    await Task.deleteMany({});
    await Milestone.deleteMany({});
    await Notification.deleteMany({});

    res.json({
      success: true,
      message: 'All workspace projects, tasks, deliverables, and milestones have been permanently deleted from the database.'
    });
  } catch (err) {
    next(err);
  }
};

export const syncProjectTasksHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tasks } = req.body;

    const project = await Project.findOne(findByIdOrCustomId(id));
    const projectIds = [id];
    if (project) {
      if (project._id) projectIds.push(project._id.toString());
      if (project.customId) projectIds.push(project.customId);
    }

    // Find existing completed tasks to preserve their status & delivery info
    const existingTasks = await Task.find({ projectId: { $in: projectIds } });
    const existingMap = new Map();
    existingTasks.forEach(t => {
      if (t.customId) existingMap.set(t.customId, t);
      if (t._id) existingMap.set(t._id.toString(), t);
      const m = t.monthNumber || 1;
      const w = t.weekNumber || 1;
      const cleanName = (t.name || '').toLowerCase().trim();
      existingMap.set(`m${m}_w${w}_${cleanName}`, t);
    });

    // Wipe stale deliverable tasks for this project, STRICTLY preserving:
    // 1. Service tasks (website stages, SEO tasks, product shoot, meta ads)
    // 2. Any completed tasks (status === 'done')
    // 3. Any tasks with deliveryLink or publishUrl
    const serviceTypes = [
      'web_design', 'web_development', 'content_upload', 'website_qa', 'deployment', 'backend_development',
      'seo_audit', 'seo_onpage', 'seo_technical', 'seo_backlinks', 'seo_reporting',
      'service', 'website', 'seo', 'product_shoot', 'meta_ads'
    ];
    await Task.deleteMany({
      projectId: { $in: projectIds },
      taskType: { $nin: serviceTypes },
      status: { $ne: 'done' },
      $and: [
        { $or: [{ deliveryLink: '' }, { deliveryLink: null }, { deliveryLink: { $exists: false } }] },
        { $or: [{ publishUrl: '' }, { publishUrl: null }, { publishUrl: { $exists: false } }] }
      ]
    });

    let createdTasks = [];
    if (Array.isArray(tasks) && tasks.length > 0) {
      const pId = project ? (project.customId || project._id.toString() || id) : id;
      const projStart = normalizeYMD(project?.handoverDate || project?.startDate || project?.taskStartDate || '');
      const todayStr = new Date().toISOString().split('T')[0];

      // Compute project renewal cutoff
      const candidates = [];
      if (project?.nextRenewalDate) {
        const norm = normalizeYMD(project.nextRenewalDate);
        if (norm && norm !== projStart) candidates.push(norm);
      }
      if (Array.isArray(project?.salesContracts)) {
        project.salesContracts.forEach(sc => {
          const norm = normalizeYMD(sc.renewalDate || sc.nextRenewalDate);
          if (norm && norm !== projStart) candidates.push(norm);
        });
      }
      if (Array.isArray(project?.connectedPlans)) {
        project.connectedPlans.forEach(cp => {
          const norm = normalizeYMD(cp.renewalDate || cp.nextRenewalDate);
          if (norm && norm !== projStart) candidates.push(norm);
        });
      }
      if (project?.renewalDate) {
        const norm = normalizeYMD(project.renewalDate);
        if (norm && norm !== projStart) candidates.push(norm);
      }
      const validCandidates = candidates.filter(Boolean).sort().reverse();
      const cutoffDateStr = validCandidates.length > 0 ? validCandidates[0] : null;
      const renewalStatusLower = String(project?.renewalStatus || '').toLowerCase();
      const isActivelyRenewed = ['renewed', 'yes', 'active'].includes(renewalStatusLower) && (!cutoffDateStr || cutoffDateStr >= todayStr);

      const uniqueTasksMap = new Map();
      tasks.forEach(t => {
        const m = typeof t.monthNumber === 'number' ? t.monthNumber : (t.monthNumber ? parseInt(t.monthNumber, 10) : 1);
        const w = typeof t.weekNumber === 'number' ? t.weekNumber : 1;
        const cleanName = (t.name || '').toLowerCase().trim();
        const key = `m${m}_w${w}_${cleanName}`;
        if (!uniqueTasksMap.has(key)) {
          uniqueTasksMap.set(key, t);
        }
      });
      const uniqueTasks = Array.from(uniqueTasksMap.values()).filter(t => {
        const due = normalizeYMD(t.dueDate || '');
        if (!isActivelyRenewed && cutoffDateStr && due && due > cutoffDateStr && t.status !== 'done') {
          return false;
        }
        return true;
      });

      const seenCustomIds = new Set();
      const tasksToInsert = uniqueTasks.map(t => {
        let customId = t.id || t.customId || 't_' + Math.random().toString(36).substring(2, 9);
        if (seenCustomIds.has(customId)) {
          customId = customId + '_' + Math.random().toString(36).substring(2, 7);
        }
        seenCustomIds.add(customId);

        const m = typeof t.monthNumber === 'number' ? t.monthNumber : (t.monthNumber ? parseInt(t.monthNumber, 10) : 1);
        const w = typeof t.weekNumber === 'number' ? t.weekNumber : 1;
        const cleanName = (t.name || '').toLowerCase().trim();
        const existing = existingMap.get(customId) || existingMap.get(`m${m}_w${w}_${cleanName}`);
        
        let cleanDueDate = normalizeYMD(t.dueDate || existing?.dueDate || '');
        const finalStatus = (t.status === 'done' || existing?.status === 'done') ? 'done' : (t.status || existing?.status || 'todo');
        if (m === 1 && projStart && cleanDueDate && cleanDueDate < projStart && finalStatus !== 'done') {
          cleanDueDate = projStart;
        }
        return {
          customId: customId,
          name: t.name,
          projectId: t.projectId || pId,
          taskType: t.taskType || existing?.taskType || 'creative',
          weekNumber: typeof t.weekNumber === 'number' ? t.weekNumber : (existing?.weekNumber || 1),
          monthNumber: typeof t.monthNumber === 'number' ? t.monthNumber : (t.monthNumber ? parseInt(t.monthNumber, 10) : (existing?.monthNumber || 1)),
          assignedToId: t.assignedToId || existing?.assignedToId || '',
          assignedTo: t.assignedTo || existing?.assignedTo || ((t.taskType === 'reel' || (t.name || '').toLowerCase().includes('reel') || (t.name || '').toLowerCase().includes('short')) ? (project?.videoEditor || project?.graphicDesigner || '') : (project?.graphicDesigner || '')),
          assignedBy: t.assignedBy || existing?.assignedBy || req.user?.name || project?.accountManager || '',
          accountManager: t.accountManager || existing?.accountManager || project?.accountManager || '',
          description: t.description || existing?.description || '',
          priority: t.priority || existing?.priority || 'medium',
          dueDate: cleanDueDate,
          completedDate: t.completedDate || existing?.completedDate || (finalStatus === 'done' ? (cleanDueDate || todayStr) : ''),
          deliveredCount: typeof t.deliveredCount === 'number' ? t.deliveredCount : (existing?.deliveredCount || 1),
          deliveryLink: t.deliveryLink || existing?.deliveryLink || '',
          remarks: t.remarks || existing?.remarks || '',
          delayReason: t.delayReason || existing?.delayReason || '',
          isDelayed: Boolean(t.isDelayed && cleanDueDate < todayStr && finalStatus !== 'done'),
          status: finalStatus
        };
      });

      try {
        createdTasks = await Task.insertMany(tasksToInsert, { ordered: false });
      } catch (insertErr) {
        if (insertErr.code === 11000 || insertErr.name === 'MongoBulkWriteError') {
          createdTasks = await Task.find({ projectId: { $in: projectIds } });
        } else {
          throw insertErr;
        }
      }

      if (cutoffDateStr && !isActivelyRenewed) {
        try {
          await Task.deleteMany({
            projectId: { $in: projectIds },
            dueDate: { $gt: cutoffDateStr },
            status: { $ne: 'done' }
          });
        } catch (purgeErr) {
          console.warn('[SyncTasks] Purge warning:', purgeErr.message);
        }
      }
    }

    try {
      await realignDeliverableDatesForProject(pId || id);
    } catch (realignmentErr) {
      console.warn('[SyncTasks] Realignment warning:', realignmentErr.message);
    }

    const allProjectTasks = await Task.find({ projectId: { $in: projectIds } });
    broadcastRealtimeUpdate('PROJECT_TASKS_SYNCED', { id, tasks: allProjectTasks });
    res.json({
      success: true,
      message: `Successfully synchronized ${allProjectTasks.length} tasks for project.`,
      data: allProjectTasks
    });
  } catch (err) {
    if (err.code === 11000) {
      const fallbackTasks = await Task.find({ projectId: { $in: projectIds } });
      return res.json({
        success: true,
        message: 'Successfully synchronized tasks.',
        data: fallbackTasks
      });
    }
    next(err);
  }
};

export const resyncAllDeliverablesHandler = async (req, res, next) => {
  try {
    const { projectId } = req.body || {};
    let targetProjects = [];
    if (projectId && projectId !== 'all') {
      const p = await Project.findOne(findByIdOrCustomId(projectId));
      if (p) targetProjects.push(p);
    } else {
      targetProjects = await Project.find({ status: { $ne: 'cancelled' } });
    }

    let totalTasksUpdated = 0;
    for (const proj of targetProjects) {
      const generated = await generateDeliverablesForProjectBackend(proj, true);
      totalTasksUpdated += (generated?.length || 0);

      // Heal any unassigned tasks for this project
      const projIds = [proj.customId, proj._id.toString()].filter(Boolean);
      const gd = (proj.graphicDesigner && proj.graphicDesigner !== 'Unassigned') ? proj.graphicDesigner : 'yash';
      const ve = (proj.videoEditor && proj.videoEditor !== 'Unassigned') ? proj.videoEditor : 'ayush';

      await Task.updateMany(
        {
          projectId: { $in: projIds },
          taskType: { $in: ['creative', 'festival', 'carousel'] },
          $or: [{ assignedTo: '' }, { assignedTo: null }, { assignedTo: 'Unassigned' }, { assignedTo: { $exists: false } }]
        },
        { $set: { assignedTo: gd } }
      );

      await Task.updateMany(
        {
          projectId: { $in: projIds },
          taskType: 'reel',
          $or: [{ assignedTo: '' }, { assignedTo: null }, { assignedTo: 'Unassigned' }, { assignedTo: { $exists: false } }]
        },
        { $set: { assignedTo: ve } }
      );
    }

    // Clean up any orphaned tasks with nonexistent projects
    const allActiveProjs = await Project.find({}).lean();
    const validIds = new Set();
    allActiveProjs.forEach(p => {
      if (p.customId) validIds.add(p.customId);
      if (p._id) validIds.add(p._id.toString());
    });
    await Task.deleteMany({ projectId: { $nin: Array.from(validIds) } });
    await Task.deleteMany({ taskType: { $nin: ['creative', 'reel', 'festival', 'carousel'] } });

    const allTasks = await Task.find({}).lean();
    broadcastRealtimeUpdate('PROJECT_TASKS_SYNCED', { all: true, count: totalTasksUpdated });

    res.json({
      success: true,
      message: `Successfully recalculated & corrected deliverables schedule for ${targetProjects.length} project(s).`,
      count: totalTasksUpdated,
      tasks: allTasks
    });
  } catch (err) {
    next(err);
  }
};

export const realignDeliverableDatesHandler = async (req, res, next) => {
  try {
    const projectId = req.params?.id || req.body?.projectId;
    const { weekNumber, resetAll } = req.body || {};
    if (projectId && projectId !== 'all') {
      const result = await realignDeliverableDatesForProject(projectId, { weekNumber, resetAll });
      const allTasks = await Task.find({}).lean();
      broadcastRealtimeUpdate('PROJECT_TASKS_SYNCED', { id: projectId, healed: true });
      return res.json({
        success: true,
        message: `Realigned ${result.fixedCount} task(s) for project.`,
        data: result,
        tasks: allTasks
      });
    }

    const result = await realignAllProjectsDeliverables();
    const allTasks = await Task.find({}).lean();
    broadcastRealtimeUpdate('PROJECT_TASKS_SYNCED', { all: true, healed: true, count: result.totalFixed });
    return res.json({
      success: true,
      message: `Realigned ${result.totalFixed} task(s) across ${result.affectedProjects?.length || 0} project(s).`,
      data: result,
      tasks: allTasks
    });
  } catch (err) {
    next(err);
  }
};

export const deduplicateProjectTasksHandler = async (req, res, next) => {
  try {
    const projectId = req.params?.id || req.body?.projectId;
    if (projectId && projectId !== 'all') {
      const result = await deduplicateProjectTasksInDb(projectId);
      const allTasks = await Task.find({}).lean();
      broadcastRealtimeUpdate('PROJECT_TASKS_SYNCED', { id: projectId, deduplicated: true, removedCount: result.removedCount });
      return res.json({
        success: true,
        message: `Removed ${result.removedCount} duplicate task(s) for project.`,
        data: result,
        tasks: allTasks
      });
    }

    const result = await deduplicateAllProjectsTasksInDb();
    const allTasks = await Task.find({}).lean();
    broadcastRealtimeUpdate('PROJECT_TASKS_SYNCED', { all: true, deduplicated: true, count: result.totalRemoved });
    return res.json({
      success: true,
      message: `Removed ${result.totalRemoved} duplicate task(s) across ${result.affectedProjects?.length || 0} project(s).`,
      data: result,
      tasks: allTasks
    });
  } catch (err) {
    next(err);
  }
};

export const pruneOverdueTasksHandler = async (req, res, next) => {
  try {
    const projectId = req.params?.id || req.body?.projectId;
    if (projectId && projectId !== 'all') {
      const result = await pruneTasksPastRenewalForProject(projectId);
      const allTasks = await Task.find({}).lean();
      broadcastRealtimeUpdate('PROJECT_TASKS_SYNCED', { id: projectId, pruned: true, count: result.prunedCount });
      return res.json({
        success: true,
        message: result.message || `Pruned ${result.prunedCount} task(s) past renewal for project.`,
        data: result,
        tasks: allTasks
      });
    }

    const result = await pruneAllProjectsTasksPastRenewal();
    const allTasks = await Task.find({}).lean();
    broadcastRealtimeUpdate('PROJECT_TASKS_SYNCED', { all: true, pruned: true, count: result.totalPruned });
    return res.json({
      success: true,
      message: `Pruned ${result.totalPruned} task(s) past renewal across ${result.affectedProjects?.length || 0} project(s).`,
      data: result,
      tasks: allTasks
    });
  } catch (err) {
    next(err);
  }
};

