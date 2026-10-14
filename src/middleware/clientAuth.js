import jwt from 'jsonwebtoken';
import { Client } from '../models/Client.js';
import { Project } from '../models/Project.js';

const JWT_SECRET = process.env.JWT_SECRET || 'crm_secret_key_production_grade_jwt_2026';

export const authenticateClient = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'client') {
      return res.status(403).json({ success: false, message: 'Access denied. Client account required.' });
    }

    let clientEntity = null;
    let projectEntity = null;

    // Search by client ID
    if (decoded.clientId || decoded.id) {
      clientEntity = await Client.findOne({
        $or: [
          { customId: decoded.clientId || decoded.id },
          { _id: decoded.id }
        ]
      });

      projectEntity = await Project.findOne({
        $or: [
          { customId: decoded.projectId || decoded.clientId || decoded.id },
          { _id: decoded.id }
        ]
      });
    }

    if (!clientEntity && !projectEntity) {
      return res.status(401).json({ success: false, message: 'Client account not found or access revoked.' });
    }

    // Attach client profile context
    req.client = {
      id: decoded.id,
      clientId: decoded.clientId || clientEntity?.customId || projectEntity?.clientId || projectEntity?.customId,
      projectId: decoded.projectId || projectEntity?.customId || null,
      companyName: decoded.companyName || clientEntity?.companyName || projectEntity?.companyName || 'Client',
      brandName: decoded.brandName || clientEntity?.brandName || projectEntity?.brandName || '',
      email: decoded.email || clientEntity?.portalAccess?.email || projectEntity?.clientEmail || '',
      phone: decoded.phone || clientEntity?.portalAccess?.phone || projectEntity?.clientPhone || '',
      isClient: true
    };

    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Session expired or invalid. Please login again.' });
  }
};
