import express from 'express';
import {
  getDocuments,
  createDocument,
  deleteDocument
} from '../controllers/documentsController.js';
import { authenticate } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = express.Router();

router.get('/', getDocuments);
router.post('/', authenticate, upload.single('file'), createDocument);
router.delete('/:id', authenticate, deleteDocument);

export default router;
