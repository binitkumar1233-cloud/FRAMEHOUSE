const crypto = require("crypto");
const User = require("../models/User");

const slug = (name) => {
  const base = String(name || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 14);
  return base.length >= 3 ? base : `${base || "user"}_${crypto.randomInt(100, 999)}`.slice(0, 14);
};

/** Gives the user a unique @handle the first time one is needed. Safe to call repeatedly. */
const ensureUsername = async (user) => {
  if (user.username) return user.username;

  const base = slug(user.name);
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = attempt === 0 ? base : `${base}${crypto.randomInt(10, 9999)}`.slice(0, 20);
    try {
      const updated = await User.findOneAndUpdate(
        { _id: user._id, username: { $exists: false } },
        { username: candidate },
        { returnDocument: "after" }
      );
      if (updated) {
        user.username = updated.username;
        return user.username;
      }
      // Another request assigned one first.
      const current = await User.findById(user._id).select("username");
      user.username = current?.username;
      return user.username;
    } catch (error) {
      if (error.code !== 11000) throw error; // taken: try the next suffix
    }
  }
  throw new Error("Could not create a username");
};

module.exports = { ensureUsername };
