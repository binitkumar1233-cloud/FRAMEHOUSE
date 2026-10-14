const express = require("express");
const mongoose = require("mongoose");

const WatchProgress = require("../models/WatchProgress");
const WatchUsage = require("../models/WatchUsage");
const User = require("../models/User");
const protect = require("../middleware/authMiddleware");
const { periodInfo } = require("../utils/periods");
const { TIMEZONE } = require("../config/downloadPlans");
const { completionPercent, completionRatio } = require("../config/watchProgress");
const { subscriptionState, usageFor } = require("../services/subscriptionService");

const router = express.Router();

// The player sends a heartbeat about every 10 seconds while playing.
const HEARTBEAT_SECONDS = 10;

/**
 * Adds watch time using the server's clock between heartbeats, so a client
 * can't claim more than real time. Long gaps (paused, tab closed) count as one beat.
 */
const recordWatchTime = async (userId) => {
  const { dayKey } = periodInfo(TIMEZONE);
  const now = new Date();

  // Atomically take the time slot since the previous beat: simultaneous
  // requests each see a different "previous" time, so they can't double-count.
  const previous = await WatchUsage.findOneAndUpdate(
    { user: userId, dayKey },
    { $set: { lastBeatAt: now }, $setOnInsert: { seconds: 0 } },
    { upsert: true, returnDocument: "before" }
  ).lean();

  const elapsed = previous?.lastBeatAt ? (now - new Date(previous.lastBeatAt)) / 1000 : HEARTBEAT_SECONDS;
  const credit = elapsed > HEARTBEAT_SECONDS * 3 ? HEARTBEAT_SECONDS : Math.max(0, Math.min(elapsed, HEARTBEAT_SECONDS + 2));
  if (credit > 0) await WatchUsage.updateOne({ user: userId, dayKey }, { $inc: { seconds: credit } });
};

// Save progress (also the watch-time heartbeat)
router.post("/", protect, async (req, res) => {
  try {
    const { videoId, progress, duration, playing = true } = req.body;

    if (!videoId || !mongoose.isValidObjectId(videoId)) {
      return res.status(400).json({
        success: false,
        message: "videoId is required",
      });
    }

    const progressValue = Number(progress) || 0;
    const durationValue = Number(duration) || 0;
    const completed = durationValue > 0 && progressValue >= durationValue * completionRatio;

    const saved = await WatchProgress.findOneAndUpdate(
      { user: req.user.userId, video: videoId },
      { progress: progressValue, duration: durationValue, completed },
      { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
    );

    const user = await User.findById(req.user.userId);
    const state = subscriptionState(user);
    if (playing && state.limits.dailyWatchMinutes !== null) await recordWatchTime(user._id);
    const { watch } = await usageFor(user, state);

    res.json({
      success: true,
      progress: saved,
      completionThresholdPercent: completionPercent,
      watch,
      // true = the player should stop: today's watch limit is used up.
      limitReached: watch.limitSeconds !== null && watch.remainingSeconds <= 0,
    });
  } catch (error) {
    console.error("Save progress error:", error);
    res.status(500).json({ success: false, message: "Failed to save watch progress" });
  }
});

// Get user's watch progress
router.get("/", protect, async (req, res) => {
  try {
    const progress = await WatchProgress.find({ user: req.user.userId })
      .populate("video")
      .sort({ updatedAt: -1 });

    // The populated videos must not leak stream URLs past the access checks.
    const safe = progress.map((item) => {
      const plain = item.toObject();
      if (plain.video) {
        delete plain.video.videoUrl;
        delete plain.video.sources;
      }
      return plain;
    });

    res.json({ success: true, progress: safe });
  } catch (error) {
    console.error("Get progress error:", error);
    res.status(500).json({ success: false, message: "Failed to get watch progress" });
  }
});

module.exports = router;
