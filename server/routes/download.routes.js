const express = require("express");
const downloadController = require("../controllers/download.controller");
const auth = require("../middleware/auth");

const router = express.Router();

// Signed link (browser downloads can't send an Authorization header).
router.get("/file/:id", downloadController.streamDownload);

router.use(auth);

router.get("/", downloadController.listDownloads);
router.get("/quota", downloadController.getQuota);
router.get("/devices", downloadController.listDevices);
router.delete("/devices/:deviceId", downloadController.deleteDevice);
router.get("/admin/records", downloadController.auditRecords);
router.post("/:videoId", downloadController.requestDownload);

module.exports = router;
