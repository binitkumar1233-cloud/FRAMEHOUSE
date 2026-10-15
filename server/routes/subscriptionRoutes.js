const crypto = require("crypto");
const express = require("express");
const mongoose = require("mongoose");

const Transaction = require("../models/Transaction");
const User = require("../models/User");
const auth = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { PLANS, PLAN_ORDER, CYCLES, POLICIES, featureRows } = require("../config/plans");
const service = require("../services/subscriptionService");
const { invoiceHtml, planName } = require("../services/emailTemplates");
const { quotaSummary } = require("../services/downloadService");

const router = express.Router();

const handle = (fn) =>
  asyncHandler(async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (error) {
      if (error instanceof service.SubscriptionError) {
        return res.status(error.status).json({ success: false, code: error.code, message: error.message });
      }
      throw error;
    }
  });

const serializeTxn = (txn) => ({
  id: txn._id.toString(),
  invoiceNumber: txn.invoiceNumber || null,
  plan: planName(txn.plan),
  cycle: txn.cycle || "monthly",
  action: txn.action || "new",
  amount: txn.amount,
  listPrice: txn.listPrice ?? txn.amount,
  credit: txn.credit || 0,
  currency: txn.currency || "INR",
  status: txn.status,
  failureReason: txn.failureReason || null,
  mode: txn.mode || "razorpay",
  orderId: txn.razorpayOrderId || txn.stripeSessionId || null,
  paymentId: txn.razorpayPaymentId || null,
  method: txn.method || null,
  periodStart: txn.periodStart || null,
  periodEnd: txn.periodEnd || null,
  createdAt: txn.createdAt,
  paidAt: txn.paidAt || null,
  emailSent: Boolean(txn.emailSentAt),
});

const statusPayload = async (user) => {
  const state = service.subscriptionState(user);
  const [usage, downloads] = await Promise.all([service.usageFor(user, state), quotaSummary(user)]);
  return { ...state, usage, downloads };
};

// ============================================================
// PUBLIC: plans and comparison
// ============================================================

router.get("/plans", (req, res) => {
  res.json({
    success: true,
    order: PLAN_ORDER,
    cycles: CYCLES,
    plans: PLAN_ORDER.map((name) => ({
      name,
      tagline: PLANS[name].tagline,
      popular: Boolean(PLANS[name].popular),
      prices: PLANS[name].prices,
      limits: PLANS[name].limits,
    })),
    features: featureRows(),
    policies: POLICIES,
  });
});

// Razorpay server-to-server notifications. Configure the URL
// https://<your-api>/api/subscription/webhook in the Razorpay dashboard with
// RAZORPAY_WEBHOOK_SECRET. Catches payments whose browser never reported back.
router.post(
  "/webhook",
  handle(async (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];
    if (!secret || !signature || !req.rawBody) return res.status(400).json({ success: false });

    const expected = crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
    if (!service.safeEqual(expected, signature)) return res.status(400).json({ success: false });

    const payment = req.body?.payload?.payment?.entity;
    const txn = payment?.order_id ? await Transaction.findOne({ razorpayOrderId: payment.order_id }) : null;

    if (txn && ["payment.captured", "order.paid"].includes(req.body.event) && Number(payment.amount) === Math.round(txn.amount * 100)) {
      await service.activateTransaction(txn._id, { paymentId: payment.id, via: "webhook", method: payment.method });
    } else if (txn && req.body.event === "payment.failed" && txn.status === "created") {
      await Transaction.updateOne({ _id: txn._id, status: "created" }, { $set: { status: "failed", failureReason: payment.error_description || "Payment failed" } });
    }

    res.json({ success: true });
  })
);

router.get("/providers", (req, res) => {
  res.json({ success: true, providers: service.availableProviders() });
});

// Stripe server-to-server notifications. Configure
// https://<your-api>/api/subscription/stripe-webhook in Stripe with STRIPE_WEBHOOK_SECRET.
router.post(
  "/stripe-webhook",
  handle(async (req, res) => {
    const client = service.stripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const signature = req.headers["stripe-signature"];
    if (!client || !secret || !signature || !req.rawBody) return res.status(400).json({ success: false });

    let event;
    try {
      event = client.webhooks.constructEvent(req.rawBody, signature, secret);
    } catch {
      return res.status(400).json({ success: false });
    }

    const session = event.data?.object;
    if (session?.id && ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
      try {
        await service.settleStripeSession(session.id, { via: "webhook" });
      } catch (error) {
        if (!(error instanceof service.SubscriptionError)) throw error;
        console.warn("[payments] Stripe webhook not applied:", error.message);
      }
    } else if (session?.id && event.type === "checkout.session.expired") {
      await Transaction.updateOne({ stripeSessionId: session.id, status: "created" }, { $set: { status: "expired", failureReason: "Checkout expired" } });
    }

    res.json({ success: true });
  })
);

router.use(auth);

// ============================================================
// STATUS
// ============================================================

router.get(
  "/me",
  handle(async (req, res) => {
    res.json({ success: true, subscription: await statusPayload(req.user) });
  })
);

// Kept for older parts of the app: null when on Free.
router.get(
  "/my-subscription",
  handle(async (req, res) => {
    const state = service.subscriptionState(req.user);
    res.json({
      success: true,
      subscription: state.active
        ? { plan: state.plan, cycle: state.cycle, status: state.status, startDate: state.startDate, expiryDate: state.expiryDate }
        : null,
    });
  })
);

router.get(
  "/billing",
  handle(async (req, res) => {
    const transactions = await Transaction.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ success: true, transactions: transactions.map(serializeTxn) });
  })
);

router.get(
  "/invoice/:id",
  handle(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: "Invoice not found" });
    const txn = await Transaction.findOne({ _id: req.params.id, user: req.user._id, status: "paid" }).lean();
    if (!txn || !txn.invoiceNumber) return res.status(404).json({ success: false, message: "Invoice not found" });
    res.type("html").send(invoiceHtml(req.user, txn));
  })
);

// ============================================================
// CHECKOUT
// ============================================================

router.get(
  "/quote",
  handle(async (req, res) => {
    res.json({ success: true, quote: await service.quote(req.user, req.query.plan, req.query.cycle) });
  })
);

router.post(
  "/checkout",
  handle(async (req, res) => {
    const q = await service.quote(req.user, req.body?.plan, req.body?.cycle);
    const { txn, reused } = await service.createOrder(req.user, q);

    res.status(reused ? 200 : 201).json({
      success: true,
      reused,
      mode: txn.mode,
      keyId: txn.mode === "razorpay" ? process.env.RAZORPAY_KEY_ID : null,
      order: { id: txn.razorpayOrderId, amount: Math.round(txn.amount * 100), currency: txn.currency },
      transaction: serializeTxn(txn),
      quote: q,
      prefill: { name: req.user.name, email: req.user.email },
    });
  })
);

router.post(
  "/checkout/stripe",
  handle(async (req, res) => {
    const q = await service.quote(req.user, req.body?.plan, req.body?.cycle);
    const { url } = await service.createStripeSession(req.user, q);
    res.status(201).json({ success: true, url });
  })
);

// Called when Stripe sends the customer back to the site.
router.post(
  "/stripe/confirm",
  handle(async (req, res) => {
    const sessionId = req.body?.sessionId;
    if (!sessionId || typeof sessionId !== "string" || !sessionId.startsWith("cs_")) {
      return res.status(400).json({ success: false, code: "incomplete", message: "Payment details are incomplete." });
    }
    const result = await service.settleStripeSession(sessionId, { userId: req.user._id, via: "checkout" });
    const user = await User.findById(req.user._id);
    res.json({ success: true, alreadyProcessed: result.alreadyProcessed, transaction: serializeTxn(result.txn), subscription: await statusPayload(user) });
  })
);

router.post(
  "/checkout/upi",
  handle(async (req, res) => {
    const upiId = process.env.UPI_ID;
    if (!upiId) return res.status(503).json({ success: false, code: "payments-unavailable", message: "UPI payments aren't available right now." });

    const q = await service.quote(req.user, req.body?.plan, req.body?.cycle);
    let txn = await Transaction.findOne({
      user: req.user._id,
      mode: "upi",
      status: "created",
      plan: q.plan,
      cycle: q.cycle,
      amount: q.amount,
      createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) },
    });
    if (!txn) {
      txn = await Transaction.create({
        user: req.user._id,
        plan: q.plan,
        cycle: q.cycle,
        action: q.action,
        amount: q.amount,
        listPrice: q.listPrice,
        credit: q.credit,
        currency: q.currency,
        mode: "upi",
        status: "created",
        periodStart: q.periodStart,
        periodEnd: q.periodEnd,
      });
    }

    const payee = process.env.UPI_PAYEE_NAME || "Framehouse";
    const note = `Framehouse ${q.plan}`;
    const link = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payee)}&am=${q.amount}&cu=INR&tn=${encodeURIComponent(note)}`;
    res.status(201).json({ success: true, transactionId: txn._id.toString(), upiId, payee, amount: q.amount, link, note });
  })
);

// The customer says they've paid and gives the UPI reference (UTR). An admin approves it.
router.post(
  "/upi/submit",
  handle(async (req, res) => {
    const { transactionId } = req.body || {};
    const utr = String(req.body?.utr || "").trim().toUpperCase();
    if (!mongoose.isValidObjectId(transactionId)) return res.status(404).json({ success: false, message: "Payment order not found." });
    if (!/^[A-Z0-9]{8,30}$/.test(utr)) {
      return res.status(400).json({ success: false, code: "invalid-reference", message: "Enter the UPI reference / UTR number from your payment app (8-30 letters and digits)." });
    }

    const txn = await Transaction.findOne({ _id: transactionId, user: req.user._id, mode: "upi" });
    if (!txn) return res.status(404).json({ success: false, message: "Payment order not found." });
    if (txn.status === "paid") return res.json({ success: true, transaction: serializeTxn(txn) });

    if (await Transaction.exists({ upiReference: utr, _id: { $ne: txn._id } })) {
      return res.status(409).json({ success: false, code: "duplicate-reference", message: "This reference number was already submitted." });
    }

    txn.upiReference = utr;
    txn.razorpayPaymentId = `upi_${utr}`;
    txn.status = "pending";
    txn.failureReason = undefined;
    await txn.save();
    res.json({ success: true, transaction: serializeTxn(txn), message: "Thanks! We'll activate your plan as soon as the payment is verified." });
  })
);

const requireAdmin = (req, res, next) =>
  req.user?.role === "admin" ? next() : res.status(403).json({ success: false, message: "Admin access required" });

router.get(
  "/admin/upi",
  requireAdmin,
  handle(async (req, res) => {
    const items = await Transaction.find({ mode: "upi", status: "pending" }).sort({ createdAt: 1 }).limit(100).populate("user", "name email").lean();
    res.json({
      success: true,
      payments: items.map((t) => ({
        id: t._id.toString(),
        user: t.user ? { name: t.user.name, email: t.user.email } : null,
        plan: t.plan,
        cycle: t.cycle,
        amount: t.amount,
        reference: t.upiReference,
        createdAt: t.createdAt,
      })),
    });
  })
);

router.post(
  "/admin/upi/:id/approve",
  requireAdmin,
  handle(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: "Not found" });
    const txn = await Transaction.findOne({ _id: req.params.id, mode: "upi", status: "pending" });
    if (!txn) return res.status(404).json({ success: false, message: "Pending payment not found." });
    await service.activateTransaction(txn._id, { paymentId: `upi_${txn.upiReference}`, signature: "upi", via: "admin", method: "upi" });
    res.json({ success: true });
  })
);

router.post(
  "/admin/upi/:id/reject",
  requireAdmin,
  handle(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: "Not found" });
    await Transaction.updateOne({ _id: req.params.id, mode: "upi", status: "pending" }, { $set: { status: "failed", failureReason: "UPI payment couldn't be verified" } });
    res.json({ success: true });
  })
);

const findUserTxn = async (userId, orderId) => {
  if (!orderId || typeof orderId !== "string") return null;
  return Transaction.findOne({ user: userId, razorpayOrderId: orderId });
};

// Called by Razorpay Checkout's success handler.
router.post(
  "/verify",
  handle(async (req, res) => {
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ success: false, code: "incomplete", message: "Payment details are incomplete." });
    }

    const txn = await findUserTxn(req.user._id, orderId);
    if (!txn || txn.mode !== "razorpay") return res.status(404).json({ success: false, code: "not-found", message: "Payment order not found." });

    if (txn.status === "paid") {
      return res.json({ success: true, alreadyProcessed: true, transaction: serializeTxn(txn), subscription: await statusPayload(req.user) });
    }

    if (!service.verifySignature(orderId, paymentId, signature)) {
      await service.markTransaction(req.user._id, orderId, "failed", "Signature verification failed");
      return res.status(400).json({ success: false, code: "verification-failed", message: "We couldn't verify this payment. If money was taken, it will be refunded by Razorpay." });
    }

    const check = await service.confirmWithRazorpay(txn, paymentId);
    if (!check.ok) {
      await service.markTransaction(req.user._id, orderId, "failed", check.reason);
      return res.status(400).json({ success: false, code: "verification-failed", message: `Payment couldn't be confirmed: ${check.reason}.` });
    }

    const result = await service.activateTransaction(txn._id, { paymentId, signature, via: "checkout", method: check.method });
    const user = await User.findById(req.user._id);
    res.json({ success: true, alreadyProcessed: result.alreadyProcessed, transaction: serializeTxn(result.txn), subscription: await statusPayload(user) });
  })
);

// Built-in test checkout (only with ALLOW_DEMO_PAYMENTS=true).
router.post(
  "/test-pay",
  handle(async (req, res) => {
    if (!service.testPaymentsAllowed()) return res.status(404).json({ success: false, message: "Not found" });

    const { orderId, outcome, method = "card" } = req.body || {};
    const txn = await findUserTxn(req.user._id, orderId);
    if (!txn || txn.mode !== "test") return res.status(404).json({ success: false, code: "not-found", message: "Payment order not found." });

    if (txn.status === "paid") {
      return res.json({ success: true, alreadyProcessed: true, transaction: serializeTxn(txn), subscription: await statusPayload(req.user) });
    }

    if (outcome !== "success") {
      await service.markTransaction(req.user._id, orderId, "failed", "Test payment declined");
      return res.status(402).json({ success: false, code: "declined", message: "Payment declined. No money was taken and your plan hasn't changed." });
    }

    const paymentId = `test_pay_${crypto.randomBytes(7).toString("hex")}`;
    const result = await service.activateTransaction(txn._id, { paymentId, signature: "test", via: "test", method: String(method).slice(0, 20) });
    const user = await User.findById(req.user._id);
    res.json({ success: true, alreadyProcessed: result.alreadyProcessed, transaction: serializeTxn(result.txn), subscription: await statusPayload(user) });
  })
);

// Razorpay Checkout reported a failed attempt (the order stays open for a retry).
router.post(
  "/payment-failed",
  handle(async (req, res) => {
    const { orderId, reason } = req.body || {};
    await service.markTransaction(req.user._id, orderId, "failed", reason || "Payment failed");
    res.json({ success: true });
  })
);

// The user closed the checkout without paying.
router.post(
  "/payment-cancelled",
  handle(async (req, res) => {
    const txn = await findUserTxn(req.user._id, req.body?.orderId);
    if (txn && txn.status === "created") await Transaction.updateOne({ _id: txn._id, status: "created" }, { $set: { status: "cancelled", failureReason: "Checkout closed before paying" } });
    res.json({ success: true });
  })
);

// Picks up payments that completed but never reported back (tab closed, network lost).
router.post(
  "/reconcile",
  handle(async (req, res) => {
    const applied = await service.reconcileUser(req.user._id);
    const user = await User.findById(req.user._id);
    res.json({ success: true, applied, subscription: await statusPayload(user) });
  })
);

// ============================================================
// CANCEL / RESUME / DOWNGRADE
// ============================================================

router.post(
  "/cancel",
  handle(async (req, res) => {
    const user = await service.cancelAtPeriodEnd(req.user, "Free");
    res.json({ success: true, subscription: await statusPayload(user) });
  })
);

router.post(
  "/resume",
  handle(async (req, res) => {
    const user = await service.resume(req.user);
    res.json({ success: true, subscription: await statusPayload(user) });
  })
);

router.post(
  "/downgrade",
  handle(async (req, res) => {
    const plan = service.normalizePlan(req.body?.plan);
    const user = plan === "Free" ? await service.cancelAtPeriodEnd(req.user, "Free") : await service.scheduleDowngrade(req.user, plan);
    res.json({ success: true, subscription: await statusPayload(user) });
  })
);

module.exports = router;
