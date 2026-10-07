import "dotenv/config"; // loads server/.env into process.env (if the file exists)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import cookieParser from "cookie-parser";
import {
  saveUpload,
  getUpload,
  listUploads,
  deleteUpload,
  originalPath,
  previewHtml,
  MAX_FILE_SIZE,
  MAX_FILES,
} from "./files.js";
import { aiEnabled, modelName, generateReply, friendlyError } from "./ai.js";
import { authEnabled, requireAuth, registerAuthRoutes } from "./auth.js";

const app = express();
const PORT = Number(process.env.PORT) || 3001;
// The built React app (web/dist). In local dev, Vite serves it instead.
const WEB_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Load balancer health check (no sign-in needed).
app.get("/healthz", (req, res) => res.send("ok"));

registerAuthRoutes(app);
app.use(requireAuth); // everything below needs a signed-in user

// Keep uploads in memory just long enough to check and save them.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
});

// POST /api/upload  (form field "files")  ->  { files: [{ id, name, kind, size, summary, uploadedAt }] }
app.post("/api/upload", (req, res) => {
  upload.array("files", MAX_FILES)(req, res, async (err) => {
    if (err) {
      const message =
        err.code === "LIMIT_FILE_SIZE" ? "File is too large (max 10 MB)."
        : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE" ? `Too many files (max ${MAX_FILES}).`
        : err.message;
      return res.status(400).json({ error: message });
    }
    if (!req.files?.length) {
      return res.status(400).json({ error: "No files received." });
    }
    try {
      const files = [];
      for (const file of req.files) files.push(await saveUpload(file));
      res.json({ files });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
});

// GET /api/files  ->  { files: [...] }  (recent uploads, newest first)
app.get("/api/files", async (req, res) => {
  res.json({ files: await listUploads() });
});

// GET /api/files/:id  ->  the original file (add ?download=1 to save it instead of viewing)
app.get("/api/files/:id", async (req, res) => {
  const meta = await getUpload(req.params.id);
  if (!meta) return res.status(404).json({ error: "File not found." });
  res.type(meta.mediaType);
  res.set("X-Content-Type-Options", "nosniff"); // browser must trust our type, not guess from contents
  if (req.query.download) res.attachment(meta.name);
  else res.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(meta.name)}`);
  res.sendFile(originalPath(meta));
});

// GET /api/files/:id/preview  ->  { html }  for spreadsheets, Word and text files
app.get("/api/files/:id/preview", async (req, res) => {
  const meta = await getUpload(req.params.id);
  if (!meta) return res.status(404).json({ error: "File not found." });
  try {
    res.json({ html: await previewHtml(meta) });
  } catch {
    res.status(500).json({ error: "Couldn't preview this file." });
  }
});

// DELETE /api/files/:id
app.delete("/api/files/:id", async (req, res) => {
  const meta = await getUpload(req.params.id);
  if (!meta) return res.status(404).json({ error: "File not found." });
  await deleteUpload(meta);
  res.json({ ok: true });
});

// POST /api/chat  { messages: [{ role, content, attachments? }, ...] }  ->  { reply }
app.post("/api/chat", async (req, res) => {
  const messages = req.body?.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Expected { messages: [{ role, content, attachments? }, ...] }" });
  }

  // No key yet: fall back to echoing the message back.
  if (!aiEnabled) {
    const last = messages[messages.length - 1];
    return res.json({ reply: `Echo: ${last.content || "(no text)"}\n\n(AI_DISABLED=1 is set, so replies are echoes.)` });
  }

  try {
    res.json({ reply: await generateReply(messages) });
  } catch (err) {
    console.error("Bedrock error:", err?.status || "", err?.message);
    res.status(502).json({ error: friendlyError(err) });
  }
});

// Serve the React app, sending unknown non-API paths to index.html.
if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(WEB_DIST, "index.html")));
}

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(aiEnabled ? `Using Bedrock (model: ${modelName}).` : "AI_DISABLED=1 - replies will be echoes.");
  console.log(authEnabled ? "Sign-in required (Cognito)." : "Sign-in is OFF (no COGNITO_* settings) - local development only.");
});
