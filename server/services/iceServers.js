const crypto = require("crypto");

// Builds the TURN/STUN list handed to meeting clients, so TURN credentials
// live in server environment variables instead of the public website bundle.
//
// Pick one:
//  1. Metered:  METERED_DOMAIN (e.g. yourapp.metered.live) + METERED_API_KEY
//  2. coturn:   TURN_URLS (comma separated) + TURN_SECRET (static-auth-secret)
//  3. Static:   TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL
// TURN_RELAY_ONLY=true forces all media through the relay so participants
// never see each other's IP addresses.
const STUN = [{ urls: process.env.STUN_URL || "stun:stun.l.google.com:19302" }];

const list = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);

const getIceConfig = async (userId) => {
  const relayOnly = process.env.TURN_RELAY_ONLY === "true";

  try {
    if (process.env.METERED_DOMAIN && process.env.METERED_API_KEY) {
      const url = `https://${process.env.METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${encodeURIComponent(process.env.METERED_API_KEY)}`;
      const response = await fetch(url);
      if (response.ok) return { iceServers: await response.json(), relayOnly };
      console.error("Metered TURN request failed:", response.status);
    }

    const urls = list(process.env.TURN_URLS);
    if (urls.length && process.env.TURN_SECRET) {
      const username = `${Math.floor(Date.now() / 1000) + 6 * 3600}:${userId}`;
      const credential = crypto.createHmac("sha1", process.env.TURN_SECRET).update(username).digest("base64");
      return { iceServers: [...STUN, { urls, username, credential }], relayOnly };
    }

    if (urls.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      return {
        iceServers: [...STUN, { urls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL }],
        relayOnly,
      };
    }
  } catch (error) {
    console.error("ICE server lookup failed:", error.message);
  }

  // No relay configured: relay-only would break calls, so ignore it.
  return { iceServers: STUN, relayOnly: false };
};

module.exports = { getIceConfig };
