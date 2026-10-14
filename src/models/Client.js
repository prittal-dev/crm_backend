import mongoose from "mongoose";

const contactSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    roleTitle: { type: String, default: "Primary Contact" },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    isPrimary: { type: Boolean, default: false }
  },
  { _id: true }
);

const addressSchema = new mongoose.Schema(
  {
    street: { type: String, default: "" },
    area: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    postalCode: { type: String, default: "" },
    country: { type: String, default: "India" }
  },
  { _id: false }
);

const clientSchema = new mongoose.Schema(
  {
    customId: { type: String, unique: true },
    companyName: { type: String, required: true },
    displayName: { type: String, default: "" },
    brandName: { type: String, default: "" },
    area: { type: String, default: "" },
    type: {
      type: String,
      enum: ["Individual", "Company", "Agency"],
      default: "Company"
    },
    industry: { type: String, default: "" },
    gstin: { type: String, default: "", uppercase: true, trim: true },
    pan: { type: String, default: "", uppercase: true, trim: true },
    billingAddress: { type: addressSchema, default: () => ({}) },
    shippingAddress: { type: addressSchema, default: () => ({}) },
    website: { type: String, default: "" },
    source: {
      type: String,
      enum: ["Inbound", "Referral", "Cold", "Website", "Other"],
      default: "Inbound"
    },
    ownerId: { type: String, default: "" },
    ownerName: { type: String, default: "" },
    status: {
      type: String,
      enum: ["Lead", "Active", "Customer", "Inactive"],
      default: "Lead"
    },
    contacts: { type: [contactSchema], default: [] },
    notes: { type: String, default: "" },
    isArchived: { type: Boolean, default: false },

    // Legacy fields for backward compatibility with existing components
    company: { type: String },
    contact: { type: String, default: "" },
    projects: { type: String, default: "" },
    services: { type: String, default: "" },
    revenue: { type: String, default: "₹0" },
    paymentStatus: {
      type: String,
      enum: ["paid", "pending", "overdue", "cancelled"],
      default: "pending"
    },
    manager: { type: String, default: "" },

    // Client Portal Access Credentials & Status
    portalAccess: {
      enabled: { type: Boolean, default: false },
      username: { type: String, default: "", trim: true },
      email: { type: String, default: "", trim: true },
      phone: { type: String, default: "", trim: true },
      passwordHash: { type: String, default: "" },
      tempPassword: { type: String, default: "" },
      lastLogin: { type: Date, default: null }
    }
  },
  { timestamps: true }
);

// Pre-save middleware to keep company, companyName, displayName, and brandName in sync
clientSchema.pre("save", function (next) {
  if (this.displayName && !this.brandName) {
    this.brandName = this.displayName;
  } else if (this.brandName && !this.displayName) {
    this.displayName = this.brandName;
  }
  if (this.companyName && !this.company) {
    this.company = this.companyName;
  } else if (this.company && !this.companyName) {
    this.companyName = this.company;
  }
  if (this.contacts && this.contacts.length > 0) {
    const primary = this.contacts.find((c) => c.isPrimary) || this.contacts[0];
    if (primary && primary.name) {
      this.contact = primary.name;
    }
  }
  next();
});

clientSchema.set("toJSON", {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret.customId || ret._id.toString();
    ret.company = ret.companyName || ret.company;
    ret.companyName = ret.companyName || ret.company;
    ret.displayName = ret.displayName || ret.brandName || '';
    ret.brandName = ret.brandName || ret.displayName || '';
    if (ret.portalAccess && ret.portalAccess.passwordHash) {
      delete ret.portalAccess.passwordHash;
    }
    return ret;
  }
});

export const Client = mongoose.model("Client", clientSchema);
