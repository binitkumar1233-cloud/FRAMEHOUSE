const mongoose = require("mongoose");

// One payment attempt (a Razorpay order) and, once paid, its invoice.
const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Older records store lowercase names; new ones use "Bronze" etc.
    plan: {
      type: String,
      enum: ["bronze", "silver", "gold", "Bronze", "Silver", "Gold"],
      required: true,
    },
    cycle: {
      type: String,
      enum: ["monthly", "quarterly", "yearly"],
      default: "monthly",
    },
    // What this payment does to the subscription.
    action: {
      type: String,
      enum: ["new", "renew", "upgrade"],
      default: "new",
    },

    // Amounts in rupees. amount = listPrice - credit.
    amount: {
      type: Number,
      required: true,
    },
    listPrice: Number,
    credit: { type: Number, default: 0 },
    currency: {
      type: String,
      default: "INR",
    },

    // "razorpay" for real checkout, "test" for the built-in test checkout.
    mode: {
      type: String,
      enum: ["razorpay", "test"],
      default: "razorpay",
    },
    razorpayOrderId: { type: String, index: true },
    razorpayPaymentId: String,
    razorpaySignature: String,
    method: String,

    status: {
      type: String,
      enum: ["created", "paid", "failed", "cancelled", "expired", "refunded"],
      default: "created",
      index: true,
    },
    failureReason: String,

    invoiceNumber: { type: String, index: true, sparse: true },
    paidAt: Date,
    // How the payment was confirmed: checkout callback, webhook, reconciliation or test.
    verifiedVia: {
      type: String,
      enum: ["checkout", "webhook", "reconcile", "test"],
    },

    // Subscription period this payment bought.
    periodStart: Date,
    periodEnd: Date,
    // Set when an upgrade replaced this period, so its value isn't credited twice.
    supersededAt: { type: Date, default: null },

    emailSentAt: Date,
    emailError: String,
  },
  { timestamps: true }
);

transactionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("Transaction", transactionSchema);
