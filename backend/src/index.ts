import { env } from "./config/env";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import http from "http";
import { Server } from "socket.io";
import { connectDB } from "./config/db";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import leadRoutes from "./routes/leads";
import studentRoutes from "./routes/students";
import documentRoutes from "./routes/documents";
import applicationRoutes from "./routes/applications";
import visaRoutes from "./routes/visas";
import paymentRoutes from "./routes/payments";
import messageRoutes from "./routes/messages";
import notificationRoutes from "./routes/notifications";
import dashboardRoutes from "./routes/dashboard";
import devRoutes, { isDevToolsEnabled } from "./routes/dev";
import { setupSocket } from "./socket";
import { uploadErrorHandler } from "./middleware/upload";
import { isCloudinaryConfigured } from "./config/cloudinary";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: env.allowedOrigins, credentials: true },
});

// Middleware
app.use(cors({ origin: env.allowedOrigins, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// New uploads go to Cloudinary. This only keeps files that were written to
// disk before that migration reachable, and is skipped when there are none.
const legacyUploadsDir = path.join(process.cwd(), "uploads");
if (fs.existsSync(legacyUploadsDir)) {
  app.use("/uploads", express.static(legacyUploadsDir));
}

// Connect DB
connectDB();

// Socket.io
setupSocket(io);

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/visas", visaRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/dashboard", dashboardRoutes);

// Unauthenticated developer console — never mounted in production, and the
// router itself additionally rejects anything that is not loopback.
if (isDevToolsEnabled()) {
  app.use("/api/dev", devRoutes);
}

app.get("/api/health", (_req, res) =>
  res.json({
    status: "ok",
    storage: isCloudinaryConfigured() ? "cloudinary" : "unconfigured",
    timestamp: new Date().toISOString(),
  }),
);

// Unknown paths answer as JSON too — the frontends only ever parse JSON.
app.use((_req, res) => res.status(404).json({ message: "Not found" }));

// Must come after the routes so multer's errors land here as JSON
app.use(uploadErrorHandler);

server.listen(env.port, () => {
  console.log(`StudyCRM backend running on port ${env.port}`);
  console.log(`Allowed browser origins: ${env.allowedOrigins.join(", ") || "(none)"}`);
  if (!isCloudinaryConfigured()) {
    console.warn("⚠  Cloudinary is not configured — file uploads will return 503. Set CLOUDINARY_* in .env");
  }
  if (isDevToolsEnabled()) {
    console.warn("⚠  Unauthenticated dev routes are ENABLED at /api/dev (localhost only). Never do this in production.");
  }
});

export { io };
