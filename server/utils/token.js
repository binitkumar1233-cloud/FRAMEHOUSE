const jwt = require("jsonwebtoken");

const signToken = (payload, expiresIn = "7d") => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

module.exports = { signToken };
