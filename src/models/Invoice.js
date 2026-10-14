import mongoose from "mongoose";

const invoiceSchema = new mongoose.Schema(
  {
    customId: { type: String, unique: true },
    client: { type: String, required: true },
    amount: { type: String, default: "₹0" },
    dueDate: { type: String, default: "" },
    date: {
      type: String,
      default: () => new Date().toISOString().split("T")[0],
    },
    status: {
      type: String,
      enum: ["paid", "pending", "overdue"],
      default: "pending",
    },
  },
  { timestamps: true },
);

invoiceSchema.set("toJSON", {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret.customId || ret._id.toString();
    return ret;
  },
});

export const Invoice = mongoose.model("Invoice", invoiceSchema);
