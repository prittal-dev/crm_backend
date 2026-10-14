import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema(
  {
    customId: { type: String, unique: true },
    name: { type: String, required: true },
    folder: {
      type: String,
      enum: ['Contracts', 'Financials', 'Technical', 'Assets'],
      default: 'Assets'
    },
    size: { type: String, default: '1.0 MB' },
    uploadedBy: { type: String, default: '' },
    date: { type: String, default: () => new Date().toISOString().split('T')[0] },
    filePath: { type: String, default: null },
    mimeType: { type: String, default: null },
    projectId: { type: String, default: null },
    clientId: { type: String, default: null },
    dealId: { type: String, default: null },
    docType: { type: String, default: 'document' },
    dataSnapshot: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  { timestamps: true }
);

documentSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret.customId || ret._id.toString();
    return ret;
  }
});

export const Document = mongoose.model('Document', documentSchema);
