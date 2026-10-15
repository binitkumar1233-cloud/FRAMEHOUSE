const crypto = require("crypto");

const generateRoomId = () => {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
};

module.exports = generateRoomId;
