const crypto = require("crypto");
const Razorpay = require("razorpay");

const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Subscription = require("../models/Subscription");
const Counter = require("../models/Counter");
const WatchUsage = require("../models/WatchUsage");
const PremiumUnlock = require("../models/PremiumUnlock");
const {
  PLANS,
  PAID_PLANS,
  CYCLES,
  RENEW_MAX_AHEAD_MONTHS,
  REMINDER_DAYS_BEFORE,
  ORDER_REUSE_MINUTES,
  rankOf,
} = require("../config/plans");
const { TIMEZONE } = require("../config/downloadPlans");
const { periodInfo } = require("../utils/periods");
const { sendMail } = require("./mailer");
const templates = require("./emailTemplates");

const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================
// HELPERS
// ============================================================

class SubscriptionError extends Error {
  constructor(message, status = 400, code = "invalid") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const normalizePlan = (plan) => {
  const name = String(plan || "");
  const capitalized = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  return PLANS[capitalized] ? capitalized : null;
};

// Adds months, keeping the day of month where possible (31 Jan + 1 month = 28/29 Feb).
const addMonths = (from, months) => {
  const date = new Date(from);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date;
};

let razorpayClient;
const razorpay = () => {
  if (razorpayClient !== undefined) return razorpayClient;
  razorpayClient =
    process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
      ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
      : null;
  return razorpayClient;
};

const testPaymentsAllowed = () => process.env.ALLOW_DEMO_PAYMENTS === "true";

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

// ============================================================
// STATE
// ============================================================

/** What the user has right now. A paid plan past its expiry counts as Free. */
const subscriptionState = (user, now = new Date()) => {
  const storedPlan = normalizePlan(user.subscriptionPlan) || "Free";
  const expiry = user.subscriptionExpiry ? new Date(user.subscriptionExpiry) : null;
  const active = PAID_PLANS.includes(storedPlan) && Boolean(expiry) && expiry > now;
  const plan = active ? storedPlan : "Free";

  let status = "none";
  if (active) status = user.subscriptionStatus === "cancelled" ? "cancelled" : "active";
  else if (PAID_PLANS.includes(storedPlan) || user.subscriptionStatus === "expired" || user.previousPlan) status = "expired";

  return {
    plan,
    cycle: active ? user.subscriptionCycle || "monthly" : null,
    status,
    active,
    startDate: active ? user.subscriptionStart : null,
    expiryDate: active ? expiry : null,
    lastPlan: active ? null : user.previousPlan || (PAID_PLANS.includes(storedPlan) ? storedPlan : null),
    lastExpiredAt: !active && expiry ? expiry : null,
    daysRemaining: active ? Math.max(0, Math.ceil((expiry - now) / DAY_MS)) : 0,
    nextRenewalDate: active && status === "active" ? expiry : null,
    cancelAtPeriodEnd: status === "cancelled",
    pendingPlan: user.pendingPlan || null,
    limits: PLANS[plan].limits,
  };
};

const usageFor = async (user, state = subscriptionState(user)) => {
  const periods = periodInfo(TIMEZONE);
  const [watch, unlocks] = await Promise.all([
    WatchUsage.findOne({ user: user._id, dayKey: periods.dayKey }).lean(),
    PremiumUnlock.countDocuments({ user: user._id, monthKey: periods.monthKey }),
  ]);
  const limits = state.limits;
  const watchLimit = limits.dailyWatchMinutes === null ? null : limits.dailyWatchMinutes * 60;
  const watched = Math.floor(watch?.seconds || 0);

  return {
    watch: {
      usedSeconds: watched,
      limitSeconds: watchLimit,
      remainingSeconds: watchLimit === null ? null : Math.max(0, watchLimit - watched),
      resetsAt: periods.dayResetsAt,
    },
    premiumUnlocks: {
      used: unlocks,
      limit: limits.premiumVideosPerMonth,
      remaining: limits.premiumVideosPerMonth === null ? null : Math.max(0, limits.premiumVideosPerMonth - unlocks),
      resetsAt: periods.monthResetsAt,
    },
  };
};

// ============================================================
// PRICING
// ============================================================

/** Unused value of the current paid plan, used as credit on upgrade. */
const unusedCredit = async (user, state, now = new Date()) => {
  if (!state.active) return 0;

  const periods = await Transaction.find({
    user: user._id,
    status: "paid",
    periodEnd: { $gt: now },
    supersededAt: null,
  }).lean();

  let credit = 0;
  for (const txn of periods) {
    if (normalizePlan(txn.plan) !== state.plan || !txn.periodStart) continue;
    const length = new Date(txn.periodEnd) - new Date(txn.periodStart);
    const left = new Date(txn.periodEnd) - Math.max(now, new Date(txn.periodStart));
    if (length > 0 && left > 0) credit += (txn.listPrice ?? txn.amount) * (left / length);
  }

  // Older subscriptions have no recorded period: they were 30-day monthly plans.
  if (!periods.length) {
    const left = Math.min(new Date(state.expiryDate) - now, 30 * DAY_MS);
    credit = PLANS[state.plan].prices.monthly * (left / (30 * DAY_MS));
  }

  return Math.max(0, Math.floor(credit));
};

/** Works out what buying `plan` on `cycle` means for this user, and what it costs. */
const quote = async (user, planInput, cycleInput, now = new Date()) => {
  const plan = normalizePlan(planInput);
  const cycle = String(cycleInput || "monthly");

  if (!plan || !PAID_PLANS.includes(plan)) throw new SubscriptionError("Choose Bronze, Silver or Gold.", 400, "invalid-plan");
  if (!CYCLES[cycle]) throw new SubscriptionError("Choose a monthly, quarterly or yearly plan.", 400, "invalid-cycle");

  const state = subscriptionState(user, now);
  const listPrice = PLANS[plan].prices[cycle];
  const months = CYCLES[cycle].months;

  if (!state.active) {
    return { plan, cycle, action: "new", listPrice, credit: 0, amount: listPrice, currency: "INR", periodStart: now, periodEnd: addMonths(now, months) };
  }

  if (plan === state.plan) {
    const periodStart = new Date(state.expiryDate);
    const periodEnd = addMonths(periodStart, months);
    if (periodEnd > addMonths(now, RENEW_MAX_AHEAD_MONTHS)) {
      throw new SubscriptionError("Your plan is already paid well in advance. You can renew again closer to the end date.", 409, "renew-limit");
    }
    return { plan, cycle, action: "renew", listPrice, credit: 0, amount: listPrice, currency: "INR", periodStart, periodEnd };
  }

  if (rankOf(plan) < rankOf(state.plan)) {
    throw new SubscriptionError(`You're on ${state.plan}. Downgrades take effect when your current plan ends. Use "Downgrade" on your subscription page.`, 409, "downgrade");
  }

  const credit = await unusedCredit(user, state, now);
  if (credit >= listPrice) {
    throw new SubscriptionError("Your remaining credit covers this whole period. Choose a longer billing period to upgrade.", 409, "credit-exceeds-price");
  }

  return { plan, cycle, action: "upgrade", listPrice, credit, amount: listPrice - credit, currency: "INR", periodStart: now, periodEnd: addMonths(now, months) };
};

// ============================================================
// ORDERS
// ============================================================

const createOrder = async (user, q) => {
  // A repeated click or retry reuses the open order instead of creating a duplicate.
  const reusable = await Transaction.findOne({
    user: user._id,
    status: "created",
    plan: q.plan,
    cycle: q.cycle,
    amount: q.amount,
    action: q.action,
    createdAt: { $gte: new Date(Date.now() - ORDER_REUSE_MINUTES * 60 * 1000) },
  }).sort({ createdAt: -1 });
  if (reusable && (reusable.mode === "razorpay" || testPaymentsAllowed())) return { txn: reusable, reused: true };

  let mode = "razorpay";
  let orderId;
  const client = razorpay();

  try {
    if (!client) throw Object.assign(new Error("Razorpay keys missing"), { statusCode: 401 });
    const order = await client.orders.create({
      amount: Math.round(q.amount * 100),
      currency: q.currency,
      receipt: `fh_${user._id.toString().slice(-8)}_${Date.now()}`,
      notes: { userId: user._id.toString(), plan: q.plan, cycle: q.cycle, action: q.action },
    });
    orderId = order.id;
  } catch (error) {
    if (error?.statusCode === 401 && testPaymentsAllowed()) {
      console.error("[payments] Razorpay rejected the API keys; using test checkout (ALLOW_DEMO_PAYMENTS=true).");
      mode = "test";
      orderId = `test_order_${crypto.randomBytes(8).toString("hex")}`;
    } else if (error?.statusCode === 401) {
      console.error("[payments] Razorpay rejected RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET. Update them in server/.env and restart.");
      throw new SubscriptionError("Online payments aren't available right now. Please try again later.", 503, "payments-unavailable");
    } else {
      console.error("[payments] Order creation failed:", error?.error || error);
      throw new SubscriptionError("We couldn't start the payment. Check your connection and try again.", 502, "order-failed");
    }
  }

  const txn = await Transaction.create({
    user: user._id,
    plan: q.plan,
    cycle: q.cycle,
    action: q.action,
    amount: q.amount,
    listPrice: q.listPrice,
    credit: q.credit,
    currency: q.currency,
    mode,
    razorpayOrderId: orderId,
    status: "created",
    periodStart: q.periodStart,
    periodEnd: q.periodEnd,
  });

  return { txn, reused: false };
};

const verifySignature = (orderId, paymentId, signature) => {
  if (!process.env.RAZORPAY_KEY_SECRET) return false;
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqual(expected, signature);
};

/** Double-checks a payment with Razorpay's API: right order, right amount, money actually taken. */
const confirmWithRazorpay = async (txn, paymentId) => {
  const client = razorpay();
  if (!client) return { ok: true, unchecked: true };
  try {
    const payment = await client.payments.fetch(paymentId);
    if (payment.order_id !== txn.razorpayOrderId) return { ok: false, reason: "Payment belongs to a different order" };
    if (Number(payment.amount) !== Math.round(txn.amount * 100) || payment.currency !== txn.currency) return { ok: false, reason: "Payment amount doesn't match the order" };
    if (!["captured", "authorized"].includes(payment.status)) return { ok: false, reason: `Payment status is ${payment.status}` };
    return { ok: true, method: payment.method };
  } catch (error) {
    // The signature already proves Razorpay issued this payment; if their API
    // is briefly unreachable we don't block activation on the second check.
    console.warn("[payments] Couldn't fetch payment from Razorpay, relying on signature:", error?.error?.description || error?.message);
    return { ok: true, unchecked: true };
  }
};

// ============================================================
// STRIPE (hosted Checkout; redirects back to the site)
// ============================================================

let stripeClient;
const stripe = () => {
  if (stripeClient !== undefined) return stripeClient;
  stripeClient = process.env.STRIPE_SECRET_KEY ? require("stripe")(process.env.STRIPE_SECRET_KEY) : null;
  return stripeClient;
};

const clientBaseUrl = () =>
  (process.env.APP_URL || (process.env.CLIENT_URL || "http://localhost:5173").split(",")[0]).trim().replace(/\/+$/, "");

const availableProviders = () => ({
  razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
  stripe: Boolean(process.env.STRIPE_SECRET_KEY),
  upi: Boolean(process.env.UPI_ID),
  test: testPaymentsAllowed(),
});

const createStripeSession = async (user, q) => {
  const client = stripe();
  if (!client) throw new SubscriptionError("Card payments aren't available right now.", 503, "payments-unavailable");

  const txn = await Transaction.create({
    user: user._id,
    plan: q.plan,
    cycle: q.cycle,
    action: q.action,
    amount: q.amount,
    listPrice: q.listPrice,
    credit: q.credit,
    currency: q.currency,
    mode: "stripe",
    status: "created",
    periodStart: q.periodStart,
    periodEnd: q.periodEnd,
  });

  try {
    const session = await client.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      client_reference_id: txn._id.toString(),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: q.currency.toLowerCase(),
            unit_amount: Math.round(q.amount * 100),
            product_data: { name: `Framehouse ${q.plan} plan (${q.cycle})` },
          },
        },
      ],
      metadata: { txnId: txn._id.toString(), userId: user._id.toString() },
      success_url: `${clientBaseUrl()}/?stripe_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientBaseUrl()}/?stripe_cancelled=1`,
    });
    txn.stripeSessionId = session.id;
    await txn.save();
    return { txn, url: session.url };
  } catch (error) {
    await Transaction.updateOne({ _id: txn._id }, { $set: { status: "failed", failureReason: "Couldn't start Stripe checkout" } });
    console.error("[payments] Stripe session failed:", error?.message || error);
    throw new SubscriptionError("We couldn't start the payment. Please try again.", 502, "order-failed");
  }
};

/** Applies a Stripe Checkout Session to its transaction if (and only if) it was really paid. */
const settleStripeSession = async (sessionId, { userId, via }) => {
  const client = stripe();
  if (!client) throw new SubscriptionError("Card payments aren't available right now.", 503, "payments-unavailable");

  const session = await client.checkout.sessions.retrieve(sessionId);
  const txn = await Transaction.findOne({ stripeSessionId: session.id, mode: "stripe", ...(userId ? { user: userId } : {}) });
  if (!txn) throw new SubscriptionError("Payment order not found.", 404, "not-found");
  if (txn.status === "paid") return { txn, alreadyProcessed: true };

  if (session.payment_status !== "paid") {
    throw new SubscriptionError("This payment hasn't been completed.", 402, "not-paid");
  }
  if (Number(session.amount_total) !== Math.round(txn.amount * 100) || String(session.currency).toUpperCase() !== txn.currency) {
    throw new SubscriptionError("Payment amount doesn't match the order.", 400, "verification-failed");
  }

  return activateTransaction(txn._id, {
    paymentId: typeof session.payment_intent === "string" ? session.payment_intent : session.id,
    signature: "stripe",
    via,
    method: "card",
  });
};

// ============================================================
// ACTIVATION
// ============================================================

const nextInvoiceNumber = async () => {
  const year = new Date().getFullYear();
  const seq = await Counter.next(`invoice-${year}`);
  return `FH-${year}-${String(seq).padStart(6, "0")}`;
};

const sendPurchaseEmail = async (user, txn) => {
  const { subject, html, text } = templates.purchaseConfirmation(user, txn);
  const mail = {
    to: user.email,
    subject,
    html,
    text,
    attachments: [{ filename: `Invoice-${txn.invoiceNumber}.html`, content: templates.invoiceHtml(user, txn), contentType: "text/html" }],
  };

  // Retry transient mail failures before giving up.
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await sendMail(mail);
      await Transaction.updateOne({ _id: txn._id }, { $set: { emailSentAt: new Date() }, $unset: { emailError: "" } });
      return;
    } catch (error) {
      lastError = error;
      console.error(`[mail] Confirmation email failed (attempt ${attempt}/3):`, error.message);
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  await Transaction.updateOne({ _id: txn._id }, { $set: { emailError: lastError?.message || "Email failed" } });
};

/**
 * Marks a transaction paid and applies it to the subscription — exactly once.
 * Safe to call again for the same order (refresh, webhook + callback, retries).
 */
const activateTransaction = async (txnId, { paymentId, signature, via, method }) => {
  const now = new Date();

  const claimed = await Transaction.findOneAndUpdate(
    { _id: txnId, status: { $in: ["created", "pending", "failed", "cancelled", "expired"] } },
    {
      $set: {
        status: "paid",
        razorpayPaymentId: paymentId,
        razorpaySignature: signature,
        method,
        verifiedVia: via,
        paidAt: now,
      },
      $unset: { failureReason: "" },
    },
    { returnDocument: "after" }
  );

  if (!claimed) {
    const existing = await Transaction.findById(txnId);
    if (existing?.status === "paid") return { txn: existing, alreadyProcessed: true };
    throw new SubscriptionError("This payment can't be applied.", 409, "not-payable");
  }

  const plan = normalizePlan(claimed.plan);
  const months = CYCLES[claimed.cycle || "monthly"].months;
  let user;
  let periodStart;
  let periodEnd;
  let action = claimed.action;

  // Optimistic update: retry if the user's expiry changed underneath us
  // (e.g. two different renewals paid at the same moment).
  for (let attempt = 0; attempt < 5; attempt += 1) {
    user = await User.findById(claimed.user);
    const state = subscriptionState(user, now);

    if (state.active && state.plan === plan) {
      action = action === "upgrade" ? "upgrade" : "renew";
      periodStart = action === "upgrade" ? now : new Date(state.expiryDate);
    } else {
      if (state.active && rankOf(plan) > rankOf(state.plan)) action = "upgrade";
      periodStart = now;
    }
    periodEnd = addMonths(periodStart, months);

    const result = await User.updateOne(
      { _id: user._id, subscriptionExpiry: user.subscriptionExpiry ?? null },
      {
        $set: {
          subscriptionPlan: plan,
          subscriptionCycle: claimed.cycle || "monthly",
          subscriptionStart: action === "renew" && state.active ? user.subscriptionStart || periodStart : periodStart,
          subscriptionExpiry: periodEnd,
          subscriptionStatus: "active",
          pendingPlan: null,
          previousPlan: state.active ? user.previousPlan : state.lastPlan,
          reminderSentFor: null,
        },
      }
    );
    if (result.modifiedCount) break;
    if (attempt === 4) throw new SubscriptionError("Please try again in a moment.", 409, "busy");
  }

  if (action === "upgrade") {
    await Transaction.updateMany(
      { user: claimed.user, _id: { $ne: claimed._id }, status: "paid", periodEnd: { $gt: now }, supersededAt: null },
      { $set: { supersededAt: now } }
    );
  }

  const invoiceNumber = claimed.invoiceNumber || (await nextInvoiceNumber());
  const txn = await Transaction.findByIdAndUpdate(
    claimed._id,
    { $set: { plan, action, periodStart, periodEnd, invoiceNumber } },
    { returnDocument: "after" }
  );

  await Subscription.findOneAndUpdate(
    { user: claimed.user },
    {
      user: claimed.user,
      plan,
      amount: txn.amount,
      currency: txn.currency,
      razorpayOrderId: txn.razorpayOrderId,
      razorpayPaymentId: txn.razorpayPaymentId,
      razorpaySignature: txn.razorpaySignature,
      status: "paid",
      startDate: periodStart,
      expiryDate: periodEnd,
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  const freshUser = await User.findById(claimed.user);
  await sendPurchaseEmail(freshUser, txn);

  return { txn, alreadyProcessed: false };
};

const markTransaction = async (userId, orderId, status, reason) => {
  const txn = await Transaction.findOneAndUpdate(
    { user: userId, razorpayOrderId: orderId, status: { $in: ["created", "failed"] } },
    { $set: { status, ...(reason ? { failureReason: String(reason).slice(0, 300) } : {}) } },
    { returnDocument: "after" }
  );
  return txn;
};

// Looks for payments that went through but never reached us (tab closed,
// network dropped after paying) and applies them.
const reconcileUser = async (userId) => {
  const client = razorpay();
  const recent = await Transaction.find({
    user: userId,
    mode: "razorpay",
    status: { $in: ["created", "failed", "cancelled"] },
    createdAt: { $gte: new Date(Date.now() - DAY_MS) },
  });
  if (!client || !recent.length) return 0;

  let applied = 0;
  for (const txn of recent) {
    try {
      const { items = [] } = await client.orders.fetchPayments(txn.razorpayOrderId);
      const paid = items.find(
        (p) => ["captured", "authorized"].includes(p.status) && Number(p.amount) === Math.round(txn.amount * 100)
      );
      if (paid) {
        const result = await activateTransaction(txn._id, { paymentId: paid.id, via: "reconcile", method: paid.method });
        if (!result.alreadyProcessed) applied += 1;
      }
    } catch (error) {
      console.warn("[payments] Reconcile failed for", txn.razorpayOrderId, error?.error?.description || error.message);
    }
  }
  return applied;
};

// ============================================================
// CANCEL / RESUME / DOWNGRADE
// ============================================================

const cancelAtPeriodEnd = async (user, pendingPlan = "Free") => {
  const state = subscriptionState(user);
  if (!state.active) throw new SubscriptionError("You don't have an active paid plan.", 409, "not-active");
  user.subscriptionStatus = "cancelled";
  user.pendingPlan = pendingPlan;
  await user.save();
  sendMail({ to: user.email, ...templates.cancellationConfirmation(user) }).catch((error) => console.error("[mail] Cancellation email failed:", error.message));
  return user;
};

const resume = async (user) => {
  const state = subscriptionState(user);
  if (!state.active) throw new SubscriptionError("This plan has already ended. Choose a plan to subscribe again.", 409, "not-active");
  user.subscriptionStatus = "active";
  user.pendingPlan = null;
  await user.save();
  return user;
};

const scheduleDowngrade = async (user, planInput) => {
  const plan = normalizePlan(planInput);
  const state = subscriptionState(user);
  if (!state.active) throw new SubscriptionError("You don't have an active paid plan.", 409, "not-active");
  if (!plan || rankOf(plan) >= rankOf(state.plan)) throw new SubscriptionError("Choose a plan lower than your current one.", 400, "invalid-plan");
  return cancelAtPeriodEnd(user, plan);
};

// ============================================================
// SCHEDULED JOBS: expiry, reminders, abandoned orders
// ============================================================

const runSubscriptionJobs = async (now = new Date()) => {
  const report = { expired: 0, reminded: 0, abandoned: 0 };

  // Move ended plans to Free. Watch history and other data are untouched.
  const ended = await User.find({ subscriptionPlan: { $in: PAID_PLANS }, subscriptionExpiry: { $lte: now } });
  for (const user of ended) {
    const plan = user.subscriptionPlan;
    const result = await User.updateOne(
      { _id: user._id, subscriptionPlan: plan, subscriptionExpiry: user.subscriptionExpiry },
      { $set: { subscriptionPlan: "Free", previousPlan: plan, subscriptionStatus: "expired", subscriptionCycle: null } }
    );
    if (!result.modifiedCount) continue;
    report.expired += 1;

    if (String(user.expiryNoticeSentFor) !== String(user.subscriptionExpiry)) {
      try {
        await sendMail({ to: user.email, ...templates.expiredNotice(user, plan) });
        await User.updateOne({ _id: user._id }, { $set: { expiryNoticeSentFor: user.subscriptionExpiry } });
      } catch (error) {
        console.error("[mail] Expiry email failed:", error.message);
      }
    }
  }

  // Remind people whose plan ends within the next few days (once per expiry date).
  const soon = await User.find({
    subscriptionPlan: { $in: PAID_PLANS },
    subscriptionExpiry: { $gt: now, $lte: new Date(now.getTime() + REMINDER_DAYS_BEFORE * DAY_MS) },
  });
  for (const user of soon) {
    if (user.reminderSentFor && new Date(user.reminderSentFor).getTime() === new Date(user.subscriptionExpiry).getTime()) continue;
    try {
      await sendMail({ to: user.email, ...templates.renewalReminder(user) });
      await User.updateOne({ _id: user._id }, { $set: { reminderSentFor: user.subscriptionExpiry } });
      report.reminded += 1;
    } catch (error) {
      console.error("[mail] Reminder email failed:", error.message);
    }
  }

  // Orders nobody paid within a day.
  const abandoned = await Transaction.updateMany(
    { status: "created", createdAt: { $lt: new Date(now.getTime() - DAY_MS) } },
    { $set: { status: "expired", failureReason: "Not paid within 24 hours" } }
  );
  report.abandoned = abandoned.modifiedCount;

  // Re-send receipts that failed earlier (paid within the last 3 days).
  const failedMail = await Transaction.find({
    status: "paid",
    emailError: { $exists: true },
    emailSentAt: { $exists: false },
    createdAt: { $gt: new Date(now.getTime() - 3 * DAY_MS) },
  }).limit(20);
  report.emailRetried = 0;
  for (const txn of failedMail) {
    const mailUser = await User.findById(txn.user);
    if (!mailUser) continue;
    await sendPurchaseEmail(mailUser, txn);
    report.emailRetried += 1;
  }

  return report;
};

const startSubscriptionJobs = () => {
  const run = () =>
    runSubscriptionJobs()
      .then((report) => {
        if (report.expired || report.reminded || report.abandoned) console.log("[subscriptions]", report);
      })
      .catch((error) => console.error("[subscriptions] Job failed:", error));

  setTimeout(run, 5000);
  return setInterval(run, 10 * 60 * 1000);
};

module.exports = {
  SubscriptionError,
  normalizePlan,
  addMonths,
  subscriptionState,
  usageFor,
  quote,
  createOrder,
  verifySignature,
  confirmWithRazorpay,
  stripe,
  availableProviders,
  createStripeSession,
  settleStripeSession,
  activateTransaction,
  markTransaction,
  reconcileUser,
  cancelAtPeriodEnd,
  resume,
  scheduleDowngrade,
  runSubscriptionJobs,
  startSubscriptionJobs,
  testPaymentsAllowed,
  safeEqual,
};
