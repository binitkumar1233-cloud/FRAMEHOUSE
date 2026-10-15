const jwt = require("jsonwebtoken");
const { isSessionActive } = require("../services/loginSecurity");
const Meeting = require("../models/Meeting");
const ChatMessage = require("../models/ChatMessage");
const Recording = require("../models/Recording");
const User = require("../models/User");

// ============================================================
// LIMITS
// ============================================================

const MAX_TEXT_LENGTH = 2000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const CHAT_WINDOW_MS = 5000;
const CHAT_MAX_PER_WINDOW = 8;
const CHAT_HISTORY_LIMIT = 100;

const ALLOWED_FILE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

// ============================================================
// IN-MEMORY ROOM STATE
// roomId -> { meta, peers: Map<socketId, peer> }
// ============================================================

const rooms = new Map();

// An empty room's chat is erased after a short grace period (so a page
// refresh doesn't lose it) unless someone rejoins first.
const EMPTY_ROOM_CHAT_TTL_MS = 10 * 60 * 1000;
const cleanupTimers = new Map();
const cancelChatCleanup = (roomId) => {
  clearTimeout(cleanupTimers.get(roomId));
  cleanupTimers.delete(roomId);
};

const getRoom = (roomId) => rooms.get(roomId);

const ensureRoom = (roomId, meeting) => {
  let room = rooms.get(roomId);
  if (!room) {
    room = { meta: {}, peers: new Map() };
    rooms.set(roomId, room);
  }
  room.meta = {
    meetingId: meeting._id,
    title: meeting.title,
    type: meeting.type,
    startedAt: meeting.startedAt,
    maxParticipants: meeting.maxParticipants,
    isLocked: Boolean(meeting.isLocked),
    recording: meeting.recordingStatus === "recording",
    permissions: {
      participantScreenShare: meeting.permissions?.participantScreenShare !== false,
      participantChat: meeting.permissions?.participantChat !== false,
    },
  };
  return room;
};

const publicPeer = (peer) => ({
  socketId: peer.socketId,
  userId: peer.userId,
  displayName: peer.displayName,
  role: peer.role,
  audioMuted: peer.audioMuted,
  videoMuted: peer.videoMuted,
  screenSharing: peer.screenSharing,
  handRaised: peer.handRaised,
});

const isStaff = (peer) => peer?.role === "host" || peer?.role === "co-host";

const serializeMessage = (message) => ({
  id: message._id.toString(),
  senderId: message.sender ? message.sender.toString() : "",
  senderName: message.senderName,
  text: message.text || "",
  type: message.type,
  attachment: message.attachment?.dataUrl
    ? {
        name: message.attachment.name,
        mimeType: message.attachment.mimeType,
        size: message.attachment.size,
        dataUrl: message.attachment.dataUrl,
      }
    : undefined,
  createdAt: message.createdAt,
});

// ============================================================
// SOCKET AUTHENTICATION
// ============================================================

const authenticateSocket = async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace("Bearer ", "");

    if (!token) return next(new Error("Authentication required"));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // A session ended from the security page must not keep a live socket.
    if (!(await isSessionActive(decoded.sid))) return next(new Error("Session ended"));

    const user = await User.findById(decoded.userId || decoded.id).select("-password");

    if (!user) return next(new Error("User not found"));

    socket.user = user;
    next();
  } catch (error) {
    console.error("Socket authentication error:", error.message);
    next(new Error("Invalid token"));
  }
};

// ============================================================
// REGISTER SOCKETS
// ============================================================

const registerMeetingSockets = (io) => {
  // ----------------------------------------------------------
  // Shared helpers (also used by the REST controller)
  // ----------------------------------------------------------

  const removePeer = async (roomId, socketId, { markDisconnected = true } = {}) => {
    const room = getRoom(roomId);
    const peer = room?.peers.get(socketId);
    if (!room || !peer) return null;

    room.peers.delete(socketId);
    const target = io.sockets.sockets.get(socketId);
    if (target) {
      target.leave(roomId);
      target.data.roomId = null;
    }

    io.to(roomId).emit("user-left", { socketId, userId: peer.userId });

    const stillPresent = [...room.peers.values()].some((p) => p.userId === peer.userId);
    if (markDisconnected && !stillPresent) {
      await Meeting.updateOne(
        { roomId, "participants.user": peer.userId },
        {
          $set: {
            "participants.$.isConnected": false,
            "participants.$.leftAt": new Date(),
            "participants.$.handRaised": false,
          },
        }
      );
    }

    if (room.peers.size === 0) {
      rooms.delete(roomId);
      cancelChatCleanup(roomId);
      const timer = setTimeout(() => {
        cleanupTimers.delete(roomId);
        if (!getRoom(roomId)) {
          ChatMessage.deleteMany({ roomId }).catch((error) => console.error("Chat cleanup failed:", error.message));
        }
      }, EMPTY_ROOM_CHAT_TTL_MS);
      timer.unref?.();
      cleanupTimers.set(roomId, timer);
    }
    return peer;
  };

  const removeUserFromRoom = async (roomId, userId, reason) => {
    const room = getRoom(roomId);
    if (!room) return;
    const sockets = [...room.peers.values()].filter((p) => p.userId === String(userId));
    for (const peer of sockets) {
      io.to(peer.socketId).emit("removed", { reason });
      await removePeer(roomId, peer.socketId);
    }
  };

  const endRoom = (roomId) => {
    io.to(roomId).emit("meeting-ended");
    const room = getRoom(roomId);
    if (room) {
      for (const socketId of room.peers.keys()) {
        const target = io.sockets.sockets.get(socketId);
        if (target) {
          target.leave(roomId);
          target.data.roomId = null;
        }
      }
    }
    rooms.delete(roomId);
    // Privacy: chat messages and shared files are erased when the meeting ends.
    ChatMessage.deleteMany({ roomId }).catch((error) => console.error("Chat cleanup failed:", error.message));
  };

  const updateRoomMeta = (roomId, patch) => {
    const room = getRoom(roomId);
    if (!room) return;
    room.meta = { ...room.meta, ...patch };
  };

  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    const userId = socket.user._id.toString();
    const chatTimestamps = [];

    const current = () => {
      const roomId = socket.data.roomId;
      const room = roomId ? getRoom(roomId) : null;
      const peer = room?.peers.get(socket.id);
      return peer ? { roomId, room, peer } : null;
    };

    const fail = (message, code = "error") => socket.emit("error-message", { code, message });

    // ========================================================
    // JOIN ROOM
    // ========================================================

    socket.on("join-room", async ({ roomId: rawRoomId } = {}) => {
      try {
        const roomId = String(rawRoomId || "").trim().toUpperCase();
        if (!roomId) return socket.emit("join-error", { code: "invalid", message: "Room ID is required." });

        const meeting = await Meeting.findOne({ roomId });

        if (!meeting) {
          return socket.emit("join-error", { code: "not-found", message: "This meeting does not exist." });
        }
        if (meeting.status === "ended") {
          return socket.emit("join-error", { code: "ended", message: "This meeting has ended." });
        }
        if (meeting.isRemoved(userId)) {
          return socket.emit("join-error", { code: "removed", message: "You were removed from this meeting by the host." });
        }

        const role = meeting.roleOf(userId);
        const record = meeting.findParticipant(userId);

        // Only users admitted through POST /meetings/:roomId/join
        // (which checks passcode and lock) may connect, plus the host.
        if (!record && role !== "host") {
          return socket.emit("join-error", { code: "not-admitted", message: "Join the meeting from the meetings page first." });
        }

        cancelChatCleanup(roomId);
        const room = ensureRoom(roomId, meeting);

        // One live session per user per room: a refresh or a second
        // tab replaces the previous session instead of leaving a ghost.
        for (const peer of [...room.peers.values()]) {
          if (peer.userId === userId && peer.socketId !== socket.id) {
            io.to(peer.socketId).emit("session-replaced");
            await removePeer(roomId, peer.socketId, { markDisconnected: false });
          }
        }

        const liveRoom = ensureRoom(roomId, meeting);
        const othersCount = [...liveRoom.peers.values()].filter((p) => p.userId !== userId).length;

        if (othersCount >= meeting.maxParticipants && role === "participant") {
          return socket.emit("join-error", { code: "full", message: `This meeting is full (${meeting.maxParticipants} people).` });
        }

        // Leave any other room this socket was in.
        const previous = current();
        if (previous && previous.roomId !== roomId) await removePeer(previous.roomId, socket.id);

        const peer = {
          socketId: socket.id,
          userId,
          displayName: socket.user.name,
          role,
          audioMuted: false,
          videoMuted: false,
          screenSharing: false,
          handRaised: false,
        };

        const others = [...liveRoom.peers.values()].map(publicPeer);

        liveRoom.peers.set(socket.id, peer);
        socket.join(roomId);
        socket.data.roomId = roomId;

        if (record) {
          record.socketId = socket.id;
          record.isConnected = true;
          record.leftAt = undefined;
          record.role = role;
          record.displayName = socket.user.name;
        } else {
          meeting.participants.push({
            user: socket.user._id,
            displayName: socket.user.name,
            socketId: socket.id,
            role,
            isConnected: true,
          });
        }
        await meeting.save();

        const history = await ChatMessage.find({ roomId })
          .sort({ createdAt: -1 })
          .limit(CHAT_HISTORY_LIMIT);

        socket.emit("joined", {
          self: publicPeer(peer),
          participants: others,
          meeting: liveRoom.meta,
          chatHistory: history.reverse().map(serializeMessage),
        });

        socket.to(roomId).emit("user-joined", publicPeer(peer));
      } catch (error) {
        console.error("Join room error:", error);
        socket.emit("join-error", { code: "error", message: "Unable to join the meeting." });
      }
    });

    // ========================================================
    // WEBRTC SIGNALLING — only between sockets in the same room
    // ========================================================

    socket.on("signal", ({ to, data } = {}) => {
      const ctx = current();
      if (!ctx || typeof to !== "string" || !data || typeof data !== "object" || !ctx.room.peers.has(to)) return;
      if (!["offer", "answer", "ice-candidate"].includes(data.type)) return;
      if (JSON.stringify(data).length > 20000) return;
      io.to(to).emit("signal", { from: socket.id, data });
    });

    // ========================================================
    // MEDIA STATE
    // ========================================================

    socket.on("media-state", ({ audioMuted, videoMuted, screenSharing } = {}) => {
      const ctx = current();
      if (!ctx) return;
      const { peer, room, roomId } = ctx;

      let sharing = Boolean(screenSharing);
      if (sharing && !isStaff(peer) && !room.meta.permissions.participantScreenShare) {
        sharing = false;
        socket.emit("stop-screen-share", { reason: "The host has disabled screen sharing for participants." });
      }

      peer.audioMuted = Boolean(audioMuted);
      peer.videoMuted = Boolean(videoMuted);
      peer.screenSharing = sharing;

      socket.to(roomId).emit("media-state", {
        socketId: socket.id,
        audioMuted: peer.audioMuted,
        videoMuted: peer.videoMuted,
        screenSharing: peer.screenSharing,
      });
    });

    // ========================================================
    // RAISE HAND
    // ========================================================

    socket.on("raise-hand", ({ handRaised } = {}) => {
      const ctx = current();
      if (!ctx) return;
      ctx.peer.handRaised = Boolean(handRaised);
      io.to(ctx.roomId).emit("raise-hand", {
        socketId: socket.id,
        displayName: ctx.peer.displayName,
        handRaised: ctx.peer.handRaised,
      });
    });

    // ========================================================
    // CHAT (text, emoji and small files)
    // ========================================================

    socket.on("chat-message", async ({ text, attachment } = {}, ack) => {
      const reply = (result) => typeof ack === "function" && ack(result);

      try {
        const ctx = current();
        if (!ctx) return reply({ ok: false, message: "You are not in this meeting." });
        const { peer, room, roomId } = ctx;

        if (!isStaff(peer) && !room.meta.permissions.participantChat) {
          return reply({ ok: false, message: "The host has disabled chat for participants." });
        }

        const now = Date.now();
        while (chatTimestamps.length && now - chatTimestamps[0] > CHAT_WINDOW_MS) chatTimestamps.shift();
        if (chatTimestamps.length >= CHAT_MAX_PER_WINDOW) {
          return reply({ ok: false, message: "You're sending messages too quickly." });
        }

        const cleanText = String(text || "").trim().slice(0, MAX_TEXT_LENGTH);
        let cleanAttachment;

        if (attachment) {
          const mimeType = String(attachment.mimeType || "");
          const dataUrl = String(attachment.dataUrl || "");
          const name = String(attachment.name || "file").replace(/[\\/:*?"<>|]/g, "_").slice(0, 200);
          const prefix = `data:${mimeType};base64,`;

          if (!ALLOWED_FILE_TYPES.has(mimeType) || !dataUrl.startsWith(prefix)) {
            return reply({ ok: false, message: "That file type isn't allowed." });
          }

          const size = Math.floor(((dataUrl.length - prefix.length) * 3) / 4);
          if (size > MAX_FILE_BYTES) {
            return reply({ ok: false, message: "Files must be 2 MB or smaller." });
          }

          cleanAttachment = { name, mimeType, size, dataUrl };
        }

        if (!cleanText && !cleanAttachment) return reply({ ok: false, message: "Message is empty." });

        chatTimestamps.push(now);

        const message = await ChatMessage.create({
          meeting: room.meta.meetingId,
          roomId,
          sender: socket.user._id,
          senderName: socket.user.name,
          text: cleanText,
          type: cleanAttachment ? "file" : "text",
          attachment: cleanAttachment,
        });

        io.to(roomId).emit("chat-message", serializeMessage(message));
        reply({ ok: true });
      } catch (error) {
        console.error("Chat error:", error);
        reply({ ok: false, message: "Message could not be sent." });
      }
    });

    // ========================================================
    // HOST / CO-HOST ACTIONS
    // ========================================================

    socket.on("host-action", async ({ action, targetSocketId, value } = {}) => {
      try {
        const ctx = current();
        if (!ctx) return;
        const { peer, room, roomId } = ctx;

        if (!isStaff(peer)) return fail("Host permission required.", "forbidden");

        const target = targetSocketId ? room.peers.get(targetSocketId) : null;
        if (targetSocketId && !target) return fail("That participant is no longer in the meeting.");

        const hostOnly = ["end-meeting", "make-cohost", "remove-cohost"];
        if (hostOnly.includes(action) && peer.role !== "host") {
          return fail("Only the host can do that.", "forbidden");
        }

        // Co-hosts cannot act against the host.
        if (target && target.role === "host" && peer.role !== "host") {
          return fail("You can't moderate the host.", "forbidden");
        }

        switch (action) {
          case "mute": {
            if (!target) return;
            io.to(target.socketId).emit("force-mute", { by: peer.displayName });
            return;
          }

          case "mute-all": {
            for (const other of room.peers.values()) {
              if (other.socketId !== socket.id && other.role === "participant") {
                io.to(other.socketId).emit("force-mute", { by: peer.displayName });
              }
            }
            return;
          }

          case "lower-hand": {
            if (!target) return;
            target.handRaised = false;
            io.to(roomId).emit("raise-hand", {
              socketId: target.socketId,
              displayName: target.displayName,
              handRaised: false,
            });
            return;
          }

          case "remove": {
            if (!target || target.socketId === socket.id) return;
            await Meeting.updateOne(
              { roomId },
              { $addToSet: { removedUsers: target.userId }, $pull: { coHosts: target.userId } }
            );
            await removeUserFromRoom(roomId, target.userId, `Removed by ${peer.displayName}`);
            return;
          }

          case "lock":
          case "unlock": {
            const isLocked = action === "lock";
            await Meeting.updateOne({ roomId }, { $set: { isLocked } });
            updateRoomMeta(roomId, { isLocked });
            io.to(roomId).emit("meeting-updated", { isLocked });
            return;
          }

          case "set-permissions": {
            const permissions = {
              participantScreenShare:
                typeof value?.participantScreenShare === "boolean"
                  ? value.participantScreenShare
                  : room.meta.permissions.participantScreenShare,
              participantChat:
                typeof value?.participantChat === "boolean"
                  ? value.participantChat
                  : room.meta.permissions.participantChat,
            };
            await Meeting.updateOne({ roomId }, { $set: { permissions } });
            updateRoomMeta(roomId, { permissions });
            io.to(roomId).emit("meeting-updated", { permissions });

            if (!permissions.participantScreenShare) {
              for (const other of room.peers.values()) {
                if (other.screenSharing && !isStaff(other)) {
                  io.to(other.socketId).emit("stop-screen-share", {
                    reason: "The host has disabled screen sharing for participants.",
                  });
                }
              }
            }
            return;
          }

          case "make-cohost":
          case "remove-cohost": {
            if (!target || target.role === "host") return;
            const makeCoHost = action === "make-cohost";
            await Meeting.updateOne(
              { roomId },
              makeCoHost ? { $addToSet: { coHosts: target.userId } } : { $pull: { coHosts: target.userId } }
            );
            await Meeting.updateOne(
              { roomId, "participants.user": target.userId },
              { $set: { "participants.$.role": makeCoHost ? "co-host" : "participant" } }
            );
            for (const other of room.peers.values()) {
              if (other.userId === target.userId) other.role = makeCoHost ? "co-host" : "participant";
            }
            io.to(roomId).emit("role-updated", {
              userId: target.userId,
              role: makeCoHost ? "co-host" : "participant",
            });
            return;
          }

          case "end-meeting": {
            await Meeting.updateOne(
              { roomId },
              {
                $set: {
                  status: "ended",
                  endedAt: new Date(),
                  recordingStatus: room.meta.recording ? "stopped" : "idle",
                  "participants.$[].isConnected": false,
                },
              }
            );
            endRoom(roomId);
            return;
          }

          default:
            fail("Unknown action.");
        }
      } catch (error) {
        console.error("Host action error:", error);
        fail("Host action failed.");
      }
    });

    // ========================================================
    // RECORDING
    // The file is recorded and saved on the host's own device;
    // the server only tracks state so everyone sees the indicator.
    // ========================================================

    socket.on("recording", async ({ active } = {}) => {
      try {
        const ctx = current();
        if (!ctx) return;
        const { peer, room, roomId } = ctx;

        if (!isStaff(peer)) return fail("Only hosts can record.", "forbidden");

        const recording = Boolean(active);
        if (recording === room.meta.recording) return;

        await Meeting.updateOne(
          { roomId },
          { $set: { recordingStatus: recording ? "recording" : "stopped", recordingEnabled: true } }
        );

        if (recording) {
          await Recording.create({
            meeting: room.meta.meetingId,
            roomId,
            host: socket.user._id,
            status: "recording",
            storage: "local",
          });
        } else {
          await Recording.findOneAndUpdate(
            { meeting: room.meta.meetingId, status: "recording" },
            { status: "ready", endedAt: new Date() }
          );
        }

        updateRoomMeta(roomId, { recording });
        io.to(roomId).emit("recording-state", { active: recording, by: peer.displayName });
      } catch (error) {
        console.error("Recording state error:", error);
        fail("Unable to update recording state.");
      }
    });

    // ========================================================
    // LEAVE / DISCONNECT
    // ========================================================

    const leave = async () => {
      const ctx = current();
      if (!ctx) return;
      const { roomId, room, peer } = ctx;

      // If the last host/co-host leaves while recording, clear the indicator.
      await removePeer(roomId, socket.id);
      const remaining = getRoom(roomId);
      if (room.meta.recording && isStaff(peer) && remaining && ![...remaining.peers.values()].some(isStaff)) {
        updateRoomMeta(roomId, { recording: false });
        io.to(roomId).emit("recording-state", { active: false, by: peer.displayName });
        await Meeting.updateOne({ roomId }, { $set: { recordingStatus: "stopped" } });
      }
    };

    socket.on("leave-room", () => {
      leave().catch((error) => console.error("Leave room error:", error));
    });

    socket.on("disconnect", () => {
      leave().catch((error) => console.error("Disconnect error:", error));
    });
  });

  return { removeUserFromRoom, endRoom, updateRoomMeta };
};

module.exports = registerMeetingSockets;
