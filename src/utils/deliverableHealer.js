import mongoose from 'mongoose';
import { Project } from '../models/Project.js';
import { Task } from '../models/Task.js';
import { FESTIVALS_AND_HOLIDAYS } from './festivalConstants.js';

async function findProjectByIdOrCustomId(projectIdOrDoc) {
  if (!projectIdOrDoc) return null;
  if (typeof projectIdOrDoc !== 'string') return projectIdOrDoc;
  const isOid = mongoose.Types.ObjectId.isValid(projectIdOrDoc);
  return await Project.findOne(
    isOid ? { $or: [{ customId: projectIdOrDoc }, { _id: projectIdOrDoc }] } : { customId: projectIdOrDoc }
  ).lean();
}

export function parseExactDate(rawDate) {
  let startDateObj = new Date();
  const str = String(rawDate || '').trim();
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
  if (isNaN(startDateObj.getTime())) startDateObj = new Date();
  return startDateObj;
}

export function formatYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Auto-detects and removes any duplicate deliverable tasks for a project in MongoDB.
 * Groups by (monthNumber, weekNumber, taskType, slotIndex/festival), keeps the best
 * completed/verified task, and deletes superfluous duplicates.
 */
export async function deduplicateProjectTasksInDb(projectOrId) {
  try {
    let project = await findProjectByIdOrCustomId(projectOrId);
    if (!project) return { deletedCount: 0, preservedCount: 0 };

    const pIds = [project.customId, project._id?.toString()].filter(Boolean);
    const tasks = await Task.find({ projectId: { $in: pIds } });
    if (!tasks || tasks.length === 0) return { deletedCount: 0, preservedCount: 0 };

    const slotGroups = new Map();

    for (const t of tasks) {
      const rawName = t.name || '';
      const lowerName = rawName.toLowerCase();
      const m = Number(t.monthNumber) || 1;
      const w = Number(t.weekNumber) || 1;
      
      let type = t.taskType || '';
      if (!type || type === 'creative') {
        if (lowerName.includes('reel') || lowerName.includes('short')) type = 'reel';
        else if (lowerName.includes('carousel')) type = 'carousel';
        else if (lowerName.includes('festival')) type = 'festival';
        else type = 'creative';
      }

      let slotKey = t.slotKey || '';
      if (!slotKey) {
        if (type === 'festival') {
          const festName = lowerName
            .replace(/^festival post:\s*/i, '')
            .split('-')[0]
            .split(':')[0]
            .trim();
          const yr = (t.dueDate || '').slice(0, 4) || '2026';
          slotKey = `${pIds[0]}_fest_${festName}_${yr}`;
        } else {
          const numMatch = rawName.match(/#(\d+)/);
          const slotNum = numMatch ? numMatch[1] : '1';
          slotKey = `${pIds[0]}_m${m}_w${w}_${type}_${slotNum}`;
        }
      }

      if (!slotGroups.has(slotKey)) {
        slotGroups.set(slotKey, []);
      }
      slotGroups.get(slotKey).push(t);
    }

    const toDeleteIds = [];

    for (const [slotKey, group] of slotGroups.entries()) {
      if (group.length <= 1) continue;

      group.sort((a, b) => {
        const aDone = a.status === 'done' || a.status === 'completed' || a.status === 'published';
        const bDone = b.status === 'done' || b.status === 'completed' || b.status === 'published';
        const aLink = Boolean(a.deliveryLink && a.deliveryLink.trim());
        const bLink = Boolean(b.deliveryLink && b.deliveryLink.trim());

        if (aDone && aLink && (!bDone || !bLink)) return -1;
        if (bDone && bLink && (!aDone || !aLink)) return 1;

        if (aDone && !bDone) return -1;
        if (bDone && !aDone) return 1;

        const aComp = Boolean(a.completedDate);
        const bComp = Boolean(b.completedDate);
        if (aComp && !bComp) return -1;
        if (bComp && !aComp) return 1;

        const aEdit = Boolean(a.isUserEdited || a.isCustomMoved);
        const bEdit = Boolean(b.isUserEdited || b.isCustomMoved);
        if (aEdit && !bEdit) return -1;
        if (bEdit && !aEdit) return 1;

        const aRem = Boolean(a.remarks);
        const bRem = Boolean(b.remarks);
        if (aRem && !bRem) return -1;
        if (bRem && !aRem) return 1;

        // Penalize generic "- Project" names if a real brand name exists
        const aGeneric = (a.name || '').endsWith('- Project') || (a.name || '').includes(': Project');
        const bGeneric = (b.name || '').endsWith('- Project') || (b.name || '').includes(': Project');
        if (!aGeneric && bGeneric) return -1;
        if (aGeneric && !bGeneric) return 1;

        return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
      });

      const preserved = group[0];
      if (preserved && !preserved.slotKey && slotKey) {
        await Task.updateOne({ _id: preserved._id }, { $set: { slotKey } });
      }

      const duplicates = group.slice(1);
      duplicates.forEach(dup => {
        toDeleteIds.push(dup._id);
      });
    }

    if (toDeleteIds.length > 0) {
      await Task.deleteMany({ _id: { $in: toDeleteIds } });
      console.log(`[Deduplicate] Auto-removed ${toDeleteIds.length} duplicate tasks for ${project.brandName || project.name}`);
    }

    return {
      deletedCount: toDeleteIds.length,
      preservedCount: tasks.length - toDeleteIds.length
    };
  } catch (err) {
    console.error('Error in deduplicateProjectTasksInDb:', err);
    return { deletedCount: 0, preservedCount: 0, error: err.message };
  }
}

/**
 * Deduplicates tasks across all non-cancelled projects in the database.
 */
export async function deduplicateAllProjectsTasksInDb() {
  try {
    const projects = await Project.find({ status: { $ne: 'cancelled' } }).lean();
    let totalDeleted = 0;
    for (const p of projects) {
      const res = await deduplicateProjectTasksInDb(p);
      totalDeleted += res.deletedCount;
    }
    return { success: true, totalDeleted, projectCount: projects.length };
  } catch (err) {
    console.error('Error in deduplicateAllProjectsTasksInDb:', err);
    return { success: false, totalDeleted: 0, error: err.message };
  }
}

/**
 * Realigns all deliverable task due dates for a given project so they strictly fall
 * within each task's assigned (monthNumber, weekNumber) calendar range.
 * Preserves completed status, completion date, and delivery links.
 */
export async function realignDeliverableDatesForProject(projectIdOrDoc, options = {}) {
  try {
    let project = await findProjectByIdOrCustomId(projectIdOrDoc);
    if (!project) return { success: false, message: 'Project not found', fixedCount: 0 };

    // Auto-deduplicate first to ensure clean state
    await deduplicateProjectTasksInDb(project);

    const pIds = [project.customId, project._id?.toString()].filter(Boolean);
    const tasks = await Task.find({ projectId: { $in: pIds } });
    if (!tasks || tasks.length === 0) {
      return { success: true, fixedCount: 0, message: 'No tasks found for project' };
    }

    const startStr = project.handoverDate || project.startDate || project.createdAt || new Date();
    const startDateObj = parseExactDate(startStr);
    const cDay = startDateObj.getDay();
    const distToMon = cDay === 0 ? -6 : 1 - cDay;
    const projectWeek1Monday = new Date(startDateObj.getFullYear(), startDateObj.getMonth(), startDateObj.getDate() + distToMon, 12, 0, 0);
    const baseHandover = formatYMD(startDateObj);

    let fixedCount = 0;
    const modifiedTasks = [];

    for (const t of tasks) {
      // Skip pure service milestone tasks (website, SEO, product shoot)
      const isFestival = t.taskType === 'festival' || t.name?.toLowerCase().includes('festival');
      const isServiceTask = t.taskType?.startsWith('web_') ||
        ['content_upload', 'website_qa', 'deployment'].includes(t.taskType) ||
        t.taskType?.includes('seo') || t.taskType === 'keyword_research' ||
        t.taskType?.includes('shoot') ||
        ['photography', 'photo_editing', 'video_shoot', 'video_editing', 'shoot_delivery'].includes(t.taskType);
      if (isServiceTask) continue;

      if (isFestival) {
        // Ensure festival task has accurate due date according to its year, and correct monthNumber & weekNumber
        const targetYear = (t.dueDate ? t.dueDate.slice(0, 4) : projectWeek1Monday.getFullYear().toString());
        const matchedFest = FESTIVALS_AND_HOLIDAYS.find(f => f.date.startsWith(targetYear) && t.name?.toLowerCase().includes(f.name.toLowerCase()));
        if (matchedFest && !t.isCustomMoved) {
          let expectedDue = matchedFest.date;
          const fParts = expectedDue.split('-');
          const festDateObj = new Date(parseInt(fParts[0], 10), parseInt(fParts[1], 10) - 1, parseInt(fParts[2], 10), 12, 0, 0);
          if (festDateObj.getDay() === 0) {
            const satDate = new Date(festDateObj.getFullYear(), festDateObj.getMonth(), festDateObj.getDate() - 1, 12, 0, 0);
            expectedDue = formatYMD(satDate);
          }

          // Calculate correct month and week for this festival
          const festUtc = Date.UTC(festDateObj.getFullYear(), festDateObj.getMonth(), festDateObj.getDate());
          const baseUtc = Date.UTC(projectWeek1Monday.getFullYear(), projectWeek1Monday.getMonth(), projectWeek1Monday.getDate());
          const diffDays = Math.floor((festUtc - baseUtc) / (1000 * 60 * 60 * 24));
          const cycleMonth = Math.max(1, Math.floor(diffDays / 28) + 1);
          const dayInCycle = ((diffDays % 28) + 28) % 28;
          const festWeek = Math.min(4, Math.max(1, Math.floor(dayInCycle / 7) + 1));

          let changed = false;
          if (t.dueDate !== expectedDue) {
            t.dueDate = expectedDue;
            changed = true;
          }
          if (t.monthNumber !== cycleMonth) {
            t.monthNumber = cycleMonth;
            changed = true;
          }
          if (t.weekNumber !== festWeek) {
            t.weekNumber = festWeek;
            changed = true;
          }
          if (changed) {
            await t.save();
            fixedCount++;
            modifiedTasks.push({
              taskId: t._id,
              name: t.name,
              month: cycleMonth,
              week: festWeek,
              oldDue: t.dueDate,
              newDue: expectedDue
            });
          }
        }
        continue;
      }

      // Smart Week & Month resolution: check title, customId, originalWeekNumber, or t.weekNumber
      let w = null;
      const titleWeekMatch = t.name?.match(/week\s*([1-4])/i);
      if (titleWeekMatch && titleWeekMatch[1]) {
        w = parseInt(titleWeekMatch[1], 10);
      }
      if (!w && t.customId) {
        const idWeekMatch = String(t.customId).match(/_w([1-4])(?:_|$)/i);
        if (idWeekMatch && idWeekMatch[1]) {
          w = parseInt(idWeekMatch[1], 10);
        }
      }
      if (!w && t.originalWeekNumber) {
        w = Number(t.originalWeekNumber);
      }
      if (!w && t.weekNumber) {
        w = Number(t.weekNumber);
      }
      w = Math.min(4, Math.max(1, w || 1));

      let m = null;
      if (t.customId) {
        const idMonthMatch = String(t.customId).match(/_m(\d+)(?:_|$)/i);
        if (idMonthMatch && idMonthMatch[1]) {
          m = parseInt(idMonthMatch[1], 10);
        }
      }
      if (!m && t.monthNumber) {
        m = Number(t.monthNumber);
      }
      m = Math.max(1, m || 1);

      const targetWeek1Monday = new Date(projectWeek1Monday.getFullYear(), projectWeek1Monday.getMonth(), projectWeek1Monday.getDate() + (m - 1) * 28, 12, 0, 0);
      const targetWeekMonday = new Date(targetWeek1Monday.getFullYear(), targetWeek1Monday.getMonth(), targetWeek1Monday.getDate() + (w - 1) * 7, 12, 0, 0);
      const targetWeekSat = new Date(targetWeekMonday.getFullYear(), targetWeekMonday.getMonth(), targetWeekMonday.getDate() + 5, 12, 0, 0);

      const weekStartStr = formatYMD(targetWeekMonday);
      const weekSatStr = formatYMD(targetWeekSat);

      const tDue = String(t.dueDate || '').split('T')[0];
      const isReel = t.taskType?.includes('reel') || t.name?.toLowerCase().includes('reel') || t.name?.toLowerCase().includes('short');

      const dueObj = tDue ? new Date(tDue) : null;
      const isSunday = dueObj && dueObj.getDay() === 0;
      const isOutsideWeek = !tDue || tDue < weekStartStr || tDue > weekSatStr;

      // Extract indexInWeek BEFORE checking weekPreset config to avoid TDZ ReferenceError
      let indexInWeek = 0;
      const numMatch = t.name?.match(/#(\d+)/);
      if (numMatch) {
        indexInWeek = Math.max(0, parseInt(numMatch[1], 10) - 1);
      }

      // Support custom weekPreset if defined on project:
      const projectWeekPreset = project.weekPreset || null;
      const activeWeekConfig = (projectWeekPreset?.weekOverrides && projectWeekPreset.weekOverrides[w])
        ? projectWeekPreset.weekOverrides[w]
        : (projectWeekPreset?.days ? projectWeekPreset.days : null);

      let presetDayOffset = null;
      let presetAssignee = null;
      if (activeWeekConfig) {
        const presetDeliverables = activeWeekConfig.deliverables || (projectWeekPreset?.weekOverrides?.[w]?.deliverables) || projectWeekPreset?.deliverables;
        const targetType = isReel ? 'reel' : 'creative';
        if (Array.isArray(presetDeliverables)) {
          const matched = presetDeliverables.find(item => 
            item.type === targetType && (item.slot === indexInWeek + 1 || item.slot === indexInWeek)
          );
          if (matched && matched.dayOffset !== undefined) {
            presetDayOffset = matched.dayOffset;
            presetAssignee = matched.assignedTo || null;
          }
        }
        if (presetDayOffset === null) {
          let matchCount = 0;
          for (let d = 0; d < 6; d++) {
            const cfg = activeWeekConfig[d] || activeWeekConfig[String(d)];
            if (cfg && (cfg[targetType] || cfg.type === targetType)) {
              if (matchCount === indexInWeek) {
                presetDayOffset = d;
                presetAssignee = cfg[`${targetType}AssignedTo`] || cfg.assignedTo || null;
                break;
              }
              matchCount++;
            }
          }
        }
      }

      const isTargetWeek = options.weekNumber !== undefined && options.weekNumber !== null ? Number(options.weekNumber) === w : true;
      const shouldForceReset = Boolean(options.resetAll) && isTargetWeek;

      if (shouldForceReset || isOutsideWeek || isSunday || presetDayOffset !== null || t.weekNumber !== w || t.monthNumber !== m || t.isCustomMoved) {
        let dayOffset;
        if (presetDayOffset !== null) {
          dayOffset = presetDayOffset;
        } else if (isReel) {
          dayOffset = indexInWeek === 1 ? 4 : (indexInWeek === 0 ? 1 : ((indexInWeek * 2 + 1) % 5));
        } else {
          dayOffset = indexInWeek === 1 ? 3 : (indexInWeek === 0 ? 0 : ((indexInWeek * 2) % 5));
        }

        let taskDate = new Date(targetWeekMonday.getFullYear(), targetWeekMonday.getMonth(), targetWeekMonday.getDate() + dayOffset, 12, 0, 0);
        if (taskDate.getDay() === 0) {
          taskDate.setDate(taskDate.getDate() - 1);
        }
        let correctDue = formatYMD(taskDate);

        if (m === 1 && w === 1 && correctDue < baseHandover && baseHandover <= weekSatStr) {
          correctDue = baseHandover;
        }
        if (correctDue > weekSatStr) {
          correctDue = weekSatStr;
        }
        if (correctDue < weekStartStr) {
          correctDue = weekStartStr;
        }

        let taskChanged = false;
        if (tDue !== correctDue) {
          t.dueDate = correctDue;
          taskChanged = true;
        }
        if (t.isCustomMoved) {
          t.isCustomMoved = false;
          taskChanged = true;
        }
        if (t.isUserEdited && shouldForceReset) {
          t.isUserEdited = false;
          taskChanged = true;
        }
        if (t.weekNumber !== w) {
          t.weekNumber = w;
          taskChanged = true;
        }
        if (t.monthNumber !== m) {
          t.monthNumber = m;
          taskChanged = true;
        }
        if (presetAssignee && t.assignedTo !== presetAssignee) {
          t.assignedTo = presetAssignee;
          taskChanged = true;
        }

        if (taskChanged) {
          await t.save();
          fixedCount++;
          modifiedTasks.push({
            taskId: t._id,
            name: t.name,
            month: m,
            week: w,
            oldDue: tDue,
            newDue: correctDue
          });
        }
      }
    }

    // Auto-generate deliverables to backfill any missing quota slots for any week
    if (!options?.skipBackfill) {
      try {
        const { generateDeliverablesForProjectBackend } = await import('./taskGenerator.js');
        if (generateDeliverablesForProjectBackend) {
          await generateDeliverablesForProjectBackend(project, false);
        }
      } catch (genErr) {
        console.warn('[realignDeliverableDatesForProject] backfill notice:', genErr.message);
      }
    }

    return {
      success: true,
      projectId: project.customId || project._id,
      projectName: project.brandName || project.name,
      fixedCount,
      modifiedTasks
    };
  } catch (error) {
    console.error('Error in realignDeliverableDatesForProject:', error);
    return { success: false, error: error.message, fixedCount: 0 };
  }
}

/**
 * Realigns deliverable task due dates across ALL active projects in the database.
 */
export async function realignAllProjectsDeliverables() {
  try {
    const projects = await Project.find({ status: { $ne: 'cancelled' } }).lean();
    let totalFixed = 0;
    const projectResults = [];

    for (const p of projects) {
      const res = await realignDeliverableDatesForProject(p);
      if (res && res.fixedCount > 0) {
        totalFixed += res.fixedCount;
        projectResults.push({
          projectName: p.brandName || p.name,
          fixedCount: res.fixedCount
        });
      }
    }

    return {
      success: true,
      totalFixed,
      projectCount: projects.length,
      affectedProjects: projectResults
    };
  } catch (error) {
    console.error('Error in realignAllProjectsDeliverables:', error);
    return { success: false, error: error.message, totalFixed: 0 };
  }
}

export function getPlanCycleMonths(planDuration) {
  if (!planDuration) return 1;
  const plan = String(planDuration).toLowerCase().trim();
  if (plan.includes('1 year') || plan.includes('yearly') || plan.includes('12 month') || plan.includes('annual')) return 12;
  if (plan.includes('6 month') || plan.includes('half')) return 6;
  if (plan.includes('3 month') || plan.includes('quarter')) return 3;
  if (plan.includes('2 month')) return 2;
  return 1;
}

export function normalizeToYMD(val) {
  if (!val) return '';
  const str = String(val).trim();
  const dmyMatch = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${String(dmyMatch[2]).padStart(2, '0')}-${String(dmyMatch[1]).padStart(2, '0')}`;
  }
  const ymdMatch = str.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${String(ymdMatch[2]).padStart(2, '0')}-${String(ymdMatch[3]).padStart(2, '0')}`;
  }
  return str.split('T')[0] || '';
}

/**
 * Prunes/deletes any phantom tasks scheduled past the contract renewal cutoff date
 * or past the contract's allowed plan months for an unrenewed project.
 */
export async function pruneTasksPastRenewalForProject(projectOrId) {
  try {
    let project = await findProjectByIdOrCustomId(projectOrId);
    if (!project) return { success: false, message: 'Project not found', prunedCount: 0 };

    const pIds = [project.customId, project._id?.toString()].filter(Boolean);
    const rawCutoff = project.nextRenewalDate || project.renewalDate;
    const cutoffDateStr = normalizeToYMD(rawCutoff);
    const renewalStatusLower = String(project.renewalStatus || '').toLowerCase();
    const isRenewed = ['renewed', 'yes', 'active'].includes(renewalStatusLower);
    const planMonths = getPlanCycleMonths(project.planDuration || project.soldPlanName || 'Monthly');

    // Calculate total allowed calendar months if renewal date spans beyond plan duration (e.g. July 2 to August 2 = 2 months)
    let allowedMonths = planMonths;
    const rawStart = project.handoverDate || project.startDate || project.createdAt;
    const startStr = normalizeToYMD(rawStart);
    if (cutoffDateStr && startStr) {
      const cParts = cutoffDateStr.split('-').map(Number);
      const sParts = startStr.split('-').map(Number);
      if (cParts.length === 3 && sParts.length === 3) {
        const diffM = (cParts[0] - sParts[0]) * 12 + (cParts[1] - sParts[1]);
        allowedMonths = Math.max(planMonths, diffM + 1);
      }
    }

    const tasks = await Task.find({ projectId: { $in: pIds } });
    if (!tasks || tasks.length === 0) {
      return { success: true, message: 'No tasks found', prunedCount: 0 };
    }

    const tasksToPrune = tasks.filter(t => {
      const dueDateStr = normalizeToYMD(t.dueDate);
      const mNum = Number(t.monthNumber);

      // If unrenewed, any task beyond allowedMonths is phantom
      if (!isRenewed && mNum && mNum > allowedMonths) {
        return true;
      }

      // Any task whose due date exceeds the renewal cutoff date
      if (cutoffDateStr && dueDateStr && dueDateStr > cutoffDateStr) {
        return true;
      }

      return false;
    });

    if (tasksToPrune.length === 0) {
      return { success: true, message: 'No tasks past renewal found', prunedCount: 0, preservedCount: tasks.length };
    }

    const pruneIds = tasksToPrune.map(t => t._id);
    await Task.deleteMany({ _id: { $in: pruneIds } });

    console.log(`[DeliverableHealer] Pruned ${pruneIds.length} tasks past renewal for ${project.brandName || project.name}`);

    return {
      success: true,
      message: `Pruned ${pruneIds.length} phantom tasks scheduled past renewal date`,
      prunedCount: pruneIds.length,
      preservedCount: tasks.length - pruneIds.length,
      prunedTasks: tasksToPrune.map(t => ({
        id: t._id,
        name: t.name,
        dueDate: t.dueDate,
        monthNumber: t.monthNumber,
        weekNumber: t.weekNumber
      }))
    };
  } catch (error) {
    console.error('Error in pruneTasksPastRenewalForProject:', error);
    return { success: false, error: error.message, prunedCount: 0 };
  }
}

/**
 * Prunes tasks past renewal across all projects in the database.
 */
export async function pruneAllProjectsTasksPastRenewal() {
  try {
    const projects = await Project.find({ status: { $ne: 'cancelled' } }).lean();
    let totalPruned = 0;
    const projectResults = [];

    for (const p of projects) {
      const res = await pruneTasksPastRenewalForProject(p);
      if (res.prunedCount > 0) {
        totalPruned += res.prunedCount;
        projectResults.push({
          projectId: p.customId || p._id,
          projectName: p.brandName || p.name,
          prunedCount: res.prunedCount
        });
      }
    }

    return {
      success: true,
      totalPruned,
      projectCount: projects.length,
      affectedProjects: projectResults
    };
  } catch (error) {
    console.error('Error in pruneAllProjectsTasksPastRenewal:', error);
    return { success: false, error: error.message, totalPruned: 0 };
  }
}

