const jwt = require("jsonwebtoken");
const { isSessionActive } = require("../services/loginSecurity");

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    if (!(await isSessionActive(decoded.sid))) {
      return res.status(401).json({
        success: false,
        message: "This session was signed out. Please sign in again.",
      });
    }

    req.user = decoded;
    req.sessionId = decoded.sid;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

module.exports = protect;
