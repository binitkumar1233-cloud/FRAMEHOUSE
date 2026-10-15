const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
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

if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);

// Comma-separated list of allowed front-end origins, e.g.
// CLIENT_URL=http://localhost:5173,https://framehouse.example
const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(",").map((origin) => origin.trim().replace(/\/+$/, ""))
  : process.env.NODE_ENV === "production"
  ? false
  : "*";
if (allowedOrigins === false) console.warn("CLIENT_URL is not set: cross-origin browser requests are blocked.");

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: allowedOrigins === false ? false : allowedOrigins }));

const limiter = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
  });

app.use("/api", limiter(60 * 1000, 300, "Too many requests. Please slow down."));
app.use("/api/auth", limiter(15 * 60 * 1000, 40, "Too many attempts. Please wait a few minutes."));
// Stops passcode guessing and room-ID enumeration.
app.use("/api/meetings/:roomId/join", limiter(10 * 60 * 1000, 15, "Too many join attempts. Please wait a few minutes."));
// Keep the raw body too: Razorpay webhook signatures are computed over it.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));
app.use(deviceInfo);

// Cached so serverless invocations reuse one connection and wait for it.
let connecting = null;
const connectDb = () => {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  if (!connecting) {
    connecting = mongoose
      .connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 })
      .then(() => {
        console.log("MongoDB connected successfully");
        // Expire ended plans, send renewal reminders, close abandoned orders.
        if (!process.env.VERCEL) startSubscriptionJobs();
      })
      .catch((error) => {
        connecting = null;
        console.log("MongoDB connection error:", error.message);
        throw error;
      });
  }
  return connecting;
};

connectDb().catch(() => {});

app.use("/api", async (_req, res, next) => {
  try {
    await connectDb();
    next();
  } catch (error) {
    res.status(503).json({ success: false, message: "Database unavailable", detail: error.message });
  }
});

const authRoutes = require("./routes/authRoutes");

app.use("/api/comments", require("./routes/commentRoutes"));
app.use("/api/security", require("./routes/securityRoutes"));
app.use("/api/auth", authRoutes);

const subscriptionRoutes = require("./routes/subscriptionRoutes");

app.use("/api/subscription", subscriptionRoutes);


const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
  // Room for a 2 MB chat attachment once base64-encoded.
  maxHttpBufferSize: 3.5 * 1024 * 1024,
});

app.set("io", io);

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
