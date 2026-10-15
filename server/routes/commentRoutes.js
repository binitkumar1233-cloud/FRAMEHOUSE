const express = require("express");
const mongoose = require("mongoose");
const auth = require("../middleware/auth");
const optionalAuth = require("../middleware/optionalAuth");
const Comment = require("../models/Comment");
const CommentEditHistory = require("../models/CommentEditHistory");
const CommentReport = require("../models/CommentReport");
const CommentTranslation = require("../models/CommentTranslation");
const LoginRecord = require("../models/LoginRecord");
const ModerationLog = require("../models/ModerationLog");
const User = require("../models/User");
const Video = require("../models/Video");
const moderation = require("../services/commentModeration");
const { translate, TranslateError, LANGUAGES } = require("../services/translate");
const { ensureUsername } = require("../services/username");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
const { REASONS } = CommentReport;

const isId = (value) => /^[a-f\d]{24}$/i.test(String(value));
const oid = (value) => new mongoose.Types.ObjectId(String(value));
const fail = (res, status, code, message, extra = {}) => res.status(status).json({ success: false, code, message, ...extra });
const adminOnly = (req, res, next) => (req.user?.role === "admin" ? next() : fail(res, 403, "forbidden", "Admin access required"));

const cleanText = (value) =>
  String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f​-‏‪-‮⁠﻿]/g, "") // control and invisible characters
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const isLive = (c) => !c.deletedAt && c.status === "visible";
const editableUntil = (c) => new Date(new Date(c.createdAt).getTime() + moderation.CONFIG().editMinutes * 60 * 1000);

// ---------- output ----------

const author = (user) => (user && user.username ? { username: user.username, avatar: user.avatar || "" } : { username: "unknown", avatar: "" });

const present = (c, viewer) => {
  const viewerId = viewer?._id?.toString();
  const base = {
    id: c._id,
    video: c.video,
    parent: c.parent || null,
    createdAt: c.createdAt,
    replyCount: c.replyCount || 0,
  };

  // Deleted or removed comments that still have replies stay as a placeholder so the thread makes sense.
  if (!isLive(c)) {
    return { ...base, deleted: true, removedBy: c.status === "removed" ? "moderator" : "author", text: "", user: null, mentions: [] };
  }

  const own = viewerId && c.user?._id?.toString() === viewerId;
  const until = editableUntil(c);
  const reaction = c.myReaction || (viewerId ? (c.likes || []).some((id) => id.toString() === viewerId) ? "like" : (c.dislikes || []).some((id) => id.toString() === viewerId) ? "dislike" : null : null);

  return {
    ...base,
    deleted: false,
    text: c.text,
    language: c.language,
    user: author(c.user),
    replyTo: c.replyTo?.username || null,
    mentions: (c.mentionUsers || []).map((u) => u.username),
    location: c.location?.city || c.location?.country ? [c.location.city, c.location.country].filter(Boolean).join(", ") : null,
    likeCount: c.likeCount,
    dislikeCount: c.dislikeCount,
    myReaction: reaction,
    version: c.version,
    edited: Boolean(c.editedAt),
    editedAt: c.editedAt || null,
    own: Boolean(own),
    canEdit: Boolean(own) && until > new Date(),
    editableUntil: own ? until : null,
    flagged: viewer?.role === "admin" ? c.flagged : undefined,
    reportCount: viewer?.role === "admin" ? c.reportCount : undefined,
  };
};

const populateAll = async (docs) => {
  const populated = await Comment.populate(docs, [
    { path: "user", select: "username avatar" },
    { path: "replyTo", select: "username" },
  ]);
  const ids = [...new Set(populated.flatMap((c) => (c.mentions || []).map(String)))];
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select("username").lean() : [];
  const byId = new Map(users.map((u) => [String(u._id), u]));
  for (const c of populated) c.mentionUsers = (c.mentions || []).map((id) => byId.get(String(id))).filter(Boolean);
  return populated;
};

const recountReplies = async (rootId) => {
  const count = await Comment.countDocuments({ parent: rootId, deletedAt: { $exists: false }, status: "visible" });
  await Comment.updateOne({ _id: rootId }, { replyCount: count });
};

// ---------- small endpoints ----------

router.get(
  "/languages",
  (req, res) => res.json({ success: true, languages: Object.entries(LANGUAGES).map(([code, name]) => ({ code, name })) })
);

router.get(
  "/me",
  auth,
  asyncHandler(async (req, res) => {
    await ensureUsername(req.user);
    res.json({ success: true, username: req.user.username, preferredLanguage: req.user.preferredLanguage || "en", editMinutes: moderation.CONFIG().editMinutes });
  })
);

router.put(
  "/me/language",
  auth,
  asyncHandler(async (req, res) => {
    const { language } = req.body;
    if (!LANGUAGES[language]) return fail(res, 400, "bad-language", "That language isn't supported.");
    await User.updateOne({ _id: req.user._id }, { preferredLanguage: language });
    res.json({ success: true, preferredLanguage: language });
  })
);

router.get(
  "/mentions",
  auth,
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
    if (q.length < 2) return res.json({ success: true, users: [] });
    const users = await User.find({ username: { $regex: `^${q}` } }).select("username avatar").limit(6).lean();
    res.json({ success: true, users: users.map((u) => ({ username: u.username, avatar: u.avatar || "" })) });
  })
);

router.get(
  "/captcha",
  auth,
  asyncHandler(async (req, res) => res.json({ success: true, ...(await moderation.createCaptcha(req.user._id)) }))
);

// ---------- listing ----------

const SORTS = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  top: { likeCount: -1, createdAt: -1 },
  relevant: { relevance: -1, createdAt: -1 },
};

router.get(
  "/video/:videoId",
  optionalAuth,
  asyncHandler(async (req, res) => {
    if (!isId(req.params.videoId)) return fail(res, 400, "bad-id", "Invalid video");
    const sort = SORTS[req.query.sort] ? req.query.sort : "relevant";
    const limit = Math.min(Math.max(Number(req.query.limit) || 15, 1), 50);
    const page = Math.max(Number(req.query.page) || 1, 1);

    const match = {
      video: oid(req.params.videoId),
      parent: null,
      // A removed comment only stays if it still has replies under it.
      $or: [{ deletedAt: { $exists: false }, status: "visible" }, { replyCount: { $gt: 0 } }],
    };

    const viewerId = req.user ? req.user._id : null;
    const [rows, total, all] = await Promise.all([
      Comment.aggregate([
        { $match: match },
        {
          $addFields: {
            // Likes and replies lift a comment; dislikes only dampen it a little; newer comments get a head start.
            relevance: {
              $divide: [
                { $max: [0.1, { $add: [1, { $multiply: ["$likeCount", 2] }, { $multiply: ["$replyCount", 1.5] }, { $multiply: ["$dislikeCount", -0.5] }] }] },
                { $pow: [{ $add: [{ $divide: [{ $subtract: ["$$NOW", "$createdAt"] }, 3600000] }, 2] }, 1.2] },
              ],
            },
          },
        },
        { $sort: SORTS[sort] },
        { $skip: (page - 1) * limit },
        { $limit: limit },
      ]),
      Comment.countDocuments(match),
      Comment.countDocuments({ video: oid(req.params.videoId), deletedAt: { $exists: false }, status: "visible" }),
    ]);

    const docs = await populateAll(rows);
    res.json({
      success: true,
      comments: docs.map((c) => present(c, req.user)),
      total,
      totalAll: all,
      page,
      pages: Math.max(Math.ceil(total / limit), 1),
      sort,
      viewer: viewerId ? { id: viewerId } : null,
    });
  })
);

router.get(
  "/:id/replies",
  optionalAuth,
  asyncHandler(async (req, res) => {
    if (!isId(req.params.id)) return fail(res, 400, "bad-id", "Invalid comment");
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const filter = { parent: req.params.id, deletedAt: { $exists: false }, status: "visible" };

    const [rows, total] = await Promise.all([
      Comment.find(filter).sort({ createdAt: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      Comment.countDocuments(filter),
    ]);
    const docs = await populateAll(rows);
    res.json({ success: true, replies: docs.map((c) => present(c, req.user)), total, page, pages: Math.max(Math.ceil(total / limit), 1) });
  })
);

// ---------- posting ----------

const lastLocation = async (userId) => {
  const record = await LoginRecord.findOne({ user: userId, event: "login_success" }).sort({ createdAt: -1 }).select("city country").lean();
  if (!record) return undefined;
  return record.city || record.country ? { city: record.city || undefined, country: record.country || undefined } : undefined;
};

router.post(
  "/video/:videoId",
  auth,
  asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    if (!isId(videoId)) return fail(res, 400, "bad-id", "Invalid video");
    if (!(await Video.exists({ _id: videoId }))) return fail(res, 404, "no-video", "Video not found");

    const text = cleanText(req.body.text);
    const user = req.user;
    await ensureUsername(user);

    // 1. Flooding
    const rate = await moderation.checkRate(user._id);
    if (rate.blocked) {
      await moderation.logBlock(user._id, videoId, { code: "flood", message: rate.message }, text);
      return fail(res, 429, "rate-limited", rate.message, { retryAfter: rate.retryAfter });
    }

    // 2. CAPTCHA after repeated attempts
    if (await moderation.captchaRequired(user._id)) {
      if (!req.body.captchaId) {
        return fail(res, 403, "captcha-required", "Please solve this quick check to keep posting.", { captcha: await moderation.createCaptcha(user._id) });
      }
      if (!(await moderation.solveCaptcha(user._id, req.body.captchaId, req.body.captchaAnswer))) {
        return fail(res, 403, "captcha-failed", "That answer wasn't right. Try the new question.", { captcha: await moderation.createCaptcha(user._id) });
      }
    }

    // 3. Where does it go?
    let root = null;
    let replyTo = null;
    if (req.body.parentId) {
      if (!isId(req.body.parentId)) return fail(res, 400, "bad-id", "Invalid comment");
      const target = await Comment.findById(req.body.parentId);
      if (!target || String(target.video) !== videoId) return fail(res, 404, "no-comment", "The comment you're replying to wasn't found.");
      if (!isLive(target)) return fail(res, 409, "parent-deleted", "That comment was deleted, so it can't be replied to.");
      root = target.parent || target._id;
      replyTo = target.user;
    }

    // 4. Content rules
    const problem = await moderation.inspect(text, { userId: user._id, videoId });
    if (problem) {
      await moderation.logBlock(user._id, videoId, problem, text);
      return fail(res, 422, problem.code, problem.message);
    }

    // 5. Save
    const handles = moderation.parseMentions(text);
    const mentioned = handles.length ? await User.find({ username: { $in: handles } }).select("_id").lean() : [];

    const comment = await Comment.create({
      video: videoId,
      user: user._id,
      parent: root,
      replyTo,
      text,
      textHash: moderation.hashText(text),
      language: moderation.guessLanguage(text),
      mentions: mentioned.map((u) => u._id),
      location: await lastLocation(user._id),
    });
    if (root) await Comment.updateOne({ _id: root }, { $inc: { replyCount: 1 } });

    const [doc] = await populateAll([comment.toObject()]);
    res.status(201).json({ success: true, comment: present(doc, user) });
  })
);

// ---------- editing and deleting (own comments, within the time limit) ----------

router.patch(
  "/:id",
  auth,
  asyncHandler(async (req, res) => {
    if (!isId(req.params.id)) return fail(res, 400, "bad-id", "Invalid comment");
    const expected = Number(req.body.expectedVersion);
    if (!Number.isInteger(expected)) return fail(res, 400, "bad-version", "Missing comment version");

    const current = await Comment.findById(req.params.id);
    if (!current || !isLive(current)) return fail(res, 404, "no-comment", "Comment not found");
    if (String(current.user) !== String(req.user._id)) return fail(res, 403, "forbidden", "You can only edit your own comments.");
    if (editableUntil(current) < new Date()) {
      return fail(res, 403, "edit-window-closed", `Comments can only be edited for ${moderation.CONFIG().editMinutes} minutes after posting.`);
    }
    if (current.version !== expected) {
      const [doc] = await populateAll([current.toObject()]);
      return fail(res, 409, "edit-conflict", "This comment was changed somewhere else. Review the latest version and try again.", {
        comment: present(doc, req.user),
      });
    }

    const text = cleanText(req.body.text);
    if (text === current.text) return fail(res, 400, "no-change", "Nothing was changed.");

    const problem = await moderation.inspect(text, { userId: req.user._id, videoId: current.video, excludeCommentId: current._id });
    if (problem) {
      await moderation.logBlock(req.user._id, current.video, problem, text);
      return fail(res, 422, problem.code, problem.message);
    }

    const handles = moderation.parseMentions(text);
    const mentioned = handles.length ? await User.find({ username: { $in: handles } }).select("_id").lean() : [];

    // Save the prior version before the compare-and-swap. The unique version key
    // makes retries and simultaneous edits converge on one history entry.
    try {
      await CommentEditHistory.updateOne(
        { comment: current._id, version: current.version },
        {
          $setOnInsert: {
            editor: req.user._id,
            text: current.text,
            editedAt: current.editedAt || current.createdAt,
          },
        },
        { upsert: true }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
      const priorVersion = await CommentEditHistory.findOne({
        comment: current._id,
        version: current.version,
      }).select("text").lean();
      if (!priorVersion || priorVersion.text !== current.text) throw error;
    }

    // The version check makes two simultaneous edits safe: only one can win.
    const updated = await Comment.findOneAndUpdate(
      { _id: current._id, user: req.user._id, version: expected, deletedAt: { $exists: false }, status: "visible" },
      {
        $set: { text, textHash: moderation.hashText(text), language: moderation.guessLanguage(text), mentions: mentioned.map((u) => u._id), editedAt: new Date() },
        $inc: { version: 1 },
      },
      { returnDocument: "after" }
    );

    if (!updated) {
      const latest = await Comment.findById(req.params.id);
      const [doc] = latest && isLive(latest) ? await populateAll([latest.toObject()]) : [];
      return fail(res, 409, "edit-conflict", "This comment was changed somewhere else. Review the latest version and try again.", {
        comment: doc ? present(doc, req.user) : null,
      });
    }

    const [doc] = await populateAll([updated.toObject()]);
    await ModerationLog.create({
      action: "comment_edited",
      actor: req.user._id,
      targetUser: req.user._id,
      comment: updated._id,
      video: updated.video,
      excerpt: text.slice(0, 160),
    }).catch((error) => console.error("[comments] edit log failed:", error.message));
    res.json({ success: true, comment: present(doc, req.user) });
  })
);

router.delete(
  "/:id",
  auth,
  asyncHandler(async (req, res) => {
    if (!isId(req.params.id)) return fail(res, 400, "bad-id", "Invalid comment");
    const comment = await Comment.findById(req.params.id);
    if (!comment || !isLive(comment)) return fail(res, 404, "no-comment", "Comment not found");

    const isAdmin = req.user.role === "admin";
    const own = String(comment.user) === String(req.user._id);
    if (!own && !isAdmin) return fail(res, 403, "forbidden", "You can only delete your own comments.");
    if (own && !isAdmin && editableUntil(comment) < new Date()) {
      return fail(res, 403, "edit-window-closed", `Comments can only be deleted for ${moderation.CONFIG().editMinutes} minutes after posting.`);
    }

    // Soft delete: the text stays in the records, replies stay attached.
    const patch = own ? { deletedAt: new Date() } : { status: "removed", removedAt: new Date(), removedBy: req.user._id };
    const result = await Comment.updateOne({ _id: comment._id, deletedAt: { $exists: false }, status: "visible" }, { $set: patch });
    if (!result.modifiedCount) return fail(res, 404, "no-comment", "Comment not found");

    if (comment.parent) await recountReplies(comment.parent);
    await ModerationLog.create({
      action: own ? "comment_deleted_by_author" : "comment_removed",
      actor: req.user._id,
      targetUser: comment.user,
      comment: comment._id,
      video: comment.video,
      excerpt: comment.text.slice(0, 160),
    });
    res.json({ success: true });
  })
);

// ---------- likes and dislikes ----------

router.post(
  "/:id/react",
  auth,
  asyncHandler(async (req, res) => {
    if (!isId(req.params.id)) return fail(res, 400, "bad-id", "Invalid comment");
    const { reaction } = req.body;
    if (!["like", "dislike", "none"].includes(reaction)) return fail(res, 400, "bad-reaction", "Reaction must be like, dislike or none.");

    const uid = req.user._id;
    const filter = { _id: req.params.id, deletedAt: { $exists: false }, status: "visible" };
    const update =
      reaction === "like" ? { $addToSet: { likes: uid }, $pull: { dislikes: uid } }
      : reaction === "dislike" ? { $addToSet: { dislikes: uid }, $pull: { likes: uid } }
      : { $pull: { likes: uid, dislikes: uid } };

    const changed = await Comment.updateOne(filter, update);
    if (!changed.matchedCount) return fail(res, 404, "no-comment", "Comment not found");

    // Counts come from the arrays, so they cannot drift even when requests overlap.
    const after = await Comment.findOneAndUpdate(filter, [{ $set: { likeCount: { $size: "$likes" }, dislikeCount: { $size: "$dislikes" } } }], { returnDocument: "after", updatePipeline: true });
    res.json({ success: true, likeCount: after.likeCount, dislikeCount: after.dislikeCount, myReaction: reaction === "none" ? null : reaction });
  })
);

// ---------- reports ----------

router.post(
  "/:id/report",
  auth,
  asyncHandler(async (req, res) => {
    if (!isId(req.params.id)) return fail(res, 400, "bad-id", "Invalid comment");
    const { reason } = req.body;
    if (!REASONS.includes(reason)) return fail(res, 400, "bad-reason", "Choose a reason for your report.", { reasons: REASONS });

    const reportsThisHour = await CommentReport.countDocuments({
      reporter: req.user._id,
      createdAt: { $gte: new Date(Date.now() - 3600 * 1000) },
    });
    if (reportsThisHour >= 20) return fail(res, 429, "rate-limited", "You've sent a lot of reports. Please try again later.");

    const comment = await Comment.findById(req.params.id);
    if (!comment || !isLive(comment)) return fail(res, 404, "no-comment", "Comment not found");
    if (String(comment.user) === String(req.user._id)) return fail(res, 400, "own-comment", "You can't report your own comment.");

    try {
      var report = await CommentReport.create({
        comment: comment._id,
        reporter: req.user._id,
        reason,
        details: String(req.body.details || "").trim().slice(0, 500) || undefined,
        textSnapshot: comment.text,
      });
    } catch (error) {
      if (error.code === 11000) return fail(res, 409, "already-reported", "You've already reported this comment. Our team will review it.");
      throw error;
    }

    // Flag for a moderator. Nothing is removed automatically, and dislikes play no part.
    await Comment.updateOne({ _id: comment._id }, { $inc: { reportCount: 1 }, $set: { flagged: true } });
    await ModerationLog.create({ action: "report_filed", actor: req.user._id, targetUser: comment.user, comment: comment._id, report: report._id, video: comment.video, code: reason, excerpt: comment.text.slice(0, 160) });

    res.status(201).json({ success: true, message: "Thanks. Our moderators will review this comment." });
  })
);

// ---------- translation ----------

const translateHits = new Map();

router.post(
  "/:id/translate",
  auth,
  asyncHandler(async (req, res) => {
    if (!isId(req.params.id)) return fail(res, 400, "bad-id", "Invalid comment");
    const expectedVersion = Number(req.body.version);
    if (!Number.isInteger(expectedVersion)) return fail(res, 400, "bad-version", "Missing comment version.");
    const target = String(req.body.target || req.user.preferredLanguage || "en");
    if (!LANGUAGES[target]) return fail(res, 400, "bad-language", "That language isn't supported.");

    const comment = await Comment.findById(req.params.id).select("text version status deletedAt");
    if (!comment || !isLive(comment)) return fail(res, 404, "no-comment", "Comment not found");
    if (comment.version !== expectedVersion) return fail(res, 409, "comment-changed", "This comment changed. Please try translating the latest version.");

    const cached = await CommentTranslation.findOne({ comment: comment._id, version: comment.version, target }).lean();
    if (cached) {
      const latest = await Comment.findById(comment._id).select("version status deletedAt").lean();
      if (!latest || !isLive(latest)) return fail(res, 404, "no-comment", "This comment is no longer available.");
      if (latest.version !== expectedVersion) return fail(res, 409, "comment-changed", "This comment changed. Please try translating the latest version.");
      return res.json({ success: true, text: cached.text, detectedLanguage: cached.detectedLanguage, target, version: comment.version, cached: true });
    }

    const hits = (translateHits.get(String(req.user._id)) || []).filter((t) => t > Date.now() - 60 * 1000);
    if (hits.length >= 30) return fail(res, 429, "rate-limited", "You're translating very quickly. Please wait a moment.");
    hits.push(Date.now());
    translateHits.set(String(req.user._id), hits);

    let result;
    try {
      result = await translate(comment.text, target);
    } catch (error) {
      if (!(error instanceof TranslateError)) console.error("[comments] translate error:", error);
      return fail(res, 502, "translate-failed", "This comment couldn't be translated right now. The original is still shown.");
    }

    const latest = await Comment.findById(comment._id).select("version status deletedAt").lean();
    if (!latest || !isLive(latest)) return fail(res, 404, "no-comment", "This comment is no longer available.");
    if (latest.version !== expectedVersion) return fail(res, 409, "comment-changed", "This comment changed while it was being translated. Please try again.");

    if (result.detectedLanguage === target || result.text.trim() === comment.text.trim()) {
      return res.json({ success: true, text: comment.text, detectedLanguage: result.detectedLanguage || target, target, version: comment.version, sameLanguage: true });
    }

    try {
      await CommentTranslation.updateOne(
        { comment: comment._id, version: comment.version, target },
        { $setOnInsert: { text: result.text, detectedLanguage: result.detectedLanguage } },
        { upsert: true }
      );
    } catch (error) {
      if (error.code !== 11000) console.error("[comments] translation cache failed:", error.message);
    }

    res.json({ success: true, text: result.text, detectedLanguage: result.detectedLanguage, target, version: comment.version, cached: false });
  })
);

// ---------- moderators ----------

router.get(
  "/admin/reports",
  auth,
  adminOnly,
  asyncHandler(async (req, res) => {
    const status = ["open", "dismissed", "actioned"].includes(req.query.status) ? req.query.status : "open";
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);

    const [reports, total] = await Promise.all([
      CommentReport.find({ status })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("reporter", "username name")
        .populate({ path: "comment", select: "text status deletedAt user video reportCount createdAt", populate: { path: "user", select: "username name" } })
        .populate("resolvedBy", "username name")
        .lean(),
      CommentReport.countDocuments({ status }),
    ]);

    res.json({ success: true, reports, total, page, pages: Math.max(Math.ceil(total / limit), 1) });
  })
);

router.post(
  "/admin/reports/:id/resolve",
  auth,
  adminOnly,
  asyncHandler(async (req, res) => {
    if (!isId(req.params.id)) return fail(res, 400, "bad-id", "Invalid report");
    const { action } = req.body;
    if (!["dismiss", "remove"].includes(action)) return fail(res, 400, "bad-action", "Action must be dismiss or remove.");
    const note = String(req.body.note || "").trim().slice(0, 300) || undefined;

    const report = await CommentReport.findOneAndUpdate(
      { _id: req.params.id, status: "open" },
      { status: action === "dismiss" ? "dismissed" : "actioned", resolvedBy: req.user._id, resolvedAt: new Date(), resolutionNote: note },
      { returnDocument: "after" }
    );
    if (!report) return fail(res, 409, "already-resolved", "This report was already handled.");

    const comment = await Comment.findById(report.comment);
    if (!comment) return res.json({ success: true });

    if (action === "remove") {
      const removed = await Comment.updateOne({ _id: comment._id, status: "visible" }, { status: "removed", removedAt: new Date(), removedBy: req.user._id });
      if (removed.modifiedCount && comment.parent) await recountReplies(comment.parent);
      // Every other open report on the same comment is covered by this decision.
      await CommentReport.updateMany({ comment: comment._id, status: "open" }, { status: "actioned", resolvedBy: req.user._id, resolvedAt: new Date(), resolutionNote: note || "Comment removed" });
      await Comment.updateOne({ _id: comment._id }, { flagged: false });
      await ModerationLog.create({ action: "comment_removed", actor: req.user._id, targetUser: comment.user, comment: comment._id, report: report._id, video: comment.video, code: report.reason, detail: note, excerpt: comment.text.slice(0, 160) });
    } else {
      const stillOpen = await CommentReport.exists({ comment: comment._id, status: "open" });
      if (!stillOpen) await Comment.updateOne({ _id: comment._id }, { flagged: false });
      await ModerationLog.create({ action: "report_dismissed", actor: req.user._id, targetUser: comment.user, comment: comment._id, report: report._id, video: comment.video, code: report.reason, detail: note });
    }
    res.json({ success: true });
  })
);

router.post(
  "/admin/comments/:id/restore",
  auth,
  adminOnly,
  asyncHandler(async (req, res) => {
    if (!isId(req.params.id)) return fail(res, 400, "bad-id", "Invalid comment");
    const comment = await Comment.findOneAndUpdate(
      { _id: req.params.id, status: "removed", deletedAt: { $exists: false } },
      { status: "visible", flagged: false, $unset: { removedAt: "", removedBy: "" } },
      { returnDocument: "after" }
    );
    if (!comment) return fail(res, 404, "no-comment", "Nothing to restore");
    if (comment.parent) await recountReplies(comment.parent);
    await ModerationLog.create({ action: "comment_restored", actor: req.user._id, targetUser: comment.user, comment: comment._id, video: comment.video, excerpt: comment.text.slice(0, 160) });
    res.json({ success: true });
  })
);

router.get(
  "/admin/comments/:id/history",
  auth,
  adminOnly,
  asyncHandler(async (req, res) => {
    if (!isId(req.params.id)) return fail(res, 400, "bad-id", "Invalid comment");
    const comment = await Comment.findById(req.params.id).populate("user", "username name").populate("removedBy", "username name").lean();
    if (!comment) return fail(res, 404, "no-comment", "Comment not found");
    const [reports, log] = await Promise.all([
      CommentReport.find({ comment: comment._id }).sort({ createdAt: 1 }).populate("reporter", "username").populate("resolvedBy", "username").lean(),
      ModerationLog.find({ comment: comment._id }).sort({ createdAt: 1 }).populate("actor", "username").lean(),
    ]);
    const editHistory = await CommentEditHistory.find({
      comment: comment._id,
      version: { $lt: comment.version },
    })
      .sort({ version: 1 })
      .select("version text editedAt")
      .lean();
    const historyByVersion = new Map((comment.history || []).map((entry) => [entry.version, entry]));
    for (const entry of editHistory) historyByVersion.set(entry.version, entry);
    const history = [...historyByVersion.values()].sort((a, b) => a.version - b.version);
    res.json({ success: true, comment: { ...comment, history, likes: undefined, dislikes: undefined }, reports, log });
  })
);

router.get(
  "/admin/log",
  auth,
  adminOnly,
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const filter = typeof req.query.action === "string" && req.query.action ? { action: req.query.action } : {};
    const [entries, total] = await Promise.all([
      ModerationLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate("actor", "username name").populate("targetUser", "username name").lean(),
      ModerationLog.countDocuments(filter),
    ]);
    res.json({ success: true, entries, total, page, pages: Math.max(Math.ceil(total / limit), 1) });
  })
);

module.exports = router;
