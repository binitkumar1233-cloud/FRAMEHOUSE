const Meeting = require("../models/Meeting");

const requireMeetingHost = async (req, res, next) => {
  try {
    const meeting = await Meeting.findOne({
      roomId: req.params.roomId,
    });

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: "Meeting not found",
      });
    }

    const isHost = meeting.host.toString() === req.user._id.toString();
    const isCoHost = meeting.coHosts.some(
      (id) => id.toString() === req.user._id.toString()
    );

    if (!isHost && !isCoHost && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Only the host can perform this action",
      });
    }

    req.meeting = meeting;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = requireMeetingHost;
