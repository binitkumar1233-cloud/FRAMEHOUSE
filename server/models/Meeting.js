const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const participantSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    displayName: { type: String, required: true },
    socketId: String,
    role: {
      type: String,
      enum: ["host", "co-host", "participant"],
      default: "participant",
    },
    audioMuted: { type: Boolean, default: false },
    videoMuted: { type: Boolean, default: false },
    screenSharing: { type: Boolean, default: false },
    handRaised: { type: Boolean, default: false },
    connectionQuality: {
      type: String,
      enum: ["good", "average", "poor"],
      default: "good",
    },
    joinedAt: { type: Date, default: Date.now },
    leftAt: Date,
    isConnected: { type: Boolean, default: true },
  },
  { _id: false }
);

const meetingSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      index: true,
    },
    title: {
      type: String,
      default: "Untitled Meeting",
      trim: true,
      maxlength: 120,
    },
    type: {
      type: String,
      enum: ["one-to-one", "group"],
      default: "group",
    },
    host: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    coHosts: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // Hashed passcode. Never selected by default, so it cannot leak
    // through any API response.
    password: {
      type: String,
      default: "",
      select: false,
    },
    hasPassword: {
      type: Boolean,
      default: false,
    },
    // Users removed by a host. They cannot rejoin this meeting.
    removedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    permissions: {
      participantScreenShare: { type: Boolean, default: true },
      participantChat: { type: Boolean, default: true },
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
    waitingRoomEnabled: {
      type: Boolean,
      default: false,
    },
    maxParticipants: {
      type: Number,
      default: 10,
    },
    status: {
      type: String,
      enum: ["scheduled", "live", "ended"],
      default: "live",
    },
    // Users who cleared this meeting from their own history.
    hiddenFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    recordingEnabled: {
      type: Boolean,
      default: false,
    },
    recordingStatus: {
      type: String,
      enum: ["idle", "recording", "stopped"],
      default: "idle",
    },
    participants: [participantSchema],
    startedAt: {
      type: Date,
      default: Date.now,
    },
    endedAt: Date,
  },
  { timestamps: true }
);

const sameId = (a, b) => Boolean(a && b) && a.toString() === b.toString();

meetingSchema.methods.isHost = function isHost(userId) {
  return sameId(this.host, userId);
};

meetingSchema.methods.isHostOrCoHost = function isHostOrCoHost(userId) {
  if (this.isHost(userId)) return true;
  return this.coHosts.some((item) => sameId(item, userId));
};

meetingSchema.methods.isRemoved = function isRemoved(userId) {
  return this.removedUsers.some((item) => sameId(item, userId));
};

meetingSchema.methods.findParticipant = function findParticipant(userId) {
  return this.participants.find((p) => sameId(p.user, userId));
};

meetingSchema.methods.roleOf = function roleOf(userId) {
  if (this.isHost(userId)) return "host";
  if (this.coHosts.some((item) => sameId(item, userId))) return "co-host";
  return "participant";
};

meetingSchema.methods.setPassword = async function setPassword(plain) {
  const value = String(plain || "").trim();
  this.password = value ? await bcrypt.hash(value, 10) : "";
  this.hasPassword = Boolean(value);
};

// Requires the document to have been loaded with .select("+password").
meetingSchema.methods.checkPassword = async function checkPassword(plain) {
  const stored = this.password || "";
  if (!this.hasPassword && !stored) return true;
  if (!stored) return false;
  // Meetings created before passcodes were hashed stored plain text.
  if (!stored.startsWith("$2")) return stored === String(plain || "");
  return bcrypt.compare(String(plain || ""), stored);
};

meetingSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.password;
    return ret;
  },
});

module.exports = mongoose.model("Meeting", meetingSchema);
