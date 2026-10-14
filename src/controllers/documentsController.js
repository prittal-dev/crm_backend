import { Document } from '../models/Document.js';
import { broadcastRealtimeUpdate } from '../services/realtimeService.js';
import mongoose from 'mongoose';
import path from 'path';
import fs from 'fs';

const findByIdOrCustomId = (id) => {
  if (mongoose.isValidObjectId(id)) {
    return { $or: [{ _id: id }, { customId: id }] };
  }
  return { customId: id };
};

export const getDocuments = async (req, res, next) => {
  try {
    const { folder } = req.query;
    const query = folder ? { folder } : {};
    const docs = await Document.find(query).sort({ createdAt: -1 });
    res.json({ success: true, data: docs });
  } catch (err) {
    next(err);
  }
};

export const createDocument = async (req, res, next) => {
  try {
    let name = req.body.name;
    let size = req.body.size || '1.0 MB';
    let folder = req.body.folder || 'Assets';
    let filePath = null;
    let mimeType = null;

    if (req.file) {
      name = name || req.file.originalname;
      const sizeInMB = (req.file.size / (1024 * 1024)).toFixed(1);
      size = sizeInMB < 0.1 ? `${Math.round(req.file.size / 1024)} KB` : `${sizeInMB} MB`;
      filePath = `/uploads/${req.file.filename}`;
      mimeType = req.file.mimetype;
    }

    if (!name) {
      return res.status(400).json({ success: false, message: 'Document name or file is required.' });
    }

    const newDoc = await Document.create({
      customId: 'doc_' + Math.random().toString(36).substring(2, 9),
      name,
      folder,
      size,
      uploadedBy: req.user?.name || req.body.uploadedBy || '',
      date: new Date().toISOString().split('T')[0],
      filePath,
      mimeType
    });

    broadcastRealtimeUpdate('DOCUMENT_UPDATED', { document: newDoc });
    res.status(201).json({ success: true, message: `Document uploaded: ${newDoc.name}`, data: newDoc });
  } catch (err) {
    next(err);
  }
};

export const deleteDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doc = await Document.findOne(findByIdOrCustomId(id));
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }

    if (doc.filePath) {
      const fullPath = path.join(process.cwd(), doc.filePath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }

    await Document.deleteOne({ _id: doc._id });
    broadcastRealtimeUpdate('DOCUMENT_DELETED', { id });
    res.json({ success: true, message: 'Document deleted.' });
  } catch (err) {
    next(err);
  }
};
