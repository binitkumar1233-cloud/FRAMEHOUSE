const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const OUTBOX = process.env.MAIL_OUTBOX_DIR || path.join(__dirname, "..", "outbox");

let transport = null;
let transportChecked = false;

const getTransport = () => {
  if (transportChecked) return transport;
  transportChecked = true;

  if (!process.env.SMTP_HOST) return null;

  const port = Number(process.env.SMTP_PORT) || 587;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
};

const escapeHeader = (value) => String(value).replace(/[\r\n]/g, " ");

/**
 * Sends an email. Without SMTP settings (SMTP_HOST etc. in .env) the email
 * is saved to server/outbox/ instead, so it can be checked during development.
 */
const sendMail = async ({ to, subject, html, text, attachments = [] }) => {
  const from = process.env.MAIL_FROM || "Framehouse <no-reply@framehouse.example>";
  const smtp = getTransport();

  if (smtp) {
    const info = await smtp.sendMail({ from, to, subject, html, text, attachments });
    return { delivered: true, messageId: info.messageId };
  }

  fs.mkdirSync(OUTBOX, { recursive: true });
  const slug = subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);
  const file = path.join(OUTBOX, `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug}.html`);
  const header = `<!-- From: ${escapeHeader(from)}\n     To: ${escapeHeader(to)}\n     Subject: ${escapeHeader(subject)}\n     Attachments: ${attachments.map((a) => a.filename).join(", ") || "none"} -->\n`;
  fs.writeFileSync(file, header + html);
  console.log(`[mail] SMTP not configured, saved "${subject}" for ${to} to ${file}`);
  return { delivered: false, file };
};

module.exports = { sendMail };
