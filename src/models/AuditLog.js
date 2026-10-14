import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    customId: { type: String, unique: true },
    action: { type: String, required: true },
    category: { type: String, default: 'Security & Access' },
    performedBy: { type: String, required: true },
    performedByRole: { type: String, default: 'superadmin' },
    targetUser: { type: String, default: null },
    targetUserId: { type: String, default: null },
    details: { type: String, required: true },
    changes: { type: mongoose.Schema.Types.Mixed, default: {} },
    ipAddress: { type: String, default: '127.0.0.1' },
    timestamp: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

auditLogSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret.customId || ret._id.toString();
    return ret;
  }
});

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
