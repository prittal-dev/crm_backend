import mongoose from 'mongoose';
import { Task } from '../models/Task.js';
import { Project } from '../models/Project.js';
import { User } from '../models/User.js';
import { FESTIVALS_AND_HOLIDAYS } from './festivalConstants.js';
import { realignDeliverableDatesForProject, deduplicateProjectTasksInDb } from './deliverableHealer.js';
import { generateServiceProjectTasks, getProjectServiceProfile } from './serviceProjectUtils.js';

export const generateDeliverablesForProjectBackend = async (projectOrId, forceRegen = false, baseStartDate = null) => {
  try {
    let project = projectOrId;
    if (typeof projectOrId === 'string' || (projectOrId && (!projectOrId.name || !projectOrId.customId))) {
      const searchId = projectOrId?._id || projectOrId;
      project = await Project.findOne({
        $or: [
          ...(mongoose.isValidObjectId(searchId) ? [{ _id: searchId }] : []),
          { customId: String(searchId) }
        ]
      });
    }
    if (!project) return [];

    const projId = project.customId || project._id.toString();
    const projIds = [projId];
    if (project._id) projIds.push(project._id.toString());
    if (project.customId) projIds.push(project.customId);

    const serviceProfile = getProjectServiceProfile(project);

    // Strictly enforce: Only creative, reel, and festival tasks are created/maintained on the task board.
    // Purge any legacy or service tasks (ad_setup, ad_creative, photography, web_design, etc.)
    await Task.deleteMany({
      projectId: { $in: projIds },
      taskType: { $nin: ['creative', 'reel', 'festival', 'carousel'] }
    });

    // If project has ONLY non-social service(s) (e.g. Website only, SEO only), do not generate social creatives/reels
    if (serviceProfile.isServiceOnly || !serviceProfile.hasSocial) {
      return await Task.find({ projectId: { $in: projIds }, taskType: { $in: ['creative', 'reel', 'festival', 'carousel'] } });
    }

    // Helper to infer standard quotas from plan name if not explicit
    const inferQuotasFromPlan = (planName) => {
      const norm = String(planName || '').toLowerCase();
      if (!serviceProfile.hasSocial && (norm.includes('website') || norm.includes('web'))) {
        return { creatives: 0, aiReels: 0, carousels: 0, festival: false };
      }
      if (norm.includes('premium')) {
        return { creatives: 24, aiReels: 24, carousels: 4, festival: true };
      }
      if (norm.includes('standard')) {
        return { creatives: 8, aiReels: 4, carousels: 2, festival: true };
      }
      if (norm.includes('basic') || norm.includes('starter')) {
        return { creatives: 4, aiReels: 4, carousels: 0, festival: true };
      }
      return { creatives: 8, aiReels: 4, carousels: 0, festival: true };
    };

    // 2. Resolve Quotas with custom plan parsing
    const remarksText = `${project.finalRemarks || ''} ${project.soldPlanName || ''} ${project.name || ''} ${(project.services || []).join(' ')}`.toLowerCase();
    const planDefaults = inferQuotasFromPlan(project.soldPlanName || project.planSnapshot?.name || project.name);

    let parsedCreatives = null;
    let parsedReels = null;
    let parsedCarousels = null;
    let parsedFestival = null;

    // 1. Check for explicit weekly posts or activity specifications:
    // e.g. "WEEKLY 2. ACTIVITY. ( 1. POST + 1 REEL)", "1 post + 1 reel", "1 post per week", "Creative Posts Per Week (2)"
    const weeklyPostMatch = remarksText.match(/weekly[^\d]*activity[^\d]*\(?\s*(\d+)\.?\s*(?:post|creative)/i) ||
                            remarksText.match(/(?:weekly[^\d]*)?\(?\s*(\d+)\.?\s*(?:post|creative)[^\d]*\+[^\d]*\d+\.?\s*(?:reel|video)/i) ||
                            remarksText.match(/creative(?:\s*posts?)?\s*(?:per\s*week|\/\s*week|\/\s*wk)[^\d]*\(?(\d+)\)?/i) ||
                            remarksText.match(/\(?(\d+)\)?\s*creative(?:\s*posts?)?\s*(?:per\s*week|\/\s*week|\/\s*wk)/i) ||
                            remarksText.match(/(?:^|[^\w])(\d+)\.?\s*(?:post|creative)\s*(?:per\s*week|\/\s*week|\/\s*wk)/i);
    if (weeklyPostMatch) {
      const perWeek = parseInt(weeklyPostMatch[1], 10);
      if (!isNaN(perWeek) && perWeek > 0) {
        parsedCreatives = perWeek * 4;
      }
    } else {
      // Check for yearly specification first e.g. "48 Creative Graphics/yr", "48 Creative Graphics per year"
      const yearlyCreativeMatch = remarksText.match(/(\d+)\s*(?:creative(?:\s*graphics?)?|graphics?)(?!\s*ads?)(?:\s*posts?)?[^\n,]*(?:\/\s*yr|\/\s*year|per\s*year|annually|\/\s*annum|per\s*annum)/i);
      if (yearlyCreativeMatch) {
        const perYear = parseInt(yearlyCreativeMatch[1], 10);
        if (!isNaN(perYear) && perYear > 0) parsedCreatives = Math.max(1, Math.round(perYear / 12));
      } else {
        // Exclude paid ads like "3 creative ad" or "creative ads" from organic monthly creatives
        const monthlyCreativeMatch = remarksText.match(/(\d+)\s*(?:creative(?:\s*graphics?)?|graphics?)(?!\s*ads?)(?:\s*posts?)?(?:\s*per\s*month|\/\s*month|\/\s*mo)?/i);
        if (monthlyCreativeMatch) {
          let perMonth = parseInt(monthlyCreativeMatch[1], 10);
          if (!isNaN(perMonth) && perMonth > 0) {
            if (perMonth >= 24 && (remarksText.includes('annual') || remarksText.includes('/yr') || remarksText.includes('year') || String(project.planDuration || '').toUpperCase().includes('ANNUAL'))) {
              perMonth = Math.max(1, Math.round(perMonth / 12));
            }
            parsedCreatives = perMonth;
          }
        }
      }
    }

    const weeklyReelMatch = remarksText.match(/(?:weekly[^\d]*)?\(?\s*\d+\.?\s*(?:post|creative)[^\d]*\+[^\d]*(\d+)\.?\s*(?:reel|video)/i) ||
                            remarksText.match(/(?:ai\s*|engagement\s*|basic\s*)?reels?\s*(?:per\s*week|\/\s*week|\/\s*wk)[^\d]*\(?(\d+)\)?/i) ||
                            remarksText.match(/\(?(\d+)\)?\s*(?:ai\s*|engagement\s*|basic\s*)?reels?\s*(?:per\s*week|\/\s*week|\/\s*wk)/i) ||
                            remarksText.match(/(?:^|[^\w])(\d+)\.?\s*reels?\s*(?:per\s*week|\/\s*week|\/\s*wk)/i);
    if (weeklyReelMatch) {
      const num = parseInt(weeklyReelMatch[1], 10);
      if (!isNaN(num) && num > 0) {
        parsedReels = num * 4;
      }
    } else {
      const yearlyReelMatch = remarksText.match(/(\d+)\s*(?:ai\s*|engagement\s*|basic\s*)?reels?[^\n,]*(?:\/\s*yr|\/\s*year|per\s*year|annually|\/\s*annum|per\s*annum)/i);
      if (yearlyReelMatch) {
        const perYear = parseInt(yearlyReelMatch[1], 10);
        if (!isNaN(perYear) && perYear > 0) parsedReels = Math.max(1, Math.round(perYear / 12));
      } else {
        const monthlyReelMatch = remarksText.match(/(\d+)\s*(?:ai\s*|engagement\s*|basic\s*)?reels?(?:\s*per\s*month|\/\s*month|\/\s*mo)?/i);
        if (monthlyReelMatch) {
          let perMonth = parseInt(monthlyReelMatch[1], 10);
          if (!isNaN(perMonth) && perMonth > 0) {
            if (perMonth >= 24 && (remarksText.includes('annual') || remarksText.includes('/yr') || remarksText.includes('year') || String(project.planDuration || '').toUpperCase().includes('ANNUAL'))) {
              perMonth = Math.max(1, Math.round(perMonth / 12));
            }
            parsedReels = perMonth;
          }
        }
      }
    }

    if (remarksText.includes('basic') || remarksText.includes('starter')) {
      if (parsedCreatives === null) parsedCreatives = 4;
      if (parsedReels === null) parsedReels = 4;
    }

    const yearlyCarouselMatch = remarksText.match(/(\d+)\s*carousels?[^\n,]*(?:\/\s*yr|\/\s*year|per\s*year|annually|\/\s*annum|per\s*annum)/i) ||
                                remarksText.match(/carousel[^\d]*\(?(\d+)\)?[^\n,]*(?:\/\s*yr|\/\s*year|per\s*year|annually|\/\s*annum|per\s*annum)/i);
    if (yearlyCarouselMatch) {
      const perYear = parseInt(yearlyCarouselMatch[1], 10);
      if (!isNaN(perYear) && perYear > 0) parsedCarousels = Math.max(1, Math.round(perYear / 12));
    } else {
      const carouselMatch = remarksText.match(/carousel[^\d]*\(?(\d+)\)?/i);
      if (carouselMatch) {
        let num = parseInt(carouselMatch[1], 10);
        if (!isNaN(num) && num > 0) {
          if (num >= 24 && (remarksText.includes('annual') || remarksText.includes('/yr') || remarksText.includes('year'))) {
            num = Math.max(1, Math.round(num / 12));
          }
          parsedCarousels = num;
        }
      }
    }

    if (remarksText.includes('festival') || remarksText.includes('occasion')) {
      parsedFestival = true;
    }

    const deliverablesQuota = project.deliverablesQuota || {};
    let totalCreatives = Number(
      parsedCreatives ??
      deliverablesQuota.creatives ?? 
      project.planSnapshot?.deliverablesQuota?.creatives ?? 
      project.content?.creatives ?? 
      planDefaults.creatives
    );
    let totalReels = Number(
      parsedReels ??
      (deliverablesQuota.aiReels ?? project.planSnapshot?.deliverablesQuota?.aiReels ?? project.content?.aiVideos ?? 0) +
      (deliverablesQuota.basicReels ?? project.planSnapshot?.deliverablesQuota?.basicReels ?? project.content?.shorts ?? (deliverablesQuota.aiReels === undefined ? planDefaults.aiReels : 0))
    );
    let totalCarousels = Number(
      parsedCarousels ??
      deliverablesQuota.carousels ?? 
      project.planSnapshot?.deliverablesQuota?.carousels ?? 
      project.content?.carousels ?? 
      planDefaults.carousels
    );

    // Balanced deliverables safety check:
    // If weekly activity is specified (e.g. "weekly 2 activity", "1 post + 1 reel", or plan has >= 4 reels),
    // ensure creatives is at least 4 (1 creative each week) so that no week in a 4-week month is left with 0 creatives.
    const hasWeeklySchedule = remarksText.includes('weekly 2') || remarksText.includes('1. post') || remarksText.includes('1 post') || (totalReels >= 4 && totalCreatives === 3);
    if (hasWeeklySchedule && !remarksText.match(/0\s*creatives?/i)) {
      totalCreatives = Math.max(4, totalCreatives);
    }
    if (totalReels === 0 && planDefaults.aiReels > 0 && (remarksText.includes('basic') || remarksText.includes('standard') || remarksText.includes('premium'))) {
      totalReels = planDefaults.aiReels;
    }

    const hasFestival = !serviceProfile.isServiceOnly && (
      parsedFestival !== null
        ? parsedFestival
        : (deliverablesQuota.festival !== undefined && deliverablesQuota.festival !== null
            ? Boolean(deliverablesQuota.festival)
            : (project.planSnapshot?.deliverablesQuota?.festival !== undefined
                ? Boolean(project.planSnapshot.deliverablesQuota.festival)
                : (project.content?.festivalContent !== undefined 
                    ? Number(project.content.festivalContent) > 0 
                    : planDefaults.festival)))
    );

    // Synchronize resolved quota to project document if changed
    if (project._id && (deliverablesQuota.creatives !== totalCreatives || deliverablesQuota.aiReels !== totalReels)) {
      try {
        await Project.updateOne(
          { _id: project._id },
          {
            $set: {
              'deliverablesQuota.creatives': totalCreatives,
              'deliverablesQuota.aiReels': totalReels,
              'deliverablesQuota.carousels': totalCarousels,
              'deliverablesQuota.festival': hasFestival,
              'content.creatives': totalCreatives,
              'content.shorts': totalReels,
              'content.aiVideos': totalReels,
              'content.carousels': totalCarousels,
              'content.festivalContent': hasFestival ? 1 : 0
            }
          }
        );
      } catch (syncErr) {
        console.warn('[TaskGenerator] Could not sync quota to project:', syncErr.message);
      }
    }

    if (totalCreatives === 0 && totalReels === 0 && totalCarousels === 0 && !hasFestival) {
      return await Task.find({ projectId: { $in: projIds } });
    }

    const rawDate = baseStartDate || project.handoverDate || project.startDate || project.createdAt || new Date();
    let startDateObj = new Date();
    const str = String(rawDate).trim();
    const dmyMatch = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    const ymdMatch = str.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
    if (dmyMatch) {
      const p1 = parseInt(dmyMatch[1], 10);
      const p2 = parseInt(dmyMatch[2], 10);
      let day = p1;
      let month = p2 - 1;
      if (p1 <= 12 && p2 > 12) {
        month = p1 - 1;
        day = p2;
      }
      const year = parseInt(dmyMatch[3], 10);
      startDateObj = new Date(year, month, day, 12, 0, 0);
    } else if (ymdMatch) {
      startDateObj = new Date(parseInt(ymdMatch[1], 10), parseInt(ymdMatch[2], 10) - 1, parseInt(ymdMatch[3], 10), 12, 0, 0);
    } else {
      startDateObj = new Date(rawDate);
    }
    if (isNaN(startDateObj.getTime())) {
      startDateObj = new Date();
      startDateObj.setHours(12, 0, 0, 0);
    }
    const baseHandover = `${startDateObj.getFullYear()}-${String(startDateObj.getMonth() + 1).padStart(2, '0')}-${String(startDateObj.getDate()).padStart(2, '0')}`;

    const cleanMember = (val) => (val && String(val).toLowerCase() !== 'unassigned' && String(val).trim() !== '') ? String(val).trim() : '';

    const responsibilityOwners = new Map();
    for (const assignment of (project.teamAssignments || [])) {
      for (const responsibility of (assignment.responsibleFor || [])) {
        if (assignment.userName && !responsibilityOwners.has(responsibility)) {
          responsibilityOwners.set(responsibility, {
            name: cleanMember(assignment.userName),
            id: assignment.userId || '',
            description: String(assignment.taskDescription || '').trim()
          });
        }
      }
    }

    let assignedDesigner = responsibilityOwners.get('creative')?.name || responsibilityOwners.get('carousel')?.name || cleanMember(project.graphicDesigner) || (project.assignedMembers || []).map(cleanMember).find(Boolean) || '';
    let assignedEditor = responsibilityOwners.get('reel')?.name || cleanMember(project.videoEditor) || (project.assignedMembers || []).map(cleanMember).filter(Boolean)[1] || '';
    let assignedCreativeCreator = responsibilityOwners.get('creative')?.name || assignedDesigner;
    let assignedCarouselCreator = responsibilityOwners.get('carousel')?.name || assignedDesigner;
    let assignedFestivalCreator = responsibilityOwners.get('festival')?.name || assignedDesigner;
    let acctMgr = cleanMember(project.accountManager) || '';
    const brand = project.brandName || project.companyName || project.name || 'Project';

    // 1. If project has unassigned designer/editor, look up existing sibling projects for the same client or company
    if (!assignedDesigner || !assignedEditor) {
      try {
        const sibling = await Project.findOne({
          _id: { $ne: project._id },
          $or: [
            ...(project.clientId ? [{ clientId: project.clientId }] : []),
            ...(project.companyName ? [{ companyName: new RegExp(`^${project.companyName.trim()}$`, 'i') }] : []),
            ...(project.brandName ? [{ brandName: new RegExp(`^${project.brandName.trim()}$`, 'i') }] : [])
          ],
          graphicDesigner: { $exists: true, $nin: ['', 'Unassigned', null] }
        }).lean();
        if (sibling) {
          if (!assignedDesigner && cleanMember(sibling.graphicDesigner)) assignedDesigner = cleanMember(sibling.graphicDesigner);
          if (!assignedEditor && cleanMember(sibling.videoEditor)) assignedEditor = cleanMember(sibling.videoEditor);
          if (!acctMgr && cleanMember(sibling.accountManager)) acctMgr = cleanMember(sibling.accountManager);
        }
      } catch (err) {
        console.warn('Error checking sibling project for team assignments:', err);
      }
    }

    // 2. Default fallback if completely unassigned, so tasks are NEVER created unassigned
    if (!assignedDesigner) assignedDesigner = 'yash';
    if (!assignedEditor) assignedEditor = 'ayush';
    if (!acctMgr) acctMgr = 'tushar';
    assignedCreativeCreator = assignedCreativeCreator || assignedDesigner;
    assignedCarouselCreator = assignedCarouselCreator || assignedDesigner;
    assignedFestivalCreator = assignedFestivalCreator || assignedDesigner;

    // Auto-heal project document if it was unassigned (only if NOT awaiting admin assignment)
    const isAwaitingAdmin = project.handoffStatus === 'Awaiting Admin Assignment' || (!project.assignedAmId && (!project.accountManager || project.accountManager.toLowerCase() === 'unassigned'));
    if (!isAwaitingAdmin && (!cleanMember(project.graphicDesigner) || !cleanMember(project.videoEditor)) && project._id) {
      try {
        await Project.updateOne(
          { _id: project._id },
          {
            $set: {
              graphicDesigner: assignedDesigner,
              videoEditor: assignedEditor,
              assignedMembers: Array.from(new Set([assignedDesigner, assignedEditor].filter(Boolean)))
            }
          }
        );
      } catch (err) {
        console.warn('Could not auto-heal project team members:', err);
      }
    }

    // Lookup user IDs for assignedDesigner and assignedEditor
    let designerId = responsibilityOwners.get('creative')?.id || responsibilityOwners.get('carousel')?.id || '';
    let editorId = responsibilityOwners.get('reel')?.id || '';
    let creativeCreatorId = responsibilityOwners.get('creative')?.id || designerId;
    let carouselCreatorId = responsibilityOwners.get('carousel')?.id || designerId;
    let festivalCreatorId = responsibilityOwners.get('festival')?.id || designerId;
    try {
      const dbUsers = await User.find({}).lean();
      const findUserId = (targetName) => {
        if (!targetName) return '';
        const tLower = targetName.toLowerCase().trim();
        const tClean = tLower.replace(/\s*\(.*?\)/g, '').trim();
        const matched = dbUsers.find(u => {
          const uUsername = (u.username || '').toLowerCase().trim();
          const uName = (u.name || '').toLowerCase().trim();
          const uClean = uName.replace(/\s*\(.*?\)/g, '').trim();
          return uUsername === tLower || uName === tLower || uClean === tClean || uUsername === tClean || uClean.includes(tClean) || tClean.includes(uClean);
        });
        return matched ? (matched.customId || matched._id.toString()) : '';
      };
      designerId = designerId || findUserId(assignedDesigner);
      editorId = editorId || findUserId(assignedEditor);
      creativeCreatorId = creativeCreatorId || findUserId(assignedCreativeCreator);
      carouselCreatorId = carouselCreatorId || findUserId(assignedCarouselCreator);
      festivalCreatorId = festivalCreatorId || findUserId(assignedFestivalCreator);
    } catch (e) {
      console.warn('Error looking up users for taskGenerator:', e);
    }

    // Distribution across 4 weeks
    const getDistribution = (total, weeks = 4) => {
      if (total <= 0) return [0, 0, 0, 0];
      const base = Math.floor(total / weeks);
      const remainder = total % weeks;
      const res = [];
      for (let i = 0; i < weeks; i++) {
        res.push(base + (i < remainder ? 1 : 0));
      }
      return res;
    };

    const creativesDistribution = getDistribution(totalCreatives);
    const reelsDistribution = getDistribution(totalReels);
    const carouselsDistribution = getDistribution(totalCarousels);

    // Auto-deduplicate existing tasks in the database first
    await deduplicateProjectTasksInDb(project);

    // Fetch existing tasks
    const existingTasks = await Task.find({ projectId: { $in: projIds } });

    // When explicitly regenerating deliverables (such as upon manual reset), delete uncompleted / stale tasks
    // while strictly preserving all completed deliverables with existing delivery links
    if (forceRegen && existingTasks.length > 0) {
      await Task.deleteMany({
        projectId: { $in: projIds },
        status: { $ne: 'done' },
        $or: [
          { deliveryLink: '' },
          { deliveryLink: null },
          { deliveryLink: { $exists: false } }
        ]
      });
    }

    const remainingTasks = await Task.find({ projectId: { $in: projIds } });
    const existingMap = new Map();
    remainingTasks.forEach(t => {
      const m = t.monthNumber || 1;
      const w = t.weekNumber || 1;
      const cleanName = (t.name || '').toLowerCase().trim();
      existingMap.set(`m${m}_w${w}_${cleanName}`, t);

      // Index by slot type and index to prevent duplicate generation when brand name changes
      const rawName = t.name || '';
      const numMatch = rawName.match(/#(\d+)/);
      const slotNum = numMatch ? numMatch[1] : '1';
      let type = t.taskType || '';
      if (!type || type === 'creative') {
        if (cleanName.includes('reel') || cleanName.includes('short')) type = 'reel';
        else if (cleanName.includes('carousel')) type = 'carousel';
        else if (cleanName.includes('festival')) type = 'festival';
        else type = 'creative';
      }
      existingMap.set(`m${m}_w${w}_${type}_${slotNum}`, t);
      if (type === 'creative' && slotNum === '1') {
        existingMap.set(`m${m}_w${w}_creative_0`, t);
      }
      if (type === 'reel' && slotNum === '1') {
        existingMap.set(`m${m}_w${w}_reel_0`, t);
      }
      
      // Index by original coordinates if task was shifted, to prevent backend replacing shifted tasks
      if (t.originalWeekNumber || t.originalMonthNumber) {
          const origM = t.originalMonthNumber || m;
          const origW = t.originalWeekNumber || w;
          existingMap.set(`m${origM}_w${origW}_${cleanName}`, t);
          existingMap.set(`m${origM}_w${origW}_${type}_${slotNum}`, t);
      }
      
      // Index festivals by exact name globally to prevent duplicate generation if week shifts
      if (t.taskType === 'festival' || cleanName.includes('festival')) {
          existingMap.set(cleanName, t);
          const festName = cleanName.replace(/^festival post:\s*/i, '').split('-')[0].trim();
          existingMap.set(`m${m}_fest_${festName}`, t);
          existingMap.set(`fest_${festName}`, t);
          const yr = (t.dueDate || '').slice(0, 4);
          if (yr) {
            existingMap.set(`fest_${festName}_${yr}`, t);
          }
      }

      if (t.customId) existingMap.set(t.customId, t);
      if (t._id) existingMap.set(t._id.toString(), t);
      if (t.slotKey) existingMap.set(t.slotKey, t);
    });

    // Default to at least 1 month, up to contract duration or active cycles
    let planMonths = 1;
    const durStr = String(project.planDuration || '').toUpperCase();
    if (durStr.includes('YEAR') || durStr.includes('12 MONTH')) planMonths = 12;
    else if (durStr.includes('HALF') || durStr.includes('6 MONTH')) planMonths = 6;
    else if (durStr.includes('QUART') || durStr.includes('3 MONTH')) planMonths = 3;
    else if (durStr === 'MONTHLY' || durStr.includes('1 MONTH')) planMonths = 1;

    const normalizeYMD = (val) => {
      if (!val) return null;
      const str = String(val).trim().split('T')[0];
      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
      const dmyMatch = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
      if (dmyMatch) {
        return `${dmyMatch[3]}-${String(dmyMatch[2]).padStart(2, '0')}-${String(dmyMatch[1]).padStart(2, '0')}`;
      }
      return str;
    };

    const formatYMD = (dt) => {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    const computeNextRenewal = (fromDateStr, duration) => {
      if (!fromDateStr) return null;
      const d = new Date(fromDateStr);
      if (isNaN(d.getTime())) return null;
      const cleanDur = String(duration || 'Monthly').toUpperCase();
      if (cleanDur.includes('YEAR') || cleanDur.includes('12 MONTH')) d.setFullYear(d.getFullYear() + 1);
      else if (cleanDur.includes('HALF') || cleanDur.includes('6 MONTH')) d.setMonth(d.getMonth() + 6);
      else if (cleanDur.includes('QUART') || cleanDur.includes('3 MONTH')) d.setMonth(d.getMonth() + 3);
      else d.setMonth(d.getMonth() + 1);
      return formatYMD(d);
    };

    // Calculate elapsed and upcoming active months from start date up to contract cutoff date
    const candidates = [];
    if (project.nextRenewalDate) {
      const norm = normalizeYMD(project.nextRenewalDate);
      if (norm && norm !== baseHandover) candidates.push(norm);
    }
    if (Array.isArray(project.salesContracts)) {
      project.salesContracts.forEach(sc => {
        const norm = normalizeYMD(sc.renewalDate || sc.nextRenewalDate);
        if (norm && norm !== baseHandover) candidates.push(norm);
      });
    }
    if (Array.isArray(project.connectedPlans)) {
      project.connectedPlans.forEach(cp => {
        const norm = normalizeYMD(cp.renewalDate || cp.nextRenewalDate);
        if (norm && norm !== baseHandover) candidates.push(norm);
      });
    }
    if (project.renewalDate) {
      const norm = normalizeYMD(project.renewalDate);
      if (norm && norm !== baseHandover) candidates.push(norm);
    }

    const validCandidates = candidates.filter(Boolean).sort().reverse();
    let cutoffDateStr = validCandidates.length > 0 ? validCandidates[0] : null;

    if (!cutoffDateStr && baseHandover) {
      cutoffDateStr = computeNextRenewal(baseHandover, project.planDuration || 'Monthly');
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const renewalStatusLower = String(project.renewalStatus || '').toLowerCase();
    const isActivelyRenewed = ['renewed', 'yes', 'active'].includes(renewalStatusLower) && (!cutoffDateStr || cutoffDateStr >= todayStr);
    let totalMonths = planMonths;

    if (cutoffDateStr && baseHandover) {
      const cParts = cutoffDateStr.split('-').map(Number);
      const sParts = baseHandover.split('-').map(Number);
      if (cParts.length === 3 && sParts.length === 3) {
        let diffM = (cParts[0] - sParts[0]) * 12 + (cParts[1] - sParts[1]);
        if (cParts[2] < sParts[2]) {
          diffM = Math.max(0, diffM - 1);
        }
        if (isActivelyRenewed) {
          totalMonths = Math.max(planMonths, diffM);
        } else {
          totalMonths = Math.min(planMonths, Math.max(1, diffM));
        }
      }
    } else if (!isActivelyRenewed) {
      totalMonths = planMonths;
    }

    totalMonths = Math.max(1, Math.min(60, totalMonths));

    // For overdue or unrenewed projects, immediately purge any mistakenly generated uncompleted tasks past the cutoff date
    if (cutoffDateStr && !isActivelyRenewed) {
      try {
        const projectIdsList = [projId, project.customId, project._id ? project._id.toString() : null].filter(Boolean);
        await Task.deleteMany({
          projectId: { $in: projectIdsList },
          dueDate: { $gt: cutoffDateStr },
          status: { $ne: 'done' }
        });
      } catch (purgeErr) {
        console.warn('[TaskGenerator] Post-cutoff task purge warning:', purgeErr.message);
      }
    }

    const cDay = startDateObj.getDay();
    const distToMon = cDay === 0 ? -6 : 1 - cDay;
    const projectWeek1Monday = new Date(startDateObj.getFullYear(), startDateObj.getMonth(), startDateObj.getDate() + distToMon, 12, 0, 0);

    const tasksToCreate = [];

    for (let m = 1; m <= totalMonths; m++) {
      const targetWeek1Monday = new Date(projectWeek1Monday.getFullYear(), projectWeek1Monday.getMonth(), projectWeek1Monday.getDate() + (m - 1) * 28, 12, 0, 0);

      for (let w = 1; w <= 4; w++) {
        const targetWeekMonday = new Date(targetWeek1Monday.getFullYear(), targetWeek1Monday.getMonth(), targetWeek1Monday.getDate() + (w - 1) * 7, 12, 0, 0);
        const targetWeekSat = new Date(targetWeekMonday.getFullYear(), targetWeekMonday.getMonth(), targetWeekMonday.getDate() + 5, 12, 0, 0);
        const weekMonStr = formatYMD(targetWeekMonday);
        const weekSatStr = formatYMD(targetWeekSat);

        const creativesThisWeek = creativesDistribution[w - 1] || 0;
        const reelsThisWeek = reelsDistribution[w - 1] || 0;
        const carouselsThisWeek = carouselsDistribution[w - 1] || 0;

        // 1. Creatives
        for (let c = 0; c < creativesThisWeek; c++) {
          const dayOffset = creativesThisWeek === 1 ? 0 : (creativesThisWeek === 2 ? (c === 0 ? 0 : 3) : ((c * 2) % 6));
          let taskDate = new Date(targetWeekMonday.getFullYear(), targetWeekMonday.getMonth(), targetWeekMonday.getDate() + dayOffset, 12, 0, 0);
          if (taskDate.getDay() === 0) taskDate.setDate(taskDate.getDate() - 1);
          let ymd = formatYMD(taskDate);

          if (m === 1 && w === 1 && ymd < baseHandover && baseHandover <= weekSatStr) {
            const handoverObj = new Date(baseHandover);
            const forwardDate = new Date(handoverObj.getFullYear(), handoverObj.getMonth(), handoverObj.getDate() + c * 2, 12, 0, 0);
            if (forwardDate.getDay() === 0) forwardDate.setDate(forwardDate.getDate() + 1);
            ymd = formatYMD(forwardDate);
          }
          if (ymd > weekSatStr) ymd = weekSatStr;
          if (ymd < weekMonStr) ymd = weekMonStr;

          // Strict renewal cutoff guard: do not generate tasks scheduled past the contract cutoff date
          if (cutoffDateStr && ymd > cutoffDateStr) {
            continue;
          }

          const suffix = creativesThisWeek > 1 ? ` #${c + 1}` : '';
          const taskName = `Creative${suffix}: ${brand}`;
          const cleanName = taskName.toLowerCase().trim();
          const slotKey = `${projId}_m${m}_w${w}_creative_${c + 1}`;
          const existing = existingMap.get(slotKey) ||
                           existingMap.get(`m${m}_w${w}_${cleanName}`) || 
                           existingMap.get(`m${m}_w${w}_creative_${c + 1}`) || 
                           (c === 0 ? existingMap.get(`m${m}_w${w}_creative_1`) : null);

          if (!existing) {
            tasksToCreate.push({
              customId: 't_' + Math.random().toString(36).substring(2, 9),
              slotKey,
              name: taskName,
              projectId: projId,
              taskType: 'creative',
              monthNumber: m,
              weekNumber: w,
              assignedTo: assignedCreativeCreator,
              assignedToId: creativeCreatorId,
              assignedBy: acctMgr,
              accountManager: acctMgr,
              description: responsibilityOwners.get('creative')?.description || '',
              priority: 'medium',
              dueDate: ymd,
              status: 'todo',
              deliveredCount: 1
            });
            existingMap.set(slotKey, { name: taskName });
            existingMap.set(`m${m}_w${w}_creative_${c + 1}`, { name: taskName });
          } else if (existing && existing._id && existing.status !== 'done' && !existing.isUserEdited) {
            const updates = {};
            if (!existing.slotKey) {
              updates.slotKey = slotKey;
            }
            if (existing.dueDate !== ymd && !existing.isCustomMoved) {
              updates.dueDate = ymd;
            }
            if (assignedCreativeCreator && (!existing.assignedTo || existing.assignedTo !== assignedCreativeCreator)) {
              updates.assignedTo = assignedCreativeCreator;
              updates.assignedToId = creativeCreatorId;
            }
            if (responsibilityOwners.get('creative')?.description && existing.description !== responsibilityOwners.get('creative').description) {
              updates.description = responsibilityOwners.get('creative').description;
            }
            if (Object.keys(updates).length > 0) {
              await Task.updateOne({ _id: existing._id }, { $set: updates });
            }
          }
        }

        // 2. Reels
        for (let r = 0; r < reelsThisWeek; r++) {
          const dayOffset = reelsThisWeek === 1 ? 1 : (reelsThisWeek === 2 ? (r === 0 ? 1 : 4) : ((r * 2 + 1) % 6));
          let taskDate = new Date(targetWeekMonday.getFullYear(), targetWeekMonday.getMonth(), targetWeekMonday.getDate() + dayOffset, 12, 0, 0);
          if (taskDate.getDay() === 0) taskDate.setDate(taskDate.getDate() - 1);
          let ymd = formatYMD(taskDate);

          if (m === 1 && w === 1 && ymd < baseHandover && baseHandover <= weekSatStr) {
            const handoverObj = new Date(baseHandover);
            const forwardDate = new Date(handoverObj.getFullYear(), handoverObj.getMonth(), handoverObj.getDate() + (r * 2 + 1), 12, 0, 0);
            if (forwardDate.getDay() === 0) forwardDate.setDate(forwardDate.getDate() + 1);
            ymd = formatYMD(forwardDate);
          }
          if (ymd > weekSatStr) ymd = weekSatStr;
          if (ymd < weekMonStr) ymd = weekMonStr;

          // Strict renewal cutoff guard: do not generate tasks scheduled past the contract cutoff date
          if (cutoffDateStr && ymd > cutoffDateStr) {
            continue;
          }

          const suffix = reelsThisWeek > 1 ? ` #${r + 1}` : '';
          const taskName = `Reel / Short${suffix}: ${brand}`;
          const cleanName = taskName.toLowerCase().trim();
          const slotKey = `${projId}_m${m}_w${w}_reel_${r + 1}`;
          const existing = existingMap.get(slotKey) ||
                           existingMap.get(`m${m}_w${w}_${cleanName}`) || 
                           existingMap.get(`m${m}_w${w}_reel_${r + 1}`) || 
                           (r === 0 ? existingMap.get(`m${m}_w${w}_reel_1`) : null);

          if (!existing) {
            tasksToCreate.push({
              customId: 't_' + Math.random().toString(36).substring(2, 9),
              slotKey,
              name: taskName,
              projectId: projId,
              taskType: 'reel',
              monthNumber: m,
              weekNumber: w,
              assignedTo: assignedEditor,
              assignedToId: editorId,
              assignedBy: acctMgr,
              accountManager: acctMgr,
              description: responsibilityOwners.get('reel')?.description || '',
              priority: 'medium',
              dueDate: ymd,
              status: 'todo',
              deliveredCount: 1
            });
            existingMap.set(slotKey, { name: taskName });
            existingMap.set(`m${m}_w${w}_reel_${r + 1}`, { name: taskName });
          } else if (existing && existing._id && existing.status !== 'done' && !existing.isUserEdited) {
            const updates = {};
            if (!existing.slotKey) {
              updates.slotKey = slotKey;
            }
            if (existing.dueDate !== ymd && !existing.isCustomMoved) {
              updates.dueDate = ymd;
            }
            if (assignedEditor && (!existing.assignedTo || existing.assignedTo !== assignedEditor)) {
              updates.assignedTo = assignedEditor;
              updates.assignedToId = editorId;
            }
            if (responsibilityOwners.get('reel')?.description && existing.description !== responsibilityOwners.get('reel').description) {
              updates.description = responsibilityOwners.get('reel').description;
            }
            if (Object.keys(updates).length > 0) {
              await Task.updateOne({ _id: existing._id }, { $set: updates });
            }
          }
        }

        // 3. Carousels
        for (let cr = 0; cr < carouselsThisWeek; cr++) {
          const dayOffset = (cr * 2 + 2) % 6;
          let taskDate = new Date(targetWeekMonday.getFullYear(), targetWeekMonday.getMonth(), targetWeekMonday.getDate() + dayOffset, 12, 0, 0);
          if (taskDate.getDay() === 0) taskDate.setDate(taskDate.getDate() - 1);
          const ymd = formatYMD(taskDate);

          // Strict renewal cutoff guard: do not generate tasks scheduled past the contract cutoff date
          if (cutoffDateStr && ymd > cutoffDateStr) {
            continue;
          }

          const suffix = carouselsThisWeek > 1 ? ` #${cr + 1}` : '';
          const taskName = `Carousel Post${suffix}: ${brand}`;
          const cleanName = taskName.toLowerCase().trim();
          const slotKey = `${projId}_m${m}_w${w}_carousel_${cr + 1}`;
          const existing = existingMap.get(slotKey) || existingMap.get(`m${m}_w${w}_${cleanName}`);

          if (!existing) {
            tasksToCreate.push({
              customId: 't_' + Math.random().toString(36).substring(2, 9),
              slotKey,
              name: taskName,
              projectId: projId,
              taskType: 'carousel',
              monthNumber: m,
              weekNumber: w,
              assignedTo: assignedCarouselCreator,
              assignedToId: carouselCreatorId,
              assignedBy: acctMgr,
              accountManager: acctMgr,
              description: responsibilityOwners.get('carousel')?.description || '',
              priority: 'medium',
              dueDate: ymd,
              status: 'todo',
              deliveredCount: 1
            });
            existingMap.set(slotKey, { name: taskName });
          } else if (existing && existing.status !== 'done' && !existing.isUserEdited) {
            const updates = {};
            if (!existing.slotKey) {
              updates.slotKey = slotKey;
            }
            if (existing.dueDate !== ymd && !existing.isCustomMoved) {
              updates.dueDate = ymd;
            }
            if (assignedCarouselCreator && (!existing.assignedTo || existing.assignedTo !== assignedCarouselCreator)) {
              updates.assignedTo = assignedCarouselCreator;
              updates.assignedToId = carouselCreatorId;
            }
            if (responsibilityOwners.get('carousel')?.description && existing.description !== responsibilityOwners.get('carousel').description) {
              updates.description = responsibilityOwners.get('carousel').description;
            }
            if (Object.keys(updates).length > 0) {
              await Task.updateOne({ _id: existing._id }, { $set: updates });
            }
          }
        }
      }

      // 4. Festivals for this cycle (strictly separate deliverable, only if opted by client)
      if (hasFestival) {
        const cycleEndDate = new Date(targetWeek1Monday.getFullYear(), targetWeek1Monday.getMonth(), targetWeek1Monday.getDate() + 28, 12, 0, 0);
        const startCycleStr = formatYMD(targetWeek1Monday);
        const endCycleStr = formatYMD(cycleEndDate);

        const cycleFestivals = FESTIVALS_AND_HOLIDAYS.filter(f => f.date >= startCycleStr && f.date < endCycleStr && f.date >= baseHandover && (!cutoffDateStr || f.date <= cutoffDateStr));

        for (const fest of cycleFestivals) {
          let taskDueDate = fest.date;
          const fParts = fest.date.split('-');
          const festDateObj = new Date(parseInt(fParts[0], 10), parseInt(fParts[1], 10) - 1, parseInt(fParts[2], 10), 12, 0, 0);
          if (festDateObj.getDay() === 0) {
            const satDate = new Date(festDateObj.getFullYear(), festDateObj.getMonth(), festDateObj.getDate() - 1, 12, 0, 0);
            taskDueDate = formatYMD(satDate);
          }

          let festWeek = 1;
          for (let fw = 1; fw <= 4; fw++) {
            const wMon = new Date(targetWeek1Monday.getFullYear(), targetWeek1Monday.getMonth(), targetWeek1Monday.getDate() + (fw - 1) * 7);
            const wSun = new Date(wMon.getFullYear(), wMon.getMonth(), wMon.getDate() + 6, 23, 59, 59);
            if (festDateObj >= wMon && festDateObj <= wSun) {
              festWeek = fw;
              break;
            }
          }

          const taskName = `Festival Post: ${fest.name} - ${brand}`;
          const cleanName = taskName.toLowerCase().trim();
          const festClean = fest.name.toLowerCase().trim();
          const festYr = (taskDueDate || fest.date || '').slice(0, 4);
          const slotKey = `${projId}_fest_${festClean}_${festYr || fest.date || ''}`;
          const existing = existingMap.get(slotKey) ||
                           existingMap.get(cleanName) || 
                           existingMap.get(festClean) || 
                           existingMap.get(`fest_${festClean}`) || 
                           (festYr ? existingMap.get(`fest_${festClean}_${festYr}`) : null) ||
                           existingMap.get(`m${m}_fest_${festClean}`) || 
                           existingMap.get(`m${m}_w${festWeek}_${cleanName}`);

          if (!existing) {
            tasksToCreate.push({
              customId: 't_' + Math.random().toString(36).substring(2, 9),
              slotKey,
              name: taskName,
              projectId: projId,
              taskType: 'festival',
              monthNumber: m,
              weekNumber: festWeek,
              assignedTo: assignedFestivalCreator,
              assignedToId: festivalCreatorId,
              assignedBy: acctMgr,
              accountManager: acctMgr,
              description: responsibilityOwners.get('festival')?.description || fest.description || '',
              priority: 'high',
              dueDate: taskDueDate,
              isFixedDate: true,
              isLocked: true,
              fixedDateReason: `${fest.name} is on ${fest.date}.`,
              status: 'todo',
              deliveredCount: 1,
              festivalDescription: fest.description || ''
            });
            existingMap.set(slotKey, { name: taskName });
            existingMap.set(`m${m}_fest_${festClean}`, { name: taskName });
            existingMap.set(`fest_${festClean}`, { name: taskName });
          } else if (existing && existing._id && existing.status !== 'done' && !existing.isUserEdited) {
            const updates = {};
            if (!existing.slotKey) {
              updates.slotKey = slotKey;
            }
            if (existing.dueDate !== taskDueDate && !existing.isCustomMoved) {
              updates.dueDate = taskDueDate;
            }
            if (existing.monthNumber !== m && !existing.isCustomMoved) {
              updates.monthNumber = m;
            }
            if (existing.weekNumber !== festWeek && !existing.isCustomMoved) {
              updates.weekNumber = festWeek;
            }
            if (assignedFestivalCreator && (!existing.assignedTo || existing.assignedTo !== assignedFestivalCreator)) {
              updates.assignedTo = assignedFestivalCreator;
              updates.assignedToId = festivalCreatorId;
            }
            if (responsibilityOwners.get('festival')?.description && existing.description !== responsibilityOwners.get('festival').description) {
              updates.description = responsibilityOwners.get('festival').description;
            }
            if (Object.keys(updates).length > 0) {
              await Task.updateOne({ _id: existing._id }, { $set: updates });
            }
          } else if (existing && existing._id && !existing.isCustomMoved) {
            // Ensure monthNumber and weekNumber are aligned even for completed festival tasks
            const syncUpdates = {};
            if (existing.monthNumber !== m) syncUpdates.monthNumber = m;
            if (existing.weekNumber !== festWeek) syncUpdates.weekNumber = festWeek;
            if (Object.keys(syncUpdates).length > 0) {
              await Task.updateOne({ _id: existing._id }, { $set: syncUpdates });
            }
          }
        }
      }
    }

    // If client did NOT opt for festival, remove any festival tasks for this project
    if (!hasFestival) {
      await Task.deleteMany({
        projectId: { $in: projIds },
        $or: [
          { taskType: 'festival' },
          { name: { $regex: /festival post/i } }
        ]
      });
    }

    // If project has an active contract renewal cutoff date, delete any uncompleted deliverables scheduled past that date
    if (cutoffDateStr) {
      await Task.deleteMany({
        projectId: { $in: projIds },
        dueDate: { $gt: cutoffDateStr },
        status: { $ne: 'done' }
      });
    }

    if (tasksToCreate.length > 0) {
      await Task.insertMany(tasksToCreate);
      console.log(`[TaskGenerator] Created ${tasksToCreate.length} deliverables for project: ${brand} (${projId})`);
    }

    // Auto-heal, deduplicate, and realign all deliverable dates
    try {
      await deduplicateProjectTasksInDb(project);
      await realignDeliverableDatesForProject(project, { skipBackfill: true });
    } catch (healErr) {
      console.warn('[TaskGenerator] Date realignment warning:', healErr.message);
    }

    return await Task.find({ projectId: { $in: projIds } });
  } catch (err) {
    console.error('[TaskGenerator] Error generating deliverables:', err);
    return [];
  }
};
