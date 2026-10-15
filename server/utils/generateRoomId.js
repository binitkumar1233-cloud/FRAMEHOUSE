const crypto = require("crypto");

// 12 hex characters (48 bits): too many to guess or enumerate.
const generateRoomId = () => {
  return crypto.randomBytes(6).toString("hex").toUpperCase();
};

module.exports = generateRoomId;
