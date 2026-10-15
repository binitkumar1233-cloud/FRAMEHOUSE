const { CYCLES, POLICIES } = require("../config/plans");

const SUPPORT_EMAIL = () => process.env.SUPPORT_EMAIL || "support@framehouse.example";
const APP_URL = () => process.env.APP_URL || "http://localhost:5173";

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const money = (amount, currency = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount || 0);

const date = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }) : "—";

const dateTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) + " IST"
    : "—";

const planName = (plan) => (plan ? plan.charAt(0).toUpperCase() + plan.slice(1).toLowerCase() : "");

const ACTION_LABEL = { new: "New subscription", renew: "Renewal", upgrade: "Upgrade" };

// ============================================================
// INVOICE (standalone page; also attached to the confirmation email)
// ============================================================

const invoiceHtml = (user, txn) => {
  const plan = planName(txn.plan);
  const cycle = CYCLES[txn.cycle]?.label || "Monthly";
  const rows = [
    ["Invoice number", txn.invoiceNumber],
    ["Invoice date", date(txn.paidAt)],
    ["Payment ID", txn.razorpayPaymentId],
    ["Order ID", txn.razorpayOrderId],
    ["Payment method", txn.method ? txn.method.toUpperCase() : "—"],
    ["Payment status", "Paid"],
  ];

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${escapeHtml(txn.invoiceNumber)} · Framehouse</title>
<style>
  body{margin:0;background:#f4f5f8;color:#16181f;font:15px/1.6 -apple-system,"Segoe UI",Roboto,Arial,sans-serif}
  .page{max-width:720px;margin:24px auto;padding:36px;background:#fff;border:1px solid #e3e5ec;border-radius:12px}
  .top{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;border-bottom:1px solid #e3e5ec;padding-bottom:20px}
  .brand{font-size:20px;font-weight:800;letter-spacing:.06em}.brand span{color:#1f5fe0}
  h1{margin:0;font-size:24px}.muted{color:#5a6072;font-size:13px}
  table{width:100%;border-collapse:collapse;margin-top:22px}th,td{padding:10px 8px;text-align:left;border-bottom:1px solid #eceef3;vertical-align:top}
  th{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#5a6072}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  .total td{font-weight:700;font-size:16px;border-bottom:0}.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 24px;margin-top:22px}
  .meta div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px dashed #eceef3;padding:6px 0;font-size:13.5px}.meta dt{color:#5a6072}.meta dd{margin:0;text-align:right;word-break:break-all}
  .paid{display:inline-block;padding:3px 10px;border-radius:999px;background:#e3f4ec;color:#1c7a4d;font-weight:700;font-size:12px}
  footer{margin-top:28px;padding-top:16px;border-top:1px solid #e3e5ec;color:#5a6072;font-size:12.5px}
  @media(max-width:560px){.page{margin:0;border-radius:0;padding:22px}.meta{grid-template-columns:1fr}}
  @media print{body{background:#fff}.page{border:0;margin:0}}
</style></head>
<body><div class="page">
  <div class="top">
    <div><div class="brand">FRAME<span>HOUSE</span></div><div class="muted">Framehouse Studio · ${escapeHtml(SUPPORT_EMAIL())}</div></div>
    <div style="text-align:right"><h1>Invoice</h1><div class="muted">${escapeHtml(txn.invoiceNumber)}</div><span class="paid">PAID</span></div>
  </div>

  <div style="margin-top:20px"><div class="muted">Billed to</div><strong>${escapeHtml(user.name)}</strong><div class="muted">${escapeHtml(user.email)}</div></div>

  <table>
    <thead><tr><th>Description</th><th>Period</th><th class="num">Amount</th></tr></thead>
    <tbody>
      <tr><td>${escapeHtml(plan)} plan · ${escapeHtml(cycle)}<br><span class="muted">${escapeHtml(ACTION_LABEL[txn.action] || "Subscription")}</span></td>
          <td>${escapeHtml(date(txn.periodStart))} – ${escapeHtml(date(txn.periodEnd))}</td>
          <td class="num">${escapeHtml(money(txn.listPrice ?? txn.amount, txn.currency))}</td></tr>
      ${txn.credit ? `<tr><td>Credit for unused time on previous plan</td><td></td><td class="num">−${escapeHtml(money(txn.credit, txn.currency))}</td></tr>` : ""}
      <tr class="total"><td>Total paid</td><td></td><td class="num">${escapeHtml(money(txn.amount, txn.currency))}</td></tr>
    </tbody>
  </table>

  <dl class="meta">${rows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v || "—")}</dd></div>`).join("")}</dl>

  <footer>This is a receipt for a payment already made. ${escapeHtml(POLICIES.renewal)}<br>
  Questions about this invoice? Contact ${escapeHtml(SUPPORT_EMAIL())} and quote ${escapeHtml(txn.invoiceNumber)}.</footer>
</div></body></html>`;
};

// ============================================================
// EMAIL LAYOUT
// ============================================================

const layout = (title, body) => `<!doctype html><html><body style="margin:0;background:#f4f5f8;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#16181f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e3e5ec;border-radius:12px">
<tr><td style="padding:28px 32px 8px;font-size:18px;font-weight:800;letter-spacing:.06em">FRAME<span style="color:#1f5fe0">HOUSE</span></td></tr>
<tr><td style="padding:8px 32px 28px;font-size:15px;line-height:1.6">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3">${escapeHtml(title)}</h1>
${body}
<p style="margin:24px 0 0;color:#5a6072;font-size:13px">Need help? Email <a href="mailto:${escapeHtml(SUPPORT_EMAIL())}" style="color:#1f5fe0">${escapeHtml(SUPPORT_EMAIL())}</a>. We usually reply within one working day.</p>
</td></tr></table></td></tr></table></body></html>`;

const detailTable = (rows) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse;font-size:14px">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #eceef3;color:#5a6072">${escapeHtml(k)}</td><td style="padding:8px 0;border-bottom:1px solid #eceef3;text-align:right;font-weight:600">${escapeHtml(v)}</td></tr>`
    )
    .join("")}</table>`;

const button = (label, href) =>
  `<p style="margin:20px 0"><a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 20px;background:#1f5fe0;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">${escapeHtml(label)}</a></p>`;

// ============================================================
// EMAILS
// ============================================================

const purchaseConfirmation = (user, txn) => {
  const plan = planName(txn.plan);
  const subject = `Payment received: ${plan} plan (${txn.invoiceNumber})`;
  const html = layout(
    `Your ${plan} plan is active`,
    `<p style="margin:0">Hi ${escapeHtml(user.name)}, thanks for your payment. Your receipt and subscription details are below, and your invoice is attached.</p>
     <h2 style="margin:22px 0 0;font-size:16px">Subscription</h2>
     ${detailTable([
       ["Plan", `${plan} · ${CYCLES[txn.cycle]?.label || "Monthly"}`],
       ["Type", ACTION_LABEL[txn.action] || "Subscription"],
       ["Valid from", date(txn.periodStart)],
       ["Valid until", date(txn.periodEnd)],
       ["Renewal", "Manual. We'll remind you 3 days before it ends"],
     ])}
     <h2 style="margin:22px 0 0;font-size:16px">Payment receipt</h2>
     ${detailTable([
       ["Invoice number", txn.invoiceNumber],
       ["Amount paid", money(txn.amount, txn.currency)],
       ...(txn.credit ? [["Credit applied", money(txn.credit, txn.currency)]] : []),
       ["Payment ID", txn.razorpayPaymentId || "—"],
       ["Order ID", txn.razorpayOrderId || "—"],
       ["Paid on", dateTime(txn.paidAt)],
       ["Status", "Paid"],
     ])}
     ${button("View my subscription", `${APP_URL()}/`)}`
  );
  const text = `Your ${plan} plan is active until ${date(txn.periodEnd)}. Invoice ${txn.invoiceNumber}, amount ${money(txn.amount, txn.currency)}, payment ID ${txn.razorpayPaymentId}, order ID ${txn.razorpayOrderId}. Support: ${SUPPORT_EMAIL()}`;
  return { subject, html, text };
};

const renewalReminder = (user) => {
  const plan = planName(user.subscriptionPlan);
  const subject = `Your ${plan} plan ends on ${date(user.subscriptionExpiry)}`;
  const html = layout(
    `Your ${plan} plan ends soon`,
    `<p style="margin:0">Hi ${escapeHtml(user.name)}, your ${escapeHtml(plan)} plan ends on <strong>${escapeHtml(date(user.subscriptionExpiry))}</strong>. Plans don't renew automatically, so renew now to keep your premium features without a break. Renewing adds the new period to the time you have left.</p>
     ${user.subscriptionStatus === "cancelled" ? `<p>You cancelled this plan, so you'll move to Free when it ends. Your watch history and account are kept.</p>` : ""}
     ${button("Renew my plan", `${APP_URL()}/`)}`
  );
  return { subject, html, text: `Your ${plan} plan ends on ${date(user.subscriptionExpiry)}. Renew at ${APP_URL()}. Support: ${SUPPORT_EMAIL()}` };
};

const expiredNotice = (user, plan) => {
  const subject = `Your ${planName(plan)} plan has ended`;
  const html = layout(
    `Your ${planName(plan)} plan has ended`,
    `<p style="margin:0">Hi ${escapeHtml(user.name)}, your ${escapeHtml(planName(plan))} plan ended, so your account is now on the Free plan. Your watch history, downloads list and settings are all still here.</p>
     ${button("See plans", `${APP_URL()}/`)}`
  );
  return { subject, html, text: `Your ${planName(plan)} plan has ended and your account is now on Free. Support: ${SUPPORT_EMAIL()}` };
};

const cancellationConfirmation = (user) => {
  const plan = planName(user.subscriptionPlan);
  const subject = `Your ${plan} plan is cancelled`;
  const html = layout(
    "Cancellation confirmed",
    `<p style="margin:0">Hi ${escapeHtml(user.name)}, your ${escapeHtml(plan)} plan won't be renewed. You keep all its features until <strong>${escapeHtml(date(user.subscriptionExpiry))}</strong>, then your account moves to Free.${user.pendingPlan && user.pendingPlan !== "Free" ? ` You chose to continue on ${escapeHtml(user.pendingPlan)} after that. Subscribe to it from your subscription page when the time comes.` : ""}</p>
     <p>Changed your mind? You can resume your plan from your subscription page any time before it ends.</p>`
  );
  return { subject, html, text: `Your ${plan} plan is cancelled and ends on ${date(user.subscriptionExpiry)}. Support: ${SUPPORT_EMAIL()}` };
};

const REASON_TEXT = {
  new_device: "a device we haven't seen before",
  trust_expired: "a browser whose trusted status has ended",
  new_browser: "a new browser",
  new_ip: "a new IP address",
  new_location: "a new location",
};

const otpEmail = ({ user, code, minutes, ctx = {}, reasons = [] }) => {
  const why = reasons.map((r) => REASON_TEXT[r]).filter(Boolean).join(", ");
  const subject = `${code} is your Framehouse verification code`;
  const html = layout(
    "Verify your sign-in",
    `<p style="margin:0">Hi ${escapeHtml(user.name)}, we noticed a sign-in from ${escapeHtml(why || "a new device")}. Enter this code to continue. It expires in ${minutes} minutes.</p>
     <p style="margin:22px 0;font-size:34px;font-weight:800;letter-spacing:.35em;text-align:center">${escapeHtml(code)}</p>
     ${detailTable([
       ["Browser", [ctx.browserName, ctx.browserVersion].filter(Boolean).join(" ") || "Unknown"],
       ["Operating system", ctx.os || "Unknown"],
       ["Device", [ctx.deviceType, ctx.deviceModel].filter(Boolean).join(" · ") || "Unknown"],
       ["IP address", ctx.ip || "Unknown"],
       ["Location", ctx.location || "Unknown"],
       ["Time", dateTime(new Date())],
     ])}
     <p style="margin:0;color:#5a6072;font-size:13px">If this wasn't you, don't share this code and change your password. Framehouse staff will never ask for it.</p>`
  );
  const text = `Your Framehouse verification code is ${code}. It expires in ${minutes} minutes. If this wasn't you, don't share it and change your password.`;
  return { subject, html, text };
};

const passwordResetEmail = ({ user, code, minutes }) => {
  const subject = "Your Framehouse password reset code";
  const html = layout(
    "Reset your password",
    `<p style="margin:0">Hi ${escapeHtml(user.name)}, use this code to reset your Framehouse password. It expires in ${minutes} minutes.</p>
     <p style="margin:22px 0;font-size:34px;font-weight:800;letter-spacing:.35em;text-align:center">${escapeHtml(code)}</p>
     <p style="margin:0;color:#5a6072;font-size:13px">If you didn't request a password reset, ignore this email. Never share this code with anyone.</p>`
  );
  const text = `Your Framehouse password reset code is ${code}. It expires in ${minutes} minutes. If you didn't request a reset, ignore this email.`;
  return { subject, html, text };
};

module.exports = { otpEmail, passwordResetEmail, invoiceHtml, purchaseConfirmation, renewalReminder, expiredNotice, cancellationConfirmation, planName };
