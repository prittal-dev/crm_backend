import mongoose from 'mongoose';

const salesContractSchema = new mongoose.Schema(
  {
    customId: { type: String, unique: true, required: true },
    srNo: { type: Number, default: 0 },
    month: { type: String, default: '' },
    year: { type: Number, default: 2026 },
    dateOfSales: { type: String, default: '' },
    dateOfLogin: { type: String, default: '' },
    branch: { type: String, default: 'Rohini' },
    area: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    pinCode: { type: String, default: '' },
    soldBy: { type: String, default: '' },
    companyName: { type: String, required: true },
    brandName: { type: String, default: '' },

    // Editable Commercial & Pricing Section
    fullContractValue: { type: Number, default: 0 },
    amountReleasedWithGst: { type: Number, default: 0 },
    amountReleasedWithoutGst: { type: Number, default: 0 },
    amountReleasedAfterTds: { type: Number, default: 0 },
    balancePayment: { type: Number, default: 0 },
    salePercentage: { type: String, default: '' },
    saleAmount: { type: Number, default: 0 },
    gstPercent: { type: Number, default: 18 },
    gstAmount: { type: Number, default: 0 },
    tdsPercent: { type: Number, default: 0 },
    tdsAmount: { type: Number, default: 0 },
    totalPayable: { type: Number, default: 0 },
    paymentType: { type: String, enum: ['Full', 'Partial', 'full', 'partial'], default: 'Full' },

    hasGst: { type: Boolean, default: null },

    // Commercial Terms & Invoicing
    invoiceNumber: { type: String, default: '' },
    paymentCycle: { type: String, default: 'Monthly' },
    durationOfContract: { type: String, default: '1 year' },
    modeOfPayment: { type: String, default: 'UPI' },
    paymentRefNo: { type: String, default: '' },
    balancePaymentDate: { type: String, default: '' },
    renewalFromDate: { type: String, default: '' },
    renewalDate: { type: String, default: '' },
    gstNumber: { type: String, default: '', uppercase: true, trim: true },
    tds: { type: String, default: 'NA' },
    tanNumber: { type: String, default: 'NA' },
    contractType: { type: String, default: 'ANNUALY' },
    vertical: { type: String, default: 'PRITTAL' },
    typeOfServices: { type: String, default: 'SMO' },
    plan: { type: String, default: '' },
    planPrice: { type: Number, default: null },
    customerName: { type: String, default: '' },
    customerPhone: { type: String, default: '' },
    companyAddress: { type: String, default: '' },
    email: { type: String, default: '' },
    closingType: { type: String, default: 'Self closure' },
    servicesBrief: { type: String, default: '' },
    remarks: { type: String, default: '' },
    websiteUrl: { type: String, default: '' },
    domainAccount: { type: String, default: 'Our Account' },
    domainProvider: { type: String, default: '' },
    domainPurchaseDate: { type: String, default: '' },
    domainDurationYears: { type: Number, default: 1 },
    deliverablesQuota: { type: Object, default: null },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },

    // Automated Renewals
    autoRenewalConfig: {
      active: { type: Boolean, default: false },
      originalDuration: { type: String, default: '' },
      maxCycles: { type: Number, default: 0 },
      currentCycle: { type: Number, default: 0 },
      parentContractId: { type: String, default: null }
    },

    // Settlement Payments History (Pending balance payments recorded)
    settlements: [
      {
        amount: { type: Number, default: 0 },
        paymentMode: { type: String, default: '' },
        paymentRefNo: { type: String, default: '' },
        paymentDate: { type: String, default: '' },
        invoiceNumber: { type: String, default: '' },
        notes: { type: String, default: '' },
        createdAt: { type: Date, default: Date.now }
      }
    ],

    // Linked Entities in CRM
    clientId: { type: String, default: null },
    projectId: { type: String, default: null },
    dealId: { type: String, default: null }
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Ensure 0% GST for cash / m-cash / m-upi payment modes when GST was not explicitly added
salesContractSchema.pre('save', function (next) {
  const payMode = String(this.modeOfPayment || '').toLowerCase();
  const isCashLike = (payMode.includes('cash') || payMode.includes('m-upi')) && !payMode.includes('gst');
  const hasGstin = Boolean(this.gstNumber && String(this.gstNumber).trim().length >= 15 && String(this.gstNumber).trim().toUpperCase() !== 'NA');
  const explicitGstFlag = this.hasGst === true;

  if (isCashLike && !hasGstin && !explicitGstFlag) {
    // If no explicit GST, enforce 0% GST
    if (this.gstPercent === 18 || !this.gstPercent) {
      this.gstPercent = 0;
      this.gstAmount = 0;
      this.totalPayable = Math.max(0, (this.fullContractValue || 0) - (this.tdsAmount || 0));
      if (this.amountReleasedWithGst > 0 && (!this.amountReleasedWithoutGst || this.amountReleasedWithoutGst < this.amountReleasedWithGst)) {
        this.amountReleasedWithoutGst = this.amountReleasedWithGst;
      }
      if (this.balancePayment !== undefined && this.balancePayment !== null) {
        this.balancePayment = Math.max(0, this.totalPayable - (this.amountReleasedWithGst || 0));
        this.paymentType = this.balancePayment === 0 ? 'Full' : 'Partial';
      }
    }
  }
  next();
});

// Virtual aliases for compatibility across UI components
salesContractSchema.virtual('salesDate').get(function() { return this.dateOfSales; });
salesContractSchema.virtual('loginDate').get(function() { return this.dateOfLogin; });
salesContractSchema.virtual('contractDuration').get(function() { return this.durationOfContract; });
salesContractSchema.virtual('paymentMode').get(function() { return this.modeOfPayment; });
salesContractSchema.virtual('paymentReferenceNumber').get(function() { return this.paymentRefNo; });
salesContractSchema.virtual('balanceDate').get(function() { return this.balancePaymentDate; });
salesContractSchema.virtual('gstin').get(function() { return this.gstNumber; });
salesContractSchema.virtual('tan').get(function() { return this.tanNumber; });
salesContractSchema.virtual('services').get(function() { return this.typeOfServices; });
salesContractSchema.virtual('customerAddress').get(function() { return this.companyAddress; });
salesContractSchema.virtual('customerEmail').get(function() { return this.email; });

salesContractSchema.index({ projectId: 1, isDeleted: 1, isActive: 1 });
salesContractSchema.index({ clientId: 1 });
salesContractSchema.index({ customId: 1 });
salesContractSchema.index({ companyName: 1 });
salesContractSchema.index({ brandName: 1 });
salesContractSchema.index({ dateOfSales: -1 });

export const SalesContract = mongoose.model('SalesContract', salesContractSchema);
export default SalesContract;
