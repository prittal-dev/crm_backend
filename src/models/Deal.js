import mongoose from 'mongoose';

const dealSchema = new mongoose.Schema(
  {
    customId: { type: String, unique: true },
    dealCode: { type: String, required: true, unique: true, uppercase: true, trim: true }, // e.g. DL-2026-0001
    clientId: { type: String, required: true },
    clientName: { type: String, default: '' },
    brandName: { type: String, default: '' },
    title: { type: String, required: true },
    ownerId: { type: String, required: true },
    ownerName: { type: String, default: '' },
    planId: { type: String, default: '' },
    planSnapshot: { type: mongoose.Schema.Types.Mixed, default: null }, // Frozen plan snapshot JSON at sale
    customLineItems: [
      {
        description: { type: String, required: true },
        quantity: { type: Number, default: 1 },
        unitPrice: { type: Number, default: 0 },
        amount: { type: Number, default: 0 }
      }
    ],
    discountType: {
      type: String,
      enum: ['percentage', 'fixed'],
      default: 'fixed'
    },
    discountValue: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 },
    gstPercent: { type: Number, default: 18 },
    gstAmount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    expectedCloseDate: { type: String, default: '' },
    status: {
      type: String,
      enum: [
        'Draft',
        'Proposal Sent',
        'Negotiation',
        'Payment Pending',
        'Partially Paid',
        'Paid',
        'Converted',
        'Lost',
        'On Hold'
      ],
      default: 'Draft'
    },
    lostReason: { type: String, default: '' },
    websiteUrl: { type: String, default: '' },
    domainAccount: { type: String, default: 'Our Account' },
    projectId: { type: String, default: null }, // Linked production project ID once converted
    documents: [
      {
        name: { type: String, required: true },
        type: { type: String, enum: ['PDF', 'PI'], required: true },
        fileUrl: { type: String, default: '' },
        version: { type: Number, default: 1 },
        generatedAt: { type: Date, default: Date.now },
        htmlContent: { type: String, default: '' }
      }
    ],
    activity: [
      {
        actor: { type: String, default: 'System' },
        from: { type: String, default: '' },
        to: { type: String, default: '' },
        time: { type: Date, default: Date.now },
        note: { type: String, default: '' }
      }
    ]
  },
  { timestamps: true }
);

dealSchema.index({ customId: 1 });
dealSchema.index({ status: 1 });
dealSchema.index({ stage: 1 });
dealSchema.index({ clientId: 1 });
dealSchema.index({ assignedTo: 1 });
dealSchema.index({ createdAt: -1 });

dealSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret.customId || ret._id.toString();
    return ret;
  }
});

export const Deal = mongoose.model('Deal', dealSchema);
