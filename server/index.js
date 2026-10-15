const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const http = require("http");
const { Server } = require("socket.io");

const deviceInfo = require("./middleware/deviceInfo");
const errorHandler = require("./middleware/errorHandler");
const notFound = require("./middleware/notFound");
const downloadRoutes = require("./routes/download.routes");
const meetingRoutes = require("./routes/meeting.routes");
const userRoutes = require("./routes/user.routes");
const videoRoutes = require("./routes/videoRoutes");
const watchProgressRoutes = require("./routes/watchProgressRoutes");
const registerMeetingSockets = require("./sockets/meeting.socket");
const { startSubscriptionJobs } = require("./services/subscriptionService");

const app = express();
const server = http.createServer(app);

app.use(cors());
// Keep the raw body too: Razorpay webhook signatures are computed over it.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));
app.use(deviceInfo);

const authRoutes = require("./routes/authRoutes");

app.use("/api/comments", require("./routes/commentRoutes"));
app.use("/api/security", require("./routes/securityRoutes"));
app.use("/api/auth", authRoutes);

const subscriptionRoutes = require("./routes/subscriptionRoutes");

app.use("/api/subscription", subscriptionRoutes);


// Comma-separated list of allowed front-end origins, e.g.
// CLIENT_URL=http://localhost:5173,https://framehouse.example
const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(",").map((origin) => origin.trim())
  : "*";

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
  // Room for a 2 MB chat attachment once base64-encoded.
  maxHttpBufferSize: 3.5 * 1024 * 1024,
});

app.set("io", io);

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected successfully");
    // Expire ended plans, send renewal reminders, close abandoned orders.
    startSubscriptionJobs();
  })
  .catch((error) => {
    console.log("MongoDB connection error:", error.message);
  });

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Video Platform API is running",
  });
});

app.use("/api/downloads", downloadRoutes);
app.use("/api/meetings", meetingRoutes);
app.use("/api/users", userRoutes);
app.use("/api/videos", videoRoutes);
app.use("/api/watch-progress", watchProgressRoutes);

app.set("meetingHub", registerMeetingSockets(io));

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
