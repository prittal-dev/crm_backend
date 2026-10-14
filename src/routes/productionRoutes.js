import express from 'express';
import {
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  updateProjectProgress,
  getTasks,
  createTask,
  updateTask,
  updateTaskStatus,
  getMilestones,
  createMilestone,
  updateMilestoneStatus,
  getTeamMembers,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
  deleteProject,
  deleteTask,
  deleteMilestone,
  getNotifications,
  markNotificationRead,
  clearNotifications,
  logProjectDailyStatus,
  seedAgencyDataHandler,
  clearWorkspaceDataHandler,
  syncProjectTasksHandler,
  resyncAllDeliverablesHandler,
  completeProjectWeekHandler,
  realignDeliverableDatesHandler,
  deduplicateProjectTasksHandler,
  pruneOverdueTasksHandler
} from '../controllers/productionController.js';
import { authenticate, authorizeRole } from '../middleware/auth.js';

const router = express.Router();

// Seed Live Data from Excel
router.post('/seed-live-data', authenticate, authorizeRole('superadmin', 'administrator'), seedAgencyDataHandler);

// Clear All Workspace Data (Superadmin only)
router.post('/clear-workspace-data', authenticate, authorizeRole('superadmin', 'administrator'), clearWorkspaceDataHandler);

// Notifications
router.get('/notifications', getNotifications);
router.put('/notifications/:id/read', markNotificationRead);
router.delete('/notifications/:id', clearNotifications);
router.delete('/notifications', clearNotifications);

// Projects
router.get('/projects', getProjects);
router.get('/projects/:id', getProjectById);
router.post('/projects', authenticate, createProject);
router.put('/projects/:id', authenticate, updateProject);
router.put('/projects/:id/progress', authenticate, updateProjectProgress);
router.post('/projects/:id/daily-log', authenticate, logProjectDailyStatus);
router.post('/projects/:id/complete-week', authenticate, completeProjectWeekHandler);
router.post('/projects/:id/sync-tasks', authenticate, syncProjectTasksHandler);
router.post('/projects/:id/realign-dates', authenticate, realignDeliverableDatesHandler);
router.post('/projects/:id/deduplicate-tasks', authenticate, deduplicateProjectTasksHandler);
router.post('/projects/:id/prune-overdue-tasks', authenticate, pruneOverdueTasksHandler);
router.post('/projects/prune-all-overdue-tasks', authenticate, pruneOverdueTasksHandler);
router.post('/resync-deliverables', authenticate, resyncAllDeliverablesHandler);
router.post('/realign-dates', authenticate, realignDeliverableDatesHandler);
router.post('/tasks/deduplicate-all', authenticate, deduplicateProjectTasksHandler);
router.post('/tasks/prune-all-overdue', authenticate, pruneOverdueTasksHandler);
router.delete('/projects/:id', authenticate, deleteProject);

// Tasks
router.get('/tasks', getTasks);
router.post('/tasks', authenticate, createTask);
router.put('/tasks/:id', authenticate, updateTask);
router.put('/tasks/:id/status', authenticate, updateTaskStatus);
router.delete('/tasks/:id', authenticate, deleteTask);

// Milestones
router.get('/milestones', getMilestones);
router.post('/milestones', authenticate, createMilestone);
router.put('/milestones/:id/status', authenticate, updateMilestoneStatus);
router.delete('/milestones/:id', authenticate, deleteMilestone);

// Team
router.get('/team', getTeamMembers);
router.post('/team', authenticate, createTeamMember);
router.put('/team/:id', authenticate, updateTeamMember);
router.delete('/team/:id', authenticate, deleteTeamMember);

export default router;
