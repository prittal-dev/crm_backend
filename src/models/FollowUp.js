import mongoose from 'mongoose';

const followUpSchema = new mongoose.Schema(
  {
    customId: { type: String, unique: true },
    client: { type: String, required: true },
    type: { type: String, default: 'Call' },
    date: { type: String, default: () => new Date().toISOString().split('T')[0] },
    time: { type: String, default: '10:00 AM' },
    assignedTo: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'completed'],
      default: 'pending'
    },
    notes: { type: String, default: '' },
    leadId: { type: String, default: '' },
    completionRemark: { type: String, default: '' },
    outcomeStatus: { type: String, default: '' },
    planSold: { type: Boolean, default: false },
    soldPlanName: { type: String, default: '' },
    dealValue: { type: Number, default: 0 },
    paymentNote: { type: String, default: '' },
    completedBy: { type: String, default: '' },
    completedDate: { type: String, default: '' },
    completedAt: { type: Date }
  },
  { timestamps: true }
);

followUpSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret.customId || ret._id.toString();
    return ret;
  }
});

export const FollowUp = mongoose.model('FollowUp', followUpSchema);
