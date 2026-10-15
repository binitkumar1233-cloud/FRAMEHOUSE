const crypto = require("crypto");

// Chat is encrypted at rest with AES-256-GCM so a database leak or a curious
// admin can't read it. Set CHAT_ENCRYPTION_KEY (any long random string);
// it falls back to JWT_SECRET so existing deployments work immediately.
const PREFIX = "enc:v1:";

const key = () => {
  const secret = process.env.CHAT_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error("CHAT_ENCRYPTION_KEY or JWT_SECRET must be set");
  return crypto.createHash("sha256").update(`chat:${secret}`).digest();
};

const encrypt = (value) => {
  if (typeof value !== "string" || !value || value.startsWith(PREFIX)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
};

const decrypt = (value) => {
  // Older messages saved before encryption was added are returned as-is.
  if (typeof value !== "string" || !value.startsWith(PREFIX)) return value;
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
};

module.exports = { encrypt, decrypt };
