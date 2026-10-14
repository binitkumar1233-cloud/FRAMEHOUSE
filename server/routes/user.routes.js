const express = require("express");
const userController = require("../controllers/user.controller");
const auth = require("../middleware/auth");

const router = express.Router();

router.get("/me", auth, userController.getProfile);
router.patch("/me", auth, userController.updateProfile);

module.exports = router;
