import mongoose from 'mongoose';

const proposalSchema = new mongoose.Schema(
  {
    customId: { type: String, unique: true },
    company: { type: String, required: true },
    contact: { type: String, default: '' },
    title: { type: String, default: '' },
    amount: { type: String, default: '₹0' },
    date: { type: String, default: () => new Date().toISOString().split('T')[0] },
    status: {
      type: String,
      enum: ['draft', 'sent', 'accepted', 'rejected', 'expired'],
      default: 'draft'
    }
  },
  { timestamps: true }
);

proposalSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret.customId || ret._id.toString();
    return ret;
  }
});

export const Proposal = mongoose.model('Proposal', proposalSchema);
