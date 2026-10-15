const express = require("express");
const meetingController = require("../controllers/meeting.controller");
const auth = require("../middleware/auth");
const requireMeetingHost = require("../middleware/requireMeetingHost");

const { getIceConfig } = require("../services/iceServers");

const router = express.Router();

router.use(auth);

router.get("/ice-servers", async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ success: true, ...(await getIceConfig(String(req.user._id))) });
});
router.post("/", meetingController.createMeeting);
router.get("/mine", meetingController.listMyMeetings);
router.delete("/mine", meetingController.clearMyHistory);
router.get("/:roomId", meetingController.getMeeting);
router.post("/:roomId/join", meetingController.joinMeeting);
router.get("/:roomId/chat", meetingController.getChat);

router.patch(
  "/:roomId/controls",
  requireMeetingHost,
  meetingController.updateHostControls
);
router.post("/:roomId/mute-all", requireMeetingHost, meetingController.muteAll);
router.post("/:roomId/kick", requireMeetingHost, meetingController.kickParticipant);
router.post("/:roomId/end", requireMeetingHost, meetingController.endMeeting);
router.post(
  "/:roomId/recording",
  requireMeetingHost,
  meetingController.toggleRecording
);

module.exports = router;
