const Meeting = require("../models/Meeting");
const ChatMessage = require("../models/ChatMessage");
const Recording = require("../models/Recording");
const asyncHandler = require("../utils/asyncHandler");
const generateRoomId = require("../utils/generateRoomId");
const { subscriptionState } = require("../services/subscriptionService");

const uniqueRoomId = async () => {
  let roomId = generateRoomId();
  while (await Meeting.findOne({ roomId })) {
    roomId = generateRoomId();
  }
  return roomId;
};

const PLAN_LIMITS = {
  Free: { maxParticipants: 2 },
  Bronze: { maxParticipants: 5 },
  Silver: { maxParticipants: 15 },
  Gold: { maxParticipants: 50 },
};

// Live-socket helpers registered in index.js (see meeting.socket.js).
const hub = (req) => req.app.get("meetingHub");

// What any admitted participant may see about a meeting.
const publicMeeting = (meeting) => ({
  _id: meeting._id,
  roomId: meeting.roomId,
  title: meeting.title,
  type: meeting.type,
  status: meeting.status,
  isLocked: meeting.isLocked,
  hasPassword: meeting.hasPassword,
  maxParticipants: meeting.maxParticipants,
  permissions: meeting.permissions,
  startedAt: meeting.startedAt,
  endedAt: meeting.endedAt,
  createdAt: meeting.createdAt,
  participants: meeting.participants.map((p) => ({
    user: p.user,
    displayName: p.displayName,
    role: p.role,
    isConnected: p.isConnected,
  })),
});

exports.createMeeting = asyncHandler(async (req, res) => {
  const { title, type, password, maxParticipants } = req.body;
  const limits = PLAN_LIMITS[subscriptionState(req.user).plan] || PLAN_LIMITS.Free;
  const isOneToOne = type === "one-to-one";

  const meeting = new Meeting({
    roomId: await uniqueRoomId(),
    title: String(title || `${req.user.name}'s meeting`).trim().slice(0, 120),
    type: isOneToOne ? "one-to-one" : "group",
    host: req.user._id,
    maxParticipants: isOneToOne
      ? 2
      : Math.max(2, Math.min(Number(maxParticipants) || limits.maxParticipants, limits.maxParticipants)),
    status: "live",
    participants: [
      {
        user: req.user._id,
        displayName: req.user.name,
        role: "host",
        isConnected: false,
      },
    ],
  });

  await meeting.setPassword(password);
  await meeting.save();

  res.status(201).json({ success: true, meeting: publicMeeting(meeting) });
});

exports.getMeeting = asyncHandler(async (req, res) => {
  const meeting = await Meeting.findOne({ roomId: String(req.params.roomId).toUpperCase() });

  if (!meeting) {
    return res.status(404).json({ success: false, message: "Meeting not found" });
  }

  // Non-participants only learn whether the meeting exists and needs a passcode.
  if (!meeting.findParticipant(req.user._id) && !meeting.isHostOrCoHost(req.user._id)) {
    return res.json({
      success: true,
      meeting: {
        roomId: meeting.roomId,
        title: meeting.title,
        type: meeting.type,
        status: meeting.status,
        hasPassword: meeting.hasPassword,
        isLocked: meeting.isLocked,
      },
    });
  }

  res.json({ success: true, meeting: publicMeeting(meeting) });
});

exports.joinMeeting = asyncHandler(async (req, res) => {
  const meeting = await Meeting.findOne({ roomId: String(req.params.roomId).toUpperCase() }).select("+password");

  if (!meeting) {
    return res.status(404).json({ success: false, message: "Meeting not found" });
  }

  if (meeting.status === "ended") {
    return res.status(400).json({ success: false, message: "This meeting has ended" });
  }

  if (meeting.isRemoved(req.user._id)) {
    return res.status(403).json({ success: false, message: "You were removed from this meeting by the host" });
  }

  const isStaff = meeting.isHostOrCoHost(req.user._id);
  const alreadyIn = meeting.findParticipant(req.user._id);

  if (meeting.isLocked && !isStaff && !alreadyIn) {
    return res.status(403).json({ success: false, message: "The host has locked this meeting" });
  }

  if (!isStaff && !alreadyIn && !(await meeting.checkPassword(req.body.password))) {
    return res.status(403).json({
      success: false,
      code: "password-required",
      message: req.body.password ? "Incorrect passcode" : "This meeting requires a passcode",
    });
  }

  const connectedCount = meeting.participants.filter((p) => p.isConnected).length;
  if (!alreadyIn && !isStaff && connectedCount >= meeting.maxParticipants) {
    return res.status(403).json({ success: false, message: "This meeting is full" });
  }

  // Admit the user. The socket connection marks them as connected.
  if (alreadyIn) {
    alreadyIn.displayName = req.user.name;
  } else {
    meeting.participants.push({
      user: req.user._id,
      displayName: req.user.name,
      role: meeting.roleOf(req.user._id),
      isConnected: false,
    });
  }

  await meeting.save();

  res.json({ success: true, meeting: publicMeeting(meeting) });
});

exports.listMyMeetings = asyncHandler(async (req, res) => {
  const meetings = await Meeting.find({
    $or: [{ host: req.user._id }, { "participants.user": req.user._id }],
    hiddenFor: { $ne: req.user._id },
  })
    .sort({ createdAt: -1 })
    .limit(50);

  res.json({ success: true, meetings: meetings.map(publicMeeting) });
});

// Clears ended meetings from the caller's history only; other participants keep theirs.
exports.clearMyHistory = asyncHandler(async (req, res) => {
  const result = await Meeting.updateMany(
    {
      $or: [{ host: req.user._id }, { "participants.user": req.user._id }],
      status: "ended",
    },
    { $addToSet: { hiddenFor: req.user._id } }
  );
  res.json({ success: true, cleared: result.modifiedCount });
});

exports.updateHostControls = asyncHandler(async (req, res) => {
  const meeting = req.meeting;
  const { isLocked, waitingRoomEnabled, title, maxParticipants, permissions } = req.body;

  if (typeof isLocked === "boolean") meeting.isLocked = isLocked;
  if (typeof waitingRoomEnabled === "boolean") meeting.waitingRoomEnabled = waitingRoomEnabled;
  if (title) meeting.title = String(title).trim().slice(0, 120);
  if (maxParticipants && meeting.type === "group") {
    const limits = PLAN_LIMITS[subscriptionState(req.user).plan] || PLAN_LIMITS.Free;
    meeting.maxParticipants = Math.max(2, Math.min(Number(maxParticipants), limits.maxParticipants));
  }
  if (permissions && typeof permissions === "object") {
    if (typeof permissions.participantScreenShare === "boolean") {
      meeting.permissions.participantScreenShare = permissions.participantScreenShare;
    }
    if (typeof permissions.participantChat === "boolean") {
      meeting.permissions.participantChat = permissions.participantChat;
    }
  }

  await meeting.save();

  hub(req)?.updateRoomMeta(meeting.roomId, {
    isLocked: meeting.isLocked,
    title: meeting.title,
    maxParticipants: meeting.maxParticipants,
    permissions: meeting.permissions,
  });
  req.app.get("io")?.to(meeting.roomId).emit("meeting-updated", {
    isLocked: meeting.isLocked,
    permissions: meeting.permissions,
  });

  res.json({ success: true, meeting: publicMeeting(meeting) });
});

exports.muteAll = asyncHandler(async (req, res) => {
  const meeting = req.meeting;
  const io = req.app.get("io");

  meeting.participants.forEach((p) => {
    if (p.role === "participant") {
      p.audioMuted = true;
      if (p.isConnected && p.socketId) io?.to(p.socketId).emit("force-mute", { by: req.user.name });
    }
  });

  await meeting.save();
  res.json({ success: true, meeting: publicMeeting(meeting) });
});

exports.kickParticipant = asyncHandler(async (req, res) => {
  const meeting = req.meeting;
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, message: "userId is required" });
  }

  if (meeting.isHost(userId)) {
    return res.status(400).json({ success: false, message: "The host cannot be removed" });
  }

  if (!meeting.isRemoved(userId)) meeting.removedUsers.push(userId);
  meeting.coHosts = meeting.coHosts.filter((id) => id.toString() !== String(userId));
  meeting.participants.forEach((p) => {
    if (p.user && p.user.toString() === String(userId)) {
      p.isConnected = false;
      p.leftAt = new Date();
    }
  });

  await meeting.save();
  await hub(req)?.removeUserFromRoom(meeting.roomId, String(userId), `Removed by ${req.user.name}`);

  res.json({ success: true, meeting: publicMeeting(meeting) });
});

exports.endMeeting = asyncHandler(async (req, res) => {
  const meeting = req.meeting;
  meeting.status = "ended";
  meeting.endedAt = new Date();
  meeting.participants.forEach((p) => {
    p.isConnected = false;
    p.leftAt = p.leftAt || new Date();
  });
  await meeting.save();

  hub(req)?.endRoom(meeting.roomId);

  res.json({ success: true, meeting: publicMeeting(meeting) });
});

exports.toggleRecording = asyncHandler(async (req, res) => {
  const meeting = req.meeting;

  if (meeting.recordingStatus === "recording") {
    meeting.recordingStatus = "stopped";
    await Recording.findOneAndUpdate(
      { meeting: meeting._id, status: "recording" },
      { status: "ready", endedAt: new Date() }
    );
  } else {
    meeting.recordingStatus = "recording";
    await Recording.create({
      meeting: meeting._id,
      roomId: meeting.roomId,
      host: req.user._id,
      status: "recording",
      storage: "local",
    });
  }

  meeting.recordingEnabled = true;
  await meeting.save();

  const active = meeting.recordingStatus === "recording";
  hub(req)?.updateRoomMeta(meeting.roomId, { recording: active });
  req.app.get("io")?.to(meeting.roomId).emit("recording-state", { active, by: req.user.name });

  res.json({ success: true, meeting: publicMeeting(meeting) });
});

exports.getChat = asyncHandler(async (req, res) => {
  const roomId = String(req.params.roomId).toUpperCase();
  const meeting = await Meeting.findOne({ roomId });

  if (!meeting) {
    return res.status(404).json({ success: false, message: "Meeting not found" });
  }

  if (!meeting.findParticipant(req.user._id) && !meeting.isHostOrCoHost(req.user._id)) {
    return res.status(403).json({ success: false, message: "Only participants can read this chat" });
  }

  const messages = await ChatMessage.find({ roomId }).sort({ createdAt: 1 }).limit(200);

  res.json({ success: true, messages });
});
