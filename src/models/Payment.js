import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema(
  {
    customId: { type: String, unique: true },
    dealId: { type: String, required: true },
    dealCode: { type: String, default: '' },
    clientId: { type: String, required: true },
    clientName: { type: String, default: '' },
    amount: { type: Number, required: true }, // In INR
    mode: {
      type: String,
      enum: ['UPI', 'NEFT', 'Razorpay', 'Cheque', 'Cash', 'Other'],
      default: 'UPI'
    },
    reference: { type: String, default: '' }, // UTR, transaction ID or cheque number
    paidOn: {
      type: String,
      default: () => new Date().toISOString().split('T')[0]
    },
    proofUrl: { type: String, default: '' },
    recordedBy: { type: String, default: '' },
    recordedById: { type: String, default: '' },
    notes: { type: String, default: '' }
  },
  { timestamps: true }
);

paymentSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret.customId || ret._id.toString();
    return ret;
  }
});

export const Payment = mongoose.model('Payment', paymentSchema);
