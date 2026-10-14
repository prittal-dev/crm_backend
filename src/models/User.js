import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    customId: { type: String, unique: true },
    username: { type: String, sparse: true, trim: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    department: { type: String, default: 'Production' },
    designation: { type: String, default: 'Member' },
    role: { 
      type: String, 
      default: 'member' 
    },
    createdBy: { type: String, default: null },
    phone: { type: String, default: '' },
    isVerified: { type: Boolean, default: true },
    verificationCode: { type: String, default: null }
  },
  { timestamps: true }
);

userSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret.customId || ret._id.toString();
    delete ret.passwordHash;
    return ret;
  }
});

export const User = mongoose.model('User', userSchema);
