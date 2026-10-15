const express = require("express");
const mongoose = require("mongoose");

const Video = require("../models/Video");
const PremiumUnlock = require("../models/PremiumUnlock");
const protect = require("../middleware/authMiddleware");
const optionalAuth = require("../middleware/optionalAuth");
const adminOnly = require("../middleware/adminMiddleware");
const { rankOf } = require("../config/plans");
const { periodInfo } = require("../utils/periods");
const { TIMEZONE } = require("../config/downloadPlans");
const { requiredPlanFor, checkPlayback } = require("../services/accessService");
const { subscriptionState, usageFor } = require("../services/subscriptionService");

const router = express.Router();

const ACCESS_LEVELS = ["Free", "Bronze", "Silver", "Gold"];

// What the library shows about a video. Stream URLs are never included here;
// they're only returned by GET /:id after the access check.
const publicVideo = (video, viewerPlan) => {
  const required = requiredPlanFor(video);
  const { videoUrl: _url, sources: _sources, captions: _captions, ...rest } = video;
  return {
    ...rest,
    minPlan: video.minPlan || (video.premium ? "Bronze" : "Free"),
    requiredPlan: required.plan,
    accessReason: required.reason,
    earlyAccessUntil: video.earlyAccessUntil || null,
    exclusive: required.reason === "exclusive",
    premium: required.plan !== "Free",
    locked: rankOf(viewerPlan) < rankOf(required.plan),
  };
};

/*
  GET ALL VIDEOS — public list; "locked" reflects the signed-in viewer's plan.
*/
router.get("/", optionalAuth, async (req, res) => {
  try {
    const videos = await Video.find().sort({ createdAt: -1 }).lean();
    const plan = req.user ? subscriptionState(req.user).plan : "Free";
    res.json({ success: true, videos: videos.map((video) => publicVideo(video, plan)) });
  } catch (error) {
    console.error("GET VIDEOS ERROR:", error);
    res.status(500).json({ success: false, message: "Unable to fetch videos" });
  }
});

/*
  GET SINGLE VIDEO — returns the stream URL only if the viewer's plan allows it.
*/
router.get("/:id", optionalAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Video not found" });
    }

    const video = await Video.findById(req.params.id).lean();
    if (!video) {
      return res.status(404).json({ success: false, message: "Video not found" });
    }

    if (!req.user) {
      return res.status(401).json({ success: false, code: "login-required", message: "Sign in to watch videos. It's free." });
    }

    const result = await checkPlayback(req.user, video);
    if (!result.ok) {
      const { ok: _ok, status, ...details } = result;
      return res.status(status).json({ success: false, ...details, video: publicVideo(video, subscriptionState(req.user).plan) });
    }

    return res.json({
      success: true,
      video: { ...publicVideo(video, result.state.plan), videoUrl: result.source.url, captions: video.captions || [] },
      playback: result.playback,
    });
  } catch (error) {
    console.error("GET VIDEO ERROR:", error);
    res.status(500).json({ success: false, message: "Unable to fetch video" });
  }
});

/*
  UNLOCK — a Free member uses one of their monthly premium videos.
*/
router.post("/:id/unlock", optionalAuth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, code: "login-required", message: "Sign in to watch videos." });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: "Video not found" });

    const video = await Video.findById(req.params.id).lean();
    if (!video) return res.status(404).json({ success: false, message: "Video not found" });

    const state = subscriptionState(req.user);
    const required = requiredPlanFor(video);
    if (rankOf(state.plan) >= rankOf(required.plan)) return res.json({ success: true, unlocked: true, included: true });
    if (state.plan !== "Free" || required.plan !== "Bronze" || required.reason !== "premium") {
      return res.status(403).json({ success: false, code: "upgrade-required", requiredPlan: required.plan, message: `This video needs the ${required.plan} plan.` });
    }

    const { monthKey } = periodInfo(TIMEZONE);
    if (await PremiumUnlock.exists({ user: req.user._id, video: video._id, monthKey })) {
      return res.json({ success: true, unlocked: true });
    }

    const usage = await usageFor(req.user, state);
    if (usage.premiumUnlocks.remaining <= 0) {
      return res.status(403).json({ success: false, code: "upgrade-required", requiredPlan: "Bronze", message: "You've used all your free premium videos this month." });
    }

    try {
      await PremiumUnlock.create({ user: req.user._id, video: video._id, monthKey });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }

    // Re-check: two quick unlocks from different tabs could both pass the count above.
    const used = await PremiumUnlock.countDocuments({ user: req.user._id, monthKey });
    if (used > usage.premiumUnlocks.limit) {
      await PremiumUnlock.deleteOne({ user: req.user._id, video: video._id, monthKey });
      return res.status(403).json({ success: false, code: "upgrade-required", requiredPlan: "Bronze", message: "You've used all your free premium videos this month." });
    }

    res.json({ success: true, unlocked: true, remaining: Math.max(0, usage.premiumUnlocks.limit - used) });
  } catch (error) {
    console.error("UNLOCK VIDEO ERROR:", error);
    res.status(500).json({ success: false, message: "Unable to unlock video" });
  }
});

// ============================================================
// ADMIN
// ============================================================

const readAccessFields = (body) => {
  const fields = {};
  if (body.minPlan !== undefined) {
    if (!ACCESS_LEVELS.includes(body.minPlan)) throw new Error("Access level must be Free, Bronze, Silver or Gold");
    fields.minPlan = body.minPlan;
    fields.premium = body.minPlan !== "Free";
  } else if (body.premium !== undefined) {
    fields.premium = Boolean(body.premium);
    fields.minPlan = fields.premium ? "Bronze" : "Free";
  }
  if (body.earlyAccessUntil !== undefined) {
    fields.earlyAccessUntil = body.earlyAccessUntil ? new Date(body.earlyAccessUntil) : null;
    if (fields.earlyAccessUntil && Number.isNaN(fields.earlyAccessUntil.getTime())) throw new Error("Early access date is invalid");
  }
  if (Array.isArray(body.sources)) {
    fields.sources = body.sources
      .filter((source) => source && /^https?:\/\//i.test(source.url) && [360, 480, 720, 1080, 2160].includes(Number(source.quality)))
      .map((source) => ({ quality: Number(source.quality), url: String(source.url) }));
  }
  if (Array.isArray(body.captions)) {
    const captions = body.captions.map((caption) => ({
      language: String(caption?.language || "").trim(),
      label: String(caption?.label || "").trim(),
      url: String(caption?.url || "").trim(),
      default: Boolean(caption?.default),
    }));
    if (captions.some((caption) => !caption.language || !caption.label || !/^https?:\/\//i.test(caption.url))) {
      throw new Error("Each caption track needs a language, label and valid URL");
    }
    fields.captions = captions.map((caption, index) => ({
      ...caption,
      default: caption.default && captions.findIndex((item) => item.default) === index,
    }));
  }
  return fields;
};

// CREATE VIDEO - admin only
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const { title, description, category, thumbnail, videoUrl, duration } = req.body;

    if (!title || !category || !thumbnail || !videoUrl) {
      return res.status(400).json({ success: false, message: "Title, category, thumbnail and video URL are required" });
    }

    let access;
    try {
      access = readAccessFields(req.body);
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }

    const video = await Video.create({ title, description, category, thumbnail, videoUrl, duration, premium: false, minPlan: "Free", ...access });
    res.status(201).json({ success: true, message: "Video created successfully", video });
  } catch (error) {
    console.error("CREATE VIDEO ERROR:", error);
    res.status(500).json({ success: false, message: "Unable to create video" });
  }
});

// UPDATE VIDEO - admin only
router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    const { title, description, category, thumbnail, videoUrl, duration } = req.body;
    const video = await Video.findById(req.params.id);

    if (!video) {
      return res.status(404).json({ success: false, message: "Video not found" });
    }

    let access;
    try {
      access = readAccessFields(req.body);
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }

    video.title = title ?? video.title;
    video.description = description ?? video.description;
    video.category = category ?? video.category;
    video.thumbnail = thumbnail ?? video.thumbnail;
    video.videoUrl = videoUrl ?? video.videoUrl;
    video.duration = duration ?? video.duration;
    Object.assign(video, access);

    await video.save();
    res.json({ success: true, message: "Video updated successfully", video });
  } catch (error) {
    console.error("Update video error:", error);
    res.status(500).json({ success: false, message: "Failed to update video" });
  }
});

// Admin view with stream URLs (for editing).
router.get("/admin/all", protect, adminOnly, async (req, res) => {
  const videos = await Video.find().sort({ createdAt: -1 }).lean();
  res.json({ success: true, videos });
});

// DELETE VIDEO - admin only
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const video = await Video.findByIdAndDelete(req.params.id);

    if (!video) {
      return res.status(404).json({ success: false, message: "Video not found" });
    }

    res.json({ success: true, message: "Video deleted successfully" });
  } catch (error) {
    console.error("Delete video error:", error);
    res.status(500).json({ success: false, message: "Failed to delete video" });
  }
});

module.exports = router;
