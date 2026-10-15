const User = require("../models/User");
const asyncHandler = require("../utils/asyncHandler");

exports.getProfile = asyncHandler(async (req, res) => {
  res.json({ success: true, user: req.user });
});

exports.updateProfile = asyncHandler(async (req, res) => {
  const { name, preferredLanguage, avatar } = req.body;
  const user = await User.findById(req.user._id);

  if ((name !== undefined && (typeof name !== "string" || name.length > 80)) ||
      (preferredLanguage !== undefined && (typeof preferredLanguage !== "string" || preferredLanguage.length > 20)) ||
      (avatar !== undefined && (typeof avatar !== "string" || avatar.length > 90000 || (avatar && !/^(https:\/\/|data:image\/(png|jpeg|webp|gif);base64,)/.test(avatar))))) {
    return res.status(400).json({ success: false, message: "Invalid profile details." });
  }

  if (name) user.name = name;
  if (preferredLanguage) user.preferredLanguage = preferredLanguage;
  if (avatar !== undefined) user.avatar = avatar;

  await user.save();
  res.json({ success: true, user });
});
