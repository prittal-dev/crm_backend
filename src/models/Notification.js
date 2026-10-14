import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    customId: { type: String, unique: true },
    userId: { type: String, required: true }, // customId, username, or email of the recipient employee
    recipientName: { type: String, default: '' },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: {
      type: String,
      enum: ['task_assigned', 'task_completed', 'milestone', 'followup', 'lead_new', 'proposal_accepted', 'invoice_paid', 'system', 'deliverable_submitted'],
      default: 'task_assigned'
    },
    relatedId: { type: String, default: '' },
    isRead: { type: Boolean, default: false },
    clearedBy: { type: [String], default: [] },
    createdAtStr: { type: String, default: () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ recipientName: 1, createdAt: -1 });
notificationSchema.index({ createdAt: -1 });

notificationSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret.customId || ret._id.toString();
    return ret;
  }
});

export const Notification = mongoose.model('Notification', notificationSchema);
