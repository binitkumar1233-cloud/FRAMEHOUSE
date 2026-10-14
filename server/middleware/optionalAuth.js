const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { isSessionActive } = require("../services/loginSecurity");

const optionalAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return next();
    }

    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!(await isSessionActive(decoded.sid))) return next();

    const user = await User.findById(decoded.userId || decoded.id).select(
      "-password"
    );

    if (user) {
      req.user = user;
    }

    next();
  } catch (error) {
    next();
  }
};

module.exports = optionalAuth;
