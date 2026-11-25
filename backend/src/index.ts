import { env } from "./config/env";
import crypto from "crypto";
import { webhook, startEmailWorker, seedTemplates } from "./services/email";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import fs from "fs";
import http from "http";
import { Server } from "socket.io";
import { connectDB } from "./config/db";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import leadRoutes from "./routes/leads";
import studentRoutes from "./routes/students";
import messageRoutes from "./routes/messages";
import accessRoutes from "./routes/access";
import metaRoutes from "./routes/meta";
import coreRoutes from "./routes/core";
import workRoutes from "./routes/work";
import adminRoutes from "./routes/admin";
import counsellorRoutes from "./routes/counsellors";
import portalStaffRoutes from "./routes/portalStaff";
import appointmentRoutes from "./routes/appointments";
import rewardRoutes from "./routes/rewards";
import invoiceRoutes from "./routes/invoices";
import privacyRoutes from "./routes/privacy";
import catalogueRoutes, { logoRoute } from "./routes/catalogue";
import consoleRoutes from "./routes/console";
import consoleMoneyRoutes from "./routes/consoleMoney";
import consoleCommsRoutes from "./routes/consoleComms";
import consoleInsightsRoutes from "./routes/consoleInsights";
import consolePeopleRoutes from "./routes/consolePeople";
import { startDpdpJobs } from "./services/dpdp";
import { startJobs } from "./services/jobs";
import portalRoutes from "./routes/portal";
import legalRoutes from "./routes/legal";
import portalAccountRoutes from "./routes/portalAccount";
import devRoutes, { isDevToolsEnabled } from "./routes/dev";
import { setupSocket } from "./socket";
import { uploadErrorHandler } from "./middleware/upload";
import { apiLimiter } from "./middleware/rateLimit";
import { isCloudinaryConfigured } from "./config/cloudinary";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: env.allowedOrigins, credentials: true },
});

// Middleware
app.disable("x-powered-by");
app.set("etag", false);
// Behind Render's proxy, so req.ip must come from X-Forwarded-For or every
// caller shares the load balancer's address and the rate limits are useless.
app.set("trust proxy", 1);
app.use(helmet({
  // The API serves JSON and Cloudinary-hosted files; it renders no HTML of its
  // own, so CSP has nothing to protect here and CORP would block the frontends.
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors({ origin: env.allowedOrigins, credentials: true }));
// 10 MB was the body cap for JSON too, which let one request allocate 10 MB of
// parsed objects. Uploads are multipart and carry their own limit.
app.use(express.json({ limit: "256kb" }));
app.use("/api", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
app.use(express.urlencoded({ extended: true, limit: "256kb" }));
app.use("/api", apiLimiter);

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
// provider delivery webhooks: shared token, compared in constant time
app.post("/api/webhooks/email", async (req, res) => {
  const want = process.env.EMAIL_WEBHOOK_TOKEN, got = String(req.headers["x-webhook-token"] || req.query.token || "");
  const h = (v: string) => crypto.createHash("sha256").update(v).digest();
  if (!want || !got || !crypto.timingSafeEqual(h(got), h(want))) { res.status(403).end(); return; }
  const events = Array.isArray(req.body) ? req.body : [req.body];
  let n = 0;
  for (const e of events) if (await webhook(String(e?.message_id || e?.["smtp-id"] || ""), String(e?.status || ""))) n++;
  res.json({ updated: n });
});
// university logos are public (not personal data)
app.get("/api/logos/:id", (req, res) => { logoRoute(req, res).catch(() => res.status(500).end()); });
app.use("/api/legal", legalRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/access", accessRoutes);
app.use("/api/portal", portalRoutes);
app.use("/api/portal", portalAccountRoutes);

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

// The client's CRM contract (legacy/server): mounted on /api with a login check, so they come after
// /api/health and /api/dev (both public), or they would answer those with 401.
app.use("/api", metaRoutes);
app.use("/api", coreRoutes);
app.use("/api", workRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", counsellorRoutes);
app.use("/api", portalStaffRoutes);
app.use("/api", appointmentRoutes);
app.use("/api", rewardRoutes);
app.use("/api", invoiceRoutes);
app.use("/api/admin", privacyRoutes);
app.use("/api", catalogueRoutes);
app.use("/api", consoleRoutes);
app.use("/api", consoleMoneyRoutes);
app.use("/api", consoleCommsRoutes);
app.use("/api", consoleInsightsRoutes);
app.use("/api", consolePeopleRoutes);

// Unknown paths answer as JSON too — the frontends only ever parse JSON.
app.use((_req, res) => res.status(404).json({ message: "Not found" }));

// Must come after the routes so multer's errors land here as JSON
app.use(uploadErrorHandler);

server.listen(env.port, () => {
  startEmailWorker();
  startDpdpJobs();
  startJobs();
  seedTemplates().catch((e) => console.error("[email templates]", e));
  console.log(`StudyCRM backend running on port ${env.port} (mode: ${env.mode})`);
  console.log(`Allowed browser origins: ${env.allowedOrigins.join(", ") || "(none)"}`);
  if (!isCloudinaryConfigured()) {
    console.warn("⚠  Cloudinary is not configured — file uploads will return 503. Set CLOUDINARY_* in .env");
  }
  if (isDevToolsEnabled()) {
    console.warn("⚠  Unauthenticated dev routes are ENABLED at /api/dev (localhost only). Never do this in production.");
  }
});

export { io };
