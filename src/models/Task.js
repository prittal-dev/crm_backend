import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema(
  {
    customId: { type: String, unique: true },
    slotKey: { type: String, default: '', index: true },
    name: { type: String, required: true },
    projectId: { type: String, default: 'proj1' },
    taskType: { 
      type: String, 
      default: 'creative' 
    },
    weekNumber: { type: Number, default: 1 },
    assignedToId: { type: String, default: '' },
    assignedTo: { type: String, default: '' },
    assignedBy: { type: String, default: '' },
    accountManager: { type: String, default: '' },
    description: { type: String, default: '' },
    priority: {
      type: String,
      default: 'medium'
    },
    dueDate: { type: String, default: '' },
    completedDate: { type: String, default: '' },
    deliveredCount: { type: Number, default: 1 },
    deliveryLink: { type: String, default: '' },
    publishUrl: { type: String, default: '' },
    publishedDate: { type: String, default: '' },
    publishPlatform: { type: String, default: '' },
    publishedCreator: { type: String, default: '' },
    publishRemarks: { type: String, default: '' },
    remarks: { type: String, default: '' },
    delayReason: { type: String, default: '' },
    isDelayed: { type: Boolean, default: false },
    startedAt: { type: String, default: '' },
    workStartedAt: { type: String, default: '' },
    submittedAt: { type: String, default: '' },
    completedAt: { type: String, default: '' },
    timeSpentMinutes: { type: Number, default: 0 },
    timeSpentFormatted: { type: String, default: '' },
    accumulatedSeconds: { type: Number, default: 0 },
    revisionNotes: { type: String, default: '' },
    reviewedBy: { type: String, default: '' },
    isClientHandled: { type: Boolean, default: false },
    clientApprovalStatus: {
      type: String,
      enum: ['pending', 'approved', 'changes_requested', 'not_required'],
      default: 'pending'
    },
    clientFeedback: {
      comment: { type: String, default: '' },
      submittedAt: { type: Date, default: null }
    },
    status: {
      type: String,
      default: 'todo'
    },
    monthNumber: { type: Number, default: 1 },
    isCustomMoved: { type: Boolean, default: false },
    originalDueDate: { type: String, default: '' },
    originalWeekNumber: { type: Number },
    isRolledOver: { type: Boolean, default: false },
    isFixedDate: { type: Boolean, default: false },
    isLocked: { type: Boolean, default: false },
    fixedDateReason: { type: String, default: '' },
    festivalDescription: { type: String, default: '' },
    history: [
      {
        action: { type: String, required: true },
        performedBy: { type: String, default: 'System' },
        performedByRole: { type: String, default: 'member' },
        performedById: { type: String, default: '' },
        timestamp: { type: Date, default: Date.now },
        details: { type: String, default: '' },
        previousValue: { type: mongoose.Schema.Types.Mixed },
        newValue: { type: mongoose.Schema.Types.Mixed },
        changes: { type: mongoose.Schema.Types.Mixed, default: {} }
      }
    ]
  },
  { timestamps: true }
);

taskSchema.index({ projectId: 1, createdAt: -1 });
taskSchema.index({ projectId: 1, monthNumber: 1, weekNumber: 1 });
taskSchema.index({ projectId: 1, status: 1 });
taskSchema.index({ assignedTo: 1 });
taskSchema.index({ assignedToId: 1, status: 1, dueDate: 1 });
taskSchema.index({ status: 1 });
taskSchema.index({ dueDate: 1 });
taskSchema.index({ createdAt: -1 });

taskSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret.customId || ret._id.toString();
    return ret;
  }
});

export const Task = mongoose.model('Task', taskSchema);
