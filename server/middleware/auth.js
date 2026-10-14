const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { isSessionActive } = require("../services/loginSecurity");

const auth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!(await isSessionActive(decoded.sid))) {
      return res.status(401).json({
        success: false,
        message: "This session was signed out. Please sign in again.",
      });
    }

    const user = await User.findById(decoded.userId || decoded.id).select(
      "-password"
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found or inactive",
      });
    }

    req.user = user;
    req.sessionId = decoded.sid;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = auth;
