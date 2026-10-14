import mongoose from "mongoose";

const leadSchema = new mongoose.Schema(
  {
    customId: { type: String, unique: true },
    company: { type: String, required: true }, // Business Name
    date: { type: String, default: () => new Date().toISOString().split('T')[0] },
    area: { type: String, default: "" },
    category: { type: String, default: "Manufacturer" }, // Manufacturer, Trader, Other
    type: { type: String, default: "Shoes" }, // Shoes, Toys, Machinery, Bags, Jewellery Box, Utensils, Cosmetic, Other
    contactPerson: { type: String, default: "" },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    address: { type: String, default: "" },
    gmbRating: { type: String, default: "" },
    reviews: { type: String, default: "" },
    url: { type: String, default: "" },
    websiteExist: { type: String, default: "Yes" }, // Yes, No
    websiteStatus: { type: String, default: "Medium" }, // Excellent, Good, Medium, Poor, No
    instagram: { type: String, default: "No" }, // Yes, No, Error
    facebook: { type: String, default: "No" }, // Yes, No, Error
    linkedin: { type: String, default: "No" }, // Yes, No, Error
    youtube: { type: String, default: "No" }, // Yes, No, Error
    socialActivities: { type: String, default: "Not Active" }, // Very Active, Active, Last 3 Month, Not Active
    service: { type: String, default: "" }, // Service to pitch details
    serviceCategory: { type: String, default: "Lead Generation" }, // Website Design, Lead Generation, SMO & Social Media, Generic, Other
    chances: { type: String, default: "High" }, // High, Medium, Low
    assignedTo: { type: String, default: "" }, // Assigned caller
    assignedCallerId: { type: String, default: "" }, // Proper ID of assigned caller
    callerId: { type: String, default: "" }, // Caller ID
    assignedDate: { type: String, default: "" }, // Date when caller was assigned
    callingDate: { type: String, default: "" },
    calledBy: { type: String, default: "" }, // Manish, Rahul, Nidhi, etc.
    calledById: { type: String, default: "" }, // Proper ID of calledBy caller
    createdBy: { type: String, default: "" }, // Sales Admin or user who created lead
    createdById: { type: String, default: "" }, // Creator user ID
    creatorRole: { type: String, default: "" }, // Creator role
    callStatus: { type: String, default: "Interested" }, // Interested, Not Interested, Not Reachable, Not Answered, Wrong Number, Completed, Failed, Other
    remark: { type: String, default: "" },
    budget: { type: String, default: "₹0" },
    source: { type: String, default: "Cold Calling" },
    assignedMember: { type: String, default: "" },
    assignedMemberId: { type: String, default: "" },
    status: {
      type: String,
      enum: [
        "lead",
        "followup",
        "meeting",
        "proposal",
        "negotiation",
        "won",
        "lost",
      ],
      default: "lead",
    },
  },
  { timestamps: true, strict: false },
);

// Pre-validation hook: Ensure social presence consistency & auto-compute tailored pitch
leadSchema.pre("validate", function (next) {
  const hasSocial = [this.instagram, this.facebook, this.linkedin, this.youtube].some(
    (x) => String(x || "").toLowerCase() === "yes"
  );

  // 1. Social consistency: If no social media exists, socialActivities MUST be "Not Active"
  if (!hasSocial) {
    this.socialActivities = "Not Active";
  } else if (!this.socialActivities || this.socialActivities === "Not Active") {
    this.socialActivities = "Active";
  }

  // 2. Automated Smart Pitch Calculation if empty or generic 'Lead Generation'
  const currentService = (this.service || "").trim();
  if (!currentService || currentService.toLowerCase() === "lead generation" || currentService === "--") {
    const hasWebsite = String(this.websiteExist || "").toLowerCase() === "yes";
    const revCount = parseInt(this.reviews, 10) || 0;

    if (!hasWebsite && !hasSocial) {
      this.service = "Website Design + Social Media Management + GMB Optimization + Review Generation";
      this.serviceCategory = "Website Design";
      if (!this.remark) {
        this.remark = "No website or social presence found. Pitch complete online identity setup, responsive website and Google review generation.";
      }
    } else if (!hasWebsite && hasSocial) {
      this.service = "Website Design + Social Media Setup + Paid Promotions + Review Generation";
      this.serviceCategory = "Website Design";
      if (!this.remark) {
        this.remark = "Active on social channels but has no official website. High opportunity for business catalogue website and lead funnels.";
      }
    } else if (hasWebsite && !hasSocial) {
      this.service = "Social Media Setup + Paid Promotions + Review Generation";
      this.serviceCategory = "SMO & Social Media";
      if (!this.remark) {
        this.remark = "Website exists but social platforms are missing. Pitch social media branding, Meta ad campaigns, and Google review generation.";
      }
    } else if (hasWebsite && hasSocial && revCount < 30) {
      this.service = "Social Media Setup + Paid Promotions + GMB Optimization + Review Generation";
      this.serviceCategory = "Lead Generation";
      if (!this.remark) {
        this.remark = "Digital presence exists. High value in pitching Google Maps ranking, review acceleration and local lead generation.";
      }
    } else {
      this.service = "Paid Promotions + Review Generation";
      this.serviceCategory = "Lead Generation";
      if (!this.remark) {
        this.remark = "Established brand presence. Pitch performance ads, review generation and scale-up marketing.";
      }
    }
  }

  next();
});

leadSchema.set("toJSON", {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret.customId || ret._id.toString();
    return ret;
  },
});

export const Lead = mongoose.model("Lead", leadSchema);
