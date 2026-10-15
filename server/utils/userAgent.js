// Small user-agent parser for audit records (browser, OS, device type).

const match = (ua, rules) => {
  for (const [pattern, name, versionPattern] of rules) {
    if (pattern.test(ua)) {
      const version = versionPattern ? ua.match(versionPattern)?.[1] : undefined;
      return version ? `${name} ${version.split(".")[0]}` : name;
    }
  }
  return "Unknown";
};

const VERSION_PATTERNS = [
  /Edg(?:A|iOS)?\/([\d.]+)/,
  /OPR\/([\d.]+)/,
  /SamsungBrowser\/([\d.]+)/,
  /(?:Firefox|FxiOS)\/([\d.]+)/,
  /CriOS\/([\d.]+)/,
  /Chrome\/([\d.]+)/,
  /Version\/([\d.]+).*Safari\//,
];

const parseUserAgent = (userAgent = "") => {
  const ua = String(userAgent);

  const browser = match(ua, [
    [/Edg(A|iOS)?\//, "Edge", /Edg(?:A|iOS)?\/([\d.]+)/],
    [/OPR\/|Opera/, "Opera", /OPR\/([\d.]+)/],
    [/SamsungBrowser\//, "Samsung Internet", /SamsungBrowser\/([\d.]+)/],
    [/Firefox\/|FxiOS\//, "Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
    [/CriOS\//, "Chrome", /CriOS\/([\d.]+)/],
    [/Chrome\//, "Chrome", /Chrome\/([\d.]+)/],
    [/Version\/[\d.]+.*Safari\//, "Safari", /Version\/([\d.]+)/],
    [/curl\//i, "curl", /curl\/([\d.]+)/i],
  ]);

  const os = match(ua, [
    [/Windows NT/, "Windows"],
    [/iPhone|iPod/, "iOS"],
    [/iPad/, "iPadOS"],
    [/Android/, "Android", /Android ([\d.]+)/],
    [/CrOS/, "ChromeOS"],
    [/Mac OS X|Macintosh/, "macOS"],
    [/Linux/, "Linux"],
  ]);

  const deviceType = /iPad|Tablet/i.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))
    ? "tablet"
    : /Mobi|iPhone|iPod|Android/i.test(ua)
    ? "mobile"
    : ua
    ? "desktop"
    : "unknown";

  // Full version for the security log; "browser" above keeps the major version only.
  let browserVersion = "";
  for (const pattern of VERSION_PATTERNS) {
    const found = ua.match(pattern)?.[1];
    if (found) {
      browserVersion = found;
      break;
    }
  }

  // The model is only visible for phones and tablets (Apple only reports iPhone / iPad).
  const deviceModel =
    ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/)?.[1]?.trim() ||
    (/iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : "");

  return {
    browser,
    browserName: browser.replace(/ \d+$/, ""),
    browserVersion,
    os,
    deviceType,
    deviceModel,
  };
};

module.exports = { parseUserAgent };
