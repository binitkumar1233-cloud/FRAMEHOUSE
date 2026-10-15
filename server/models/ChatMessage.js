const mongoose = require("mongoose");
const { encrypt, decrypt } = require("../utils/chatCrypto");

const attachmentSchema = new mongoose.Schema(
  {
    name: { type: String, maxlength: 200 },
    mimeType: String,
    size: Number,
    // Base64 data URL. Size is capped by the socket handler.
    dataUrl: { type: String, set: encrypt, get: decrypt },
  },
  { _id: false }
);

const chatMessageSchema = new mongoose.Schema(
  {
    meeting: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Meeting",
      required: true,
      index: true,
    },
    roomId: {
      type: String,
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    senderName: {
      type: String,
      required: true,
    },
    text: {
      type: String,
      default: "", // length is capped by the socket handler (ciphertext is longer)
      set: encrypt,
      get: decrypt,
    },
    type: {
      type: String,
      enum: ["text", "file", "system"],
      default: "text",
    },
    attachment: attachmentSchema,
  },
  { timestamps: true, toJSON: { getters: true }, toObject: { getters: true } }
);

// Safety net: chat is deleted when a meeting ends, and never kept past 24 hours.
chatMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

module.exports = mongoose.model("ChatMessage", chatMessageSchema);
