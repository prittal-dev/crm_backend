import express from 'express';
import {
  register,
  login,
  googleLogin,
  verifyEmail,
  forgotPassword,
  resetPassword,
  getMe,
  updateProfile,
  setDepartment,
  setRole,
  resetAllData,
  getAllUsers,
  createUserByAdmin,
  editUser,
  deleteUser,
  getAuditLogs
} from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Public auth routes
router.post('/register', register);
router.post('/login', login);
router.post('/google', googleLogin);
router.post('/verify-email', verifyEmail);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/reset-all-data', resetAllData);

// Authenticated user profile routes
router.get('/me', authenticate, getMe);
router.put('/profile', authenticate, updateProfile);
router.put('/department', authenticate, setDepartment);
router.put('/role', authenticate, setRole);

// Hierarchical user management routes
router.get('/users', authenticate, getAllUsers);
router.post('/users', authenticate, createUserByAdmin);
router.put('/users/:id', authenticate, editUser);
router.delete('/users/:id', authenticate, deleteUser);
router.get('/audit-logs', authenticate, getAuditLogs);

export default router;
