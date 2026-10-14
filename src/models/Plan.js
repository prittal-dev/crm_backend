import mongoose from 'mongoose';

const planSchema = new mongoose.Schema(
  {
    customId: { type: String, unique: true },
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: '' },
    billingType: {
      type: String,
      enum: ['One-time', 'Monthly', 'Yearly', 'Milestone'],
      default: 'Monthly'
    },
    basePrice: { type: Number, required: true, default: 0 }, // in INR
    gstPercent: { type: Number, default: 18 },
    includes: { type: [String], default: [] },
    deliverablesQuota: {
      creatives: { type: Number, default: 0 },
      carousels: { type: Number, default: 0 },
      aiReels: { type: Number, default: 0 },
      basicReels: { type: Number, default: 0 },
      longVideos: { type: Number, default: 0 },
      festival: { type: Boolean, default: false },
      blogs: { type: Number, default: 0 },
      gmb: { type: Boolean, default: false },
      keywords: { type: Number, default: 0 },
      platforms: { type: Number, default: 0 },
      stories: { type: Number, default: 0 },
      highlights: { type: Number, default: 0 },
      products: { type: Number, default: 0 },
      photos: { type: Number, default: 0 },
      videos: { type: Number, default: 0 },
      adTypes: { type: String, default: '' },
      adSpendLimit: { type: String, default: '' },
      summary: { type: String, default: '' }
    },
    content: {
      creatives: { type: Number, default: 4 },
      carousels: { type: Number, default: 0 },
      shorts: { type: Number, default: 4 },
      aiVideos: { type: Number, default: 0 },
      longVideos: { type: Number, default: 0 },
      festivalContent: { type: Number, default: 1 },
      blogs: { type: Number, default: 0 }
    },
    category: { 
      type: String, 
      enum: ['Website', 'SEO', 'Social Media', 'Paid Campaigns', 'Product Shoots', 'Google My Business', 'General'],
      default: 'Social Media' 
    },
    popular: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    productionTemplateId: { type: String, default: '' }
  },
  { timestamps: true }
);

planSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret.customId || ret._id.toString();
    return ret;
  }
});

export const Plan = mongoose.model('Plan', planSchema);
