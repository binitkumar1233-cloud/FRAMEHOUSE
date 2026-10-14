const { parseUserAgent } = require("../utils/userAgent");

// X-Forwarded-For can be set by anyone, so it is only trusted when the
// server runs behind a proxy that sets it (TRUST_PROXY=true).
const clientIp = (req) => {
  if (process.env.TRUST_PROXY === "true") {
    const forwarded = req.headers["x-forwarded-for"]?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress;
};

const deviceInfo = (req, res, next) => {
  const userAgent = req.headers["user-agent"] || "unknown";
  const rawDeviceId = req.headers["x-device-id"];

  req.device = {
    ip: clientIp(req),
    userAgent,
    // Random ID the browser keeps in localStorage (see client/src/utils/deviceId.ts).
    deviceId: typeof rawDeviceId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(rawDeviceId) ? rawDeviceId : undefined,
    ...parseUserAgent(userAgent),
  };
  next();
};

module.exports = deviceInfo;
