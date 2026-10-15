const crypto = require("crypto");
const Comment = require("../models/Comment");
const ModerationLog = require("../models/ModerationLog");
const CaptchaChallenge = require("../models/CaptchaChallenge");

const num = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);

const CONFIG = () => ({
  maxLength: 1500,
  editMinutes: num(process.env.COMMENT_EDIT_MINUTES, 15),
  perMinute: num(process.env.COMMENT_RATE_PER_MINUTE, 5),
  perHour: num(process.env.COMMENT_RATE_PER_HOUR, 40),
  // CAPTCHA appears after this many blocked attempts (10 min) or this many posts in the last minute.
  captchaAfterBlocked: num(process.env.COMMENT_CAPTCHA_AFTER_BLOCKED, 3),
  captchaAfterBurst: num(process.env.COMMENT_CAPTCHA_AFTER_BURST, 3),
  duplicateWindowMinutes: 10,
  maxLinks: 2,
  maxMentions: 5,
});

// ---------- profanity ----------
// A starter list in English plus common transliterated Hindi. Extend with COMMENT_BLOCKED_WORDS="word1,word2".
const BASE_WORDS = [
  "fuck", "fucker", "fucking", "motherfucker", "shit", "bullshit", "bitch", "bastard", "asshole", "dickhead",
  "cunt", "slut", "whore", "pussy", "wanker", "twat", "douchebag", "retard", "nigger", "nigga", "faggot",
  "kys", "killyourself", "gobacktoyourcountry",
  "madarchod", "behenchod", "bhenchod", "chutiya", "chutiye", "gandu", "harami", "randi", "bhosdike", "lund", "gaand",
];

const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i", "+": "t" };

const blockedWords = () => {
  const extra = (process.env.COMMENT_BLOCKED_WORDS || "").split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
  return [...new Set([...BASE_WORDS, ...extra])];
};

/** Lowercase, undo number/symbol substitutions, drop accents. */
const fold = (text) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[0134578@$!+]/g, (c) => LEET[c]);

const findProfanity = (text) => {
  const words = blockedWords();
  const folded = fold(text);
  // Whole words only, so "class" or "Scunthorpe" are not caught.
  const tokens = folded.split(/[^a-zऀ-ॿЀ-ӿ]+/).filter(Boolean);
  for (const token of tokens) {
    const squeezed = token.replace(/(.)\1{2,}/g, "$1$1"); // fuuuuck -> fuuck
    const collapsed = token.replace(/(.)\1+/g, "$1"); // fuuuuck -> fuck
    for (const word of words) {
      const wordCollapsed = word.replace(/(.)\1+/g, "$1");
      if (token === word || squeezed === word || collapsed === wordCollapsed) return word;
    }
  }
  // "f u c k" / "f.u.c.k": runs of single letters joined together.
  const spaced = folded.match(/(?:\b[a-z][\s.\-_*]+){3,}[a-z]\b/g) || [];
  for (const run of spaced) {
    const joined = run.replace(/[^a-z]/g, "");
    if (words.includes(joined)) return joined;
  }
  // Phrases without spaces ("kill yourself").
  const compact = folded.replace(/[^a-z]/g, "");
  for (const phrase of ["killyourself", "gobacktoyourcountry"]) if (compact.includes(phrase)) return phrase;
  return null;
};

// ---------- links ----------
const SHORTENERS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "cutt.ly", "rb.gy", "ow.ly", "shorturl.at", "tiny.cc", "buff.ly"];
const BAD_EXTENSIONS = /\.(exe|apk|scr|bat|cmd|msi|jar|vbs|ps1|dmg|pkg|iso)(?:[?#]|$)/i;
const URL_PATTERN = /(?:(?:[a-z][a-z0-9+.-]*):\/\/|www\.|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|in|ru|cn|info|biz|xyz|top|click|link|site|online|app|dev|me|tv|ly|gg|cc|to|zip|mov)\b)[^\s<>"']*/gi;

const extractLinks = (text) => text.match(URL_PATTERN) || [];

const checkLinks = (text) => {
  // Script-style schemes have no "//", so the URL pattern would miss them.
  if (/\b(?:javascript|vbscript|data)\s*:\s*\S/i.test(text)) return { code: "link", message: "That kind of link isn't allowed." };

  const links = extractLinks(text);
  if (links.length > CONFIG().maxLinks) return { code: "link", message: `Please keep it to ${CONFIG().maxLinks} links or fewer.` };

  const extraBlocked = (process.env.COMMENT_BLOCKED_DOMAINS || "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);

  for (const raw of links) {
    // Other schemes (javascript:, data:, file:) never carry a legitimate link in a comment.
    if (/^(javascript|data|vbscript|file|blob|ftp):/i.test(raw)) return { code: "link", message: "That kind of link isn't allowed." };

    let url;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      return { code: "link", message: "That link doesn't look valid." };
    }
    if (!/^https?:$/.test(url.protocol)) return { code: "link", message: "Only http and https links are allowed." };

    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.username || url.password) return { code: "link", message: "Links with embedded logins aren't allowed." };
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || /^\d+$/.test(host)) return { code: "link", message: "Links to raw IP addresses aren't allowed." };
    if (host.split(".").some((part) => part.startsWith("xn--"))) return { code: "link", message: "That link looks like a lookalike domain." };
    if (SHORTENERS.includes(host)) return { code: "link", message: "Shortened links aren't allowed. Paste the full address." };
    if (extraBlocked.some((d) => host === d || host.endsWith(`.${d}`))) return { code: "link", message: "That website is blocked." };
    if (BAD_EXTENSIONS.test(url.pathname)) return { code: "link", message: "Links to downloadable programs aren't allowed." };
    if (/\.(zip|mov)$/.test(host)) return { code: "link", message: "That link looks suspicious." };
  }
  return null;
};

// ---------- spam shapes ----------
const countEmoji = (text) => (text.match(/\p{Extended_Pictographic}/gu) || []).length;

const checkSpamShape = (text) => {
  const trimmed = text.trim();
  const letters = trimmed.replace(/[^\p{L}]/gu, "");

  // One character 10+ times in a row.
  if (/(.)\1{9,}/su.test(trimmed.replace(/\s/g, ""))) return { code: "repeated", message: "Please avoid repeating the same character." };

  // A short pattern repeated many times ("!?!?!?!?!?" or "😂😂😂😂😂😂").
  if (/(.{1,4}?)\1{5,}/su.test(trimmed.replace(/\s/g, ""))) return { code: "repeated", message: "That looks like repeated filler. Please write a real comment." };

  const symbols = trimmed.replace(/[\p{L}\p{N}\s]/gu, "");
  const symbolCount = [...symbols].length;
  const total = [...trimmed.replace(/\s/g, "")].length;
  if (total >= 8 && symbolCount / total > 0.7) return { code: "symbols", message: "Comments made mostly of symbols or emoji aren't allowed." };
  if (countEmoji(trimmed) > 15) return { code: "symbols", message: "Please use fewer emoji." };

  if (letters.length >= 16) {
    const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
    if (upper / letters.length > 0.7) return { code: "caps", message: "Please don't write everything in capitals." };
  }

  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length >= 6) {
    const freq = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;
    if (Math.max(...Object.values(freq)) / words.length > 0.5) return { code: "repeated", message: "That repeats the same word too often." };
  }

  if (/(?:whatsapp|telegram|t\.me|dm me|free (?:money|gift|followers)|click here|earn \$?\d+|crypto giveaway|buy followers)/i.test(trimmed)) {
    return { code: "spam", message: "That looks like spam." };
  }
  return null;
};

// ---------- text helpers ----------
// No leetspeak mapping here: "here!!" and "here" must hash the same.
const normalizeForHash = (text) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-zऀ-ॿЀ-ӿ\p{L}\p{N}]/gu, "");
const hashText = (text) => crypto.createHash("sha256").update(normalizeForHash(text)).digest("hex").slice(0, 32);

/** Rough guess from the writing system. Used for display; translation does its own detection. */
const guessLanguage = (text) => {
  const scripts = [
    ["hi", /[ऀ-ॿ]/g], ["bn", /[ঀ-৿]/g], ["ta", /[஀-௿]/g], ["te", /[ఀ-౿]/g],
    ["ar", /[؀-ۿ]/g], ["ru", /[Ѐ-ӿ]/g], ["ja", /[぀-ヿ]/g], ["ko", /[가-힯]/g],
    ["zh", /[一-鿿]/g], ["th", /[฀-๿]/g], ["el", /[Ͱ-Ͽ]/g], ["he", /[֐-׿]/g],
  ];
  let best = ["und", 0];
  for (const [code, re] of scripts) {
    const n = (text.match(re) || []).length;
    if (n > best[1]) best = [code, n];
  }
  if (best[1] > 0) return best[0];
  return /[a-z]/i.test(text) ? "latin" : "und";
};

// ---------- main check ----------
const MENTION = /(^|[^a-z0-9_])@([a-z0-9_]{3,20})\b/gi;
const parseMentions = (text) => [...new Set([...text.matchAll(MENTION)].map((m) => m[2].toLowerCase()))];

/**
 * Returns null when the text is fine, or { code, message } for the first rule it breaks.
 * Rules run from cheapest to most expensive; database checks (duplicates) come last.
 */
const inspect = async (text, { userId, videoId, parentId, excludeCommentId }) => {
  const cfg = CONFIG();

  if (text.length < 1) return { code: "empty", message: "Write something first." };
  if (text.length > cfg.maxLength) return { code: "length", message: `Comments can be up to ${cfg.maxLength} characters.` };
  if (!/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(text)) return { code: "symbols", message: "Comments need some words in them." };

  const profanity = findProfanity(text);
  if (profanity) return { code: "profanity", message: "Your comment contains language that isn't allowed here. Please rephrase it." };

  const shape = checkSpamShape(text);
  if (shape) return shape;

  const link = checkLinks(text);
  if (link) return link;

  if (parseMentions(text).length > cfg.maxMentions) return { code: "mentions", message: `You can mention up to ${cfg.maxMentions} people.` };

  const hash = hashText(text);
  const since = new Date(Date.now() - cfg.duplicateWindowMinutes * 60 * 1000);
  const base = { textHash: hash, createdAt: { $gte: since }, deletedAt: { $exists: false } };
  if (excludeCommentId) base._id = { $ne: excludeCommentId };

  const mine = await Comment.exists({ ...base, user: userId, video: videoId });
  if (mine) return { code: "duplicate", message: "You already posted that. Duplicate comments aren't allowed." };

  // The same text from several different accounts in a few minutes is a spam campaign.
  const authors = await Comment.distinct("user", base);
  if (authors.length >= 3) return { code: "spam", message: "That comment looks like spam." };

  void parentId;
  return null;
};

const logBlock = (user, video, check, text) =>
  ModerationLog.create({
    action: "auto_blocked",
    targetUser: user,
    video,
    code: check.code,
    detail: check.message,
    excerpt: String(text).slice(0, 160),
  }).catch((error) => console.error("[comments] log failed:", error.message));

// ---------- rate limiting + captcha ----------
const checkRate = async (userId) => {
  const cfg = CONFIG();
  const [lastMinute, lastHour] = await Promise.all([
    Comment.countDocuments({ user: userId, createdAt: { $gte: new Date(Date.now() - 60 * 1000) } }),
    Comment.countDocuments({ user: userId, createdAt: { $gte: new Date(Date.now() - 3600 * 1000) } }),
  ]);
  if (lastMinute >= cfg.perMinute) return { blocked: true, retryAfter: 60, message: "You're posting too fast. Please wait a minute." };
  if (lastHour >= cfg.perHour) return { blocked: true, retryAfter: 600, message: "You've reached the hourly comment limit. Please try again later." };
  return { blocked: false, lastMinute };
};

// Solving a CAPTCHA wipes the slate: only activity after the last solve counts.
const captchaRequired = async (userId) => {
  const cfg = CONFIG();
  const solved = await CaptchaChallenge.findOne({ user: userId, solvedAt: { $exists: true } }).sort({ solvedAt: -1 }).select("solvedAt").lean();
  const since = (windowMs) => {
    const start = new Date(Date.now() - windowMs);
    return solved && solved.solvedAt > start ? solved.solvedAt : start;
  };

  const burst = await Comment.countDocuments({ user: userId, createdAt: { $gte: since(60 * 1000) } });
  if (burst >= cfg.captchaAfterBurst) return true;

  const blocked = await ModerationLog.countDocuments({
    targetUser: userId,
    action: "auto_blocked",
    createdAt: { $gte: since(10 * 60 * 1000) },
  });
  return blocked >= cfg.captchaAfterBlocked;
};

const answerHash = (id, answer) =>
  crypto.createHmac("sha256", process.env.JWT_SECRET).update(`${id}:${String(answer).trim()}`).digest("hex");

const createCaptcha = async (userId) => {
  const a = crypto.randomInt(2, 20);
  const b = crypto.randomInt(2, 20);
  const plus = crypto.randomInt(0, 2) === 0;
  const challenge = new CaptchaChallenge({ user: userId, answerHash: "pending", expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
  challenge.answerHash = answerHash(challenge._id.toString(), plus ? a + b : Math.max(a, b) - Math.min(a, b));
  await challenge.save();
  return { captchaId: challenge._id.toString(), question: plus ? `What is ${a} + ${b}?` : `What is ${Math.max(a, b)} − ${Math.min(a, b)}?` };
};

/** Single use: a solved challenge cannot be reused for a second burst of posts. */
const solveCaptcha = async (userId, id, answer) => {
  if (!/^[a-f\d]{24}$/i.test(String(id || ""))) return false;
  const challenge = await CaptchaChallenge.findOneAndUpdate(
    { _id: id, user: userId, usedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
    { usedAt: new Date() },
    { returnDocument: "before" }
  );
  if (!challenge) return false;
  const expected = Buffer.from(challenge.answerHash);
  const actual = Buffer.from(answerHash(id, answer));
  const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  if (ok) await CaptchaChallenge.updateOne({ _id: id }, { solvedAt: new Date() });
  return ok;
};

module.exports = {
  CONFIG,
  inspect,
  logBlock,
  checkRate,
  captchaRequired,
  createCaptcha,
  solveCaptcha,
  hashText,
  guessLanguage,
  parseMentions,
  findProfanity,
  extractLinks,
};
