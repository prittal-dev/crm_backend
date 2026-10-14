import mongoose from 'mongoose';

const milestoneSchema = new mongoose.Schema(
  {
    customId: { type: String, unique: true },
    projectId: { type: String, required: true },
    title: { type: String, required: true },
    status: {
      type: String,
      enum: ['upcoming', 'in-progress', 'completed', 'blocked'],
      default: 'upcoming'
    }
  },
  { timestamps: true }
);

milestoneSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret.customId || ret._id.toString();
    return ret;
  }
});

export const Milestone = mongoose.model('Milestone', milestoneSchema);
