import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import mammoth from "mammoth";

// Uploaded files are saved in server/uploads/ as:
//   <id>       the original file
//   <id>.json  info about it (name, kind, size, summary, upload time)
//   <id>.txt   extracted text (spreadsheets, Word, text files only)
export const UPLOAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "uploads");

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_FILES = 5;

// File extension -> what kind of file it is, and its media type.
const TYPES = {
  ".pdf": { kind: "pdf", mediaType: "application/pdf" },
  ".png": { kind: "image", mediaType: "image/png" },
  ".jpg": { kind: "image", mediaType: "image/jpeg" },
  ".jpeg": { kind: "image", mediaType: "image/jpeg" },
  ".gif": { kind: "image", mediaType: "image/gif" },
  ".webp": { kind: "image", mediaType: "image/webp" },
  ".xlsx": { kind: "spreadsheet", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  ".xls": { kind: "spreadsheet", mediaType: "application/vnd.ms-excel" },
  ".ods": { kind: "spreadsheet", mediaType: "application/vnd.oasis.opendocument.spreadsheet" },
  ".csv": { kind: "spreadsheet", mediaType: "text/csv" },
  ".docx": { kind: "word", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  ".txt": { kind: "text", mediaType: "text/plain" },
  ".md": { kind: "text", mediaType: "text/plain" },
  ".json": { kind: "text", mediaType: "application/json" },
};

// Ids are random UUIDs; checking the format stops anyone using an id to read other paths.
const ID_PATTERN = /^[0-9a-f-]{36}$/;

const filePath = (id, ext = "") => path.join(UPLOAD_DIR, id + ext);

// Pull readable text out of a file. Returns { text, summary }.
async function extract(kind, buffer) {
  if (kind === "spreadsheet") {
    const workbook = XLSX.read(buffer);
    const parts = workbook.SheetNames.map(
      (name) => `## Sheet: ${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`
    );
    const n = workbook.SheetNames.length;
    return {
      text: parts.join("\n\n"),
      summary: `${n} sheet${n === 1 ? "" : "s"} (${workbook.SheetNames.join(", ")})`,
    };
  }
  if (kind === "word") {
    const { value } = await mammoth.extractRawText({ buffer });
    return { text: value, summary: `${value.length.toLocaleString()} characters of text` };
  }
  if (kind === "text") {
    const text = buffer.toString("utf8").replace(/^﻿/, ""); // drop the invisible marker some editors add
    return { text, summary: `${text.length.toLocaleString()} characters of text` };
  }
  if (kind === "pdf" && buffer.subarray(0, 4).toString() !== "%PDF") {
    throw new Error("not a valid PDF");
  }
  // PDFs and images are kept as-is: Claude reads them directly.
  return { text: null, summary: kind === "pdf" ? "PDF document" : "image" };
}

// Save one uploaded file (from multer) and return its info.
export async function saveUpload(file) {
  // Browsers send non-English file names as UTF-8, but multer decodes them as latin1.
  const name = Buffer.from(file.originalname, "latin1").toString("utf8");
  const type = TYPES[path.extname(name).toLowerCase()];
  if (!type) {
    throw new Error(`"${name}" isn't a supported file type.`);
  }

  let extracted;
  try {
    extracted = await extract(type.kind, file.buffer);
  } catch {
    throw new Error(`Couldn't read "${name}". The file may be damaged.`);
  }

  const id = crypto.randomUUID();
  const meta = {
    id,
    name,
    kind: type.kind,
    mediaType: type.mediaType,
    size: file.size,
    summary: extracted.summary,
    uploadedAt: new Date().toISOString(),
  };

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(filePath(id), file.buffer);
  if (extracted.text !== null) {
    await fs.writeFile(filePath(id, ".txt"), extracted.text);
  }
  await fs.writeFile(filePath(id, ".json"), JSON.stringify(meta, null, 2));
  return meta;
}

// Look up a saved file's info by id. Returns null if it doesn't exist.
export async function getUpload(id) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) return null;
  try {
    return JSON.parse(await fs.readFile(filePath(id, ".json"), "utf8"));
  } catch {
    return null;
  }
}

// All saved files, newest first.
export async function listUploads() {
  let names;
  try {
    names = await fs.readdir(UPLOAD_DIR);
  } catch {
    return []; // no uploads folder yet
  }
  const metas = await Promise.all(
    names.filter((n) => n.endsWith(".json")).map((n) => getUpload(n.slice(0, -5)))
  );
  return metas.filter(Boolean).sort((a, b) => (b.uploadedAt || "").localeCompare(a.uploadedAt || ""));
}

export function originalPath(meta) {
  return filePath(meta.id);
}

export async function deleteUpload(meta) {
  await Promise.all([".json", ".txt", ""].map((ext) => fs.rm(filePath(meta.id, ext), { force: true })));
}

// HTML preview for spreadsheets and Word files (shown in a sandboxed frame in the browser).
export async function previewHtml(meta) {
  const buffer = await fs.readFile(filePath(meta.id));
  if (meta.kind === "spreadsheet") {
    const workbook = XLSX.read(buffer);
    return workbook.SheetNames.map(
      (name) => `<h2>${escapeHtml(name)}</h2>` + XLSX.utils.sheet_to_html(workbook.Sheets[name], { header: "", footer: "" })
    ).join("");
  }
  if (meta.kind === "word") {
    return (await mammoth.convertToHtml({ buffer })).value;
  }
  if (meta.kind === "text") {
    return `<pre>${escapeHtml(await fs.readFile(filePath(meta.id, ".txt"), "utf8"))}</pre>`;
  }
  return null; // PDFs and images are shown directly by the browser
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Turn a saved file into a Claude content block: PDFs and images are sent as-is,
// everything else is sent as the text we extracted.
export async function toClaudeContent(meta) {
  if (meta.kind === "pdf" || meta.kind === "image") {
    const data = (await fs.readFile(filePath(meta.id))).toString("base64");
    const source = { type: "base64", media_type: meta.mediaType, data };
    return meta.kind === "pdf" ? { type: "document", source, title: meta.name } : { type: "image", source };
  }
  const text = await fs.readFile(filePath(meta.id, ".txt"), "utf8");
  return { type: "text", text: `<file name="${meta.name}">\n${text}\n</file>` };
}
