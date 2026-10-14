const fs = require("fs");
const path = require("path");

const OUTBOX = process.env.MAIL_OUTBOX_DIR || path.join(__dirname, "..", "outbox");

/** Accepts "+91 98765 43210" style input and returns E.164, or null when it is not a valid number. */
const normalizePhone = (value) => {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\s\-().]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(cleaned)) return null;
  return cleaned;
};

const maskPhone = (phone = "") => (phone.length > 6 ? `${phone.slice(0, 3)}${"*".repeat(phone.length - 6)}${phone.slice(-3)}` : phone);

/**
 * Sends a text message through Twilio when TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and
 * TWILIO_FROM (or TWILIO_MESSAGING_SERVICE_SID) are set. Otherwise the message is saved
 * to server/outbox/ so it can be checked during development.
 */
const sendSms = async ({ to, body }) => {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (sid && token && (from || service)) {
    const params = new URLSearchParams({ To: to, Body: body });
    if (service) params.set("MessagingServiceSid", service);
    else params.set("From", from);

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`SMS provider returned ${response.status} ${detail.slice(0, 200)}`);
    }
    return { delivered: true };
  }

  fs.mkdirSync(OUTBOX, { recursive: true });
  const file = path.join(OUTBOX, `${new Date().toISOString().replace(/[:.]/g, "-")}-sms.txt`);
  fs.writeFileSync(file, `To: ${to}\n\n${body}\n`);
  console.log(`[sms] Twilio not configured, saved message for ${maskPhone(to)} to ${file}`);
  return { delivered: false, file };
};

module.exports = { sendSms, normalizePhone, maskPhone };
