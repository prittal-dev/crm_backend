import mongoose from "mongoose";

const projectSchema = new mongoose.Schema(
  {
    customId: { type: String, unique: true },
    name: { type: String, required: true },
    companyName: { type: String, required: true },
    brandName: { type: String, default: "" },
    clientName: { type: String, default: "" },
    clientPhone: { type: String, default: "" },
    clientEmail: { type: String, default: "" },
    clientAddress: {
      street: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      postalCode: { type: String, default: "" },
      country: { type: String, default: "India" }
    },
    clientId: { type: String, default: "" },
    whatsappGroupName: { type: String, default: "" },
    client: { type: String, default: "" },
    services: { type: [String], default: ["SMO"] },
    salesTeam: { type: [String], default: [] },
    accountManager: { type: String, default: "Unassigned" },
    graphicDesigner: { type: String, default: "Unassigned" },
    videoEditor: { type: String, default: "Unassigned" },
    productionManager: { type: String, default: "Unassigned" },
    uiUxDesigner: { type: String, default: "Unassigned" },
    frontendDeveloper: { type: String, default: "Unassigned" },
    backendDeveloper: { type: String, default: "Unassigned" },
    webDeveloper: { type: String, default: "Unassigned" },
    assignedMembers: { type: [String], default: [] },
    salesDate: {
      type: String,
      default: () => new Date().toISOString().split("T")[0],
    },
    handoverDate: {
      type: String,
      default: () => new Date().toISOString().split("T")[0],
    },
    startDate: {
      type: String,
      default: () => new Date().toISOString().split("T")[0],
    },
    taskStartDate: {
      type: String,
      default: () => new Date().toISOString().split("T")[0],
    },
    deadline: { type: String, default: "" },
    renewalDate: { type: String, default: "" },
    nextRenewalDate: { type: String, default: "" },
    renewalStatus: { type: String, default: "NEW" },
    planDuration: {
      type: String,
      default: "MONTHLY",
    },
    deliverablesQuota: {
      creatives: { type: Number, default: 4 },
      carousels: { type: Number, default: 0 },
      aiReels: { type: Number, default: 4 },
      basicReels: { type: Number, default: 0 },
      longVideos: { type: Number, default: 0 },
      festival: { type: Boolean, default: true },
      blogs: { type: Number, default: 0 },
      gmb: { type: Boolean, default: false },
    },
    content: {
      creatives: { type: Number, default: 4 },
      carousels: { type: Number, default: 0 },
      shorts: { type: Number, default: 4 },
      aiVideos: { type: Number, default: 0 },
      longVideos: { type: Number, default: 0 },
      festivalContent: { type: Number, default: 1 },
      blogs: { type: Number, default: 0 },
    },
    social: {
      facebook: { type: String, default: "" },
      instagram: { type: String, default: "" },
      linkedin: { type: String, default: "" },
      twitter: { type: String, default: "" },
      youtube: { type: String, default: "" },
      whatsapp: { type: String, default: "" },
      website: { type: String, default: "" },
    },
    websiteUrl: { type: String, default: "" },
    domainAccount: {
      type: String,
      enum: ["Our Account", "Client Account", "Not Applicable", ""],
      default: "Our Account"
    },
    domainProvider: { type: String, default: "" },
    domainPurchaseDate: { type: String, default: "" },
    domainDurationYears: { type: Number, default: 1 },
    hostingAccount: {
      type: String,
      enum: ["Our Account", "Client Account", "Not Applicable", ""],
      default: "Our Account"
    },
    dailyLogs: [
      {
        date: { type: String, required: true },
        dayName: { type: String, default: "" },
        status: { type: String, default: "N/A" },
        postType: { type: String, default: "creative" },
        postUrl: { type: String, default: "" },
        creator: { type: String, default: "" },
        taskId: { type: String, default: "" },
        remarks: { type: String, default: "" },
        pendingReason: { type: String, default: "" },
        loggedBy: { type: String, default: "Team Member" },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
    weeklyDeliveries: [
      {
        weekNum: { type: Number, default: 1 },
        status: { type: String, default: "WEEKLY DELIVERY COMPLETED" },
        remarks: { type: String, default: "" },
        pendingReason: { type: String, default: "" },
      },
    ],
    monthlyReportStatus: { type: String, default: "PENDING" },
    finalRemarks: { type: String, default: "" },
    activity: [
      {
        date: { type: String },
        event: { type: String },
      },
    ],
    manager: { type: String, default: "Unassigned" },
    members: { type: [String], default: [] },
    budget: { type: String, default: "₹25,000" },
    progress: { type: Number, default: 50 },
    status: {
      type: String,
      enum: ["planning", "active", "review", "completed", "on-hold", "cancelled", "paused", "inactive"],
      default: "active",
    },

    // Sales Handoff and AM Staffing Integration Fields
    sourceDealId: { type: String, default: null },
    soldPlanName: { type: String, default: "" },
    soldPlanCode: { type: String, default: "" },
    planSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    handoffStatus: {
      type: String,
      enum: [
        "Awaiting Admin Assignment",
        "Awaiting Team Assignment",
        "Team Assigned",
        "In Production",
      ],
      default: "In Production", // Default for legacy/manually created projects
    },
    assignedAmId: { type: String, default: null },
    assignedAmName: { type: String, default: "" },
    assignedAmAt: { type: Date, default: null },
    assignedByAdminId: { type: String, default: null },
    assignedByAdminName: { type: String, default: "" },
    teamAssignments: [
      {
        userId: { type: String, required: true },
        userName: { type: String, default: "" },
        roleOnProject: { type: String, default: "Team Member" },
        allocatedHours: { type: Number, default: 0 },
        taskDescription: { type: String, default: "" },
        responsibleFor: {
          type: [String],
          enum: [
            "creative", "carousel", "reel", "festival", "blog", "general",
            "web_design", "web_development", "content_upload", "website_qa", "deployment",
            "keyword_research", "seo_audit", "on_page_seo", "off_page_seo", "seo_reporting",
            "shoot_planning", "photography", "photo_editing", "video_shoot", "video_editing", "shoot_delivery"
          ],
          default: [],
        },
      },
    ],
    kickoffNotes: { type: String, default: "" },
    weekPreset: { type: mongoose.Schema.Types.Mixed, default: null },

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
  { timestamps: true },
);

projectSchema.index({ createdAt: -1 });
projectSchema.index({ status: 1 });
projectSchema.index({ brandName: 1 });
projectSchema.index({ companyName: 1 });
projectSchema.index({ clientId: 1 });
projectSchema.index({ assignedAmId: 1 });

projectSchema.set("toJSON", {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret.customId || ret._id.toString();
    if (ret.portalAccess && ret.portalAccess.passwordHash) {
      delete ret.portalAccess.passwordHash;
    }
    return ret;
  },
});

export const Project = mongoose.model("Project", projectSchema);
