const User = require("../models/User");
const DeviceSession = require("../models/DeviceSession");
const Subscription = require("../models/Subscription");
const asyncHandler = require("../utils/asyncHandler");
const { signToken } = require("../utils/token");

const buildAuthResponse = (user) => {
  const token = signToken({ id: user._id, role: user.role });
  return {
    success: true,
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      plan: user.plan,
      preferredLanguage: user.preferredLanguage,
    },
  };
};

exports.register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({
      success: false,
      message: "Name, email and password are required",
    });
  }

  const existing = await User.findOne({ email });
  if (existing) {
    return res.status(409).json({
      success: false,
      message: "Email already registered",
    });
  }

  const user = await User.create({ name, email, password });
  await Subscription.create({ user: user._id, plan: "free", status: "active" });

  await DeviceSession.findOneAndUpdate(
    { user: user._id, deviceId: req.body.deviceId || "web" },
    {
      ip: req.device?.ip,
      userAgent: req.device?.userAgent,
      lastUsedAt: new Date(),
    },
    { upsert: true, new: true }
  );

  res.status(201).json(buildAuthResponse(user));
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required",
    });
  }

  const user = await User.findOne({ email }).select("+password");
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({
      success: false,
      message: "Invalid email or password",
    });
  }

  user.lastLoginAt = new Date();
  user.lastLoginIp = req.device?.ip;
  await user.save();

  await DeviceSession.findOneAndUpdate(
    { user: user._id, deviceId: req.body.deviceId || "web" },
    {
      ip: req.device?.ip,
      userAgent: req.device?.userAgent,
      lastUsedAt: new Date(),
    },
    { upsert: true, new: true }
  );

  res.json(buildAuthResponse(user));
});

exports.me = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    user: req.user,
    planLimits: req.user.getPlanLimits(),
  });
});
