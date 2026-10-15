// IP -> city / state / country, using the free ip-api.com service.
// Set GEOIP_DISABLED=true to turn lookups off; a failed lookup never blocks a login.

const cache = new Map();
const TTL = 60 * 60 * 1000;

const normalize = (ip = "") => String(ip).replace(/^::ffff:/, "").replace(/^::1$/, "127.0.0.1");

const isPrivate = (ip) =>
  !ip ||
  ip === "::1" ||
  /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|fc|fd|fe80)/i.test(ip);

const EMPTY = { city: "", region: "", country: "", latitude: undefined, longitude: undefined };

const lookupIp = async (rawIp) => {
  const ip = normalize(rawIp);

  if (isPrivate(ip)) return { ...EMPTY, location: "Local network", ip };
  if (process.env.GEOIP_DISABLED === "true") return { ...EMPTY, location: "Unknown", ip };

  const hit = cache.get(ip);
  if (hit && hit.at > Date.now() - TTL) return hit.value;

  let value = { ...EMPTY, location: "Unknown", ip };
  try {
    const response = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city,lat,lon`,
      { signal: AbortSignal.timeout(3000) }
    );
    const data = await response.json();
    if (data.status === "success") {
      value = {
        city: data.city || "",
        region: data.regionName || "",
        country: data.country || "",
        latitude: data.lat,
        longitude: data.lon,
        location: [data.city, data.regionName, data.country].filter(Boolean).join(", ") || "Unknown",
        ip,
      };
    }
  } catch {
    // Offline or rate-limited: keep "Unknown" and do not cache the failure for long.
    cache.set(ip, { at: Date.now() - TTL + 60 * 1000, value });
    return value;
  }

  cache.set(ip, { at: Date.now(), value });
  return value;
};

module.exports = { lookupIp, normalizeIp: normalize };
