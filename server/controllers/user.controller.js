const User = require("../models/User");
const asyncHandler = require("../utils/asyncHandler");

exports.getProfile = asyncHandler(async (req, res) => {
  res.json({ success: true, user: req.user });
});

exports.updateProfile = asyncHandler(async (req, res) => {
  const { name, preferredLanguage, avatar } = req.body;
  const user = await User.findById(req.user._id);

  if (name) user.name = name;
  if (preferredLanguage) user.preferredLanguage = preferredLanguage;
  if (avatar !== undefined) user.avatar = avatar;

  await user.save();
  res.json({ success: true, user });
});
