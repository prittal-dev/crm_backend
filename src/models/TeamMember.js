import mongoose from 'mongoose';

const teamMemberSchema = new mongoose.Schema(
  {
    customId: { type: String, unique: true },
    name: { type: String, required: true },
    department: { type: String, default: 'Production' },
    role: { type: String, default: 'Member' },
    workload: { type: Number, default: 0 },
    availability: {
      type: String,
      enum: ['Available', 'Busy', 'OOF'],
      default: 'Available'
    },
    performance: { type: Number, default: 90 }
  },
  { timestamps: true }
);

teamMemberSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret.customId || ret._id.toString();
    return ret;
  }
});

export const TeamMember = mongoose.model('TeamMember', teamMemberSchema);
