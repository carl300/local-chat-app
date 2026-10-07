import { useEffect, useRef, useState } from "react";
import Markdown from "./Markdown.jsx";
import ResultActions from "./ResultActions.jsx";
import RecentFiles from "./RecentFiles.jsx";
import FileViewer from "./FileViewer.jsx";
import { KIND_LABELS, formatSize } from "./utils.js";

const STORAGE_KEY = "chat-messages";
const MAX_FILES = 5;
const ACCEPT = ".pdf,.xlsx,.xls,.ods,.csv,.docx,.txt,.md,.json,.png,.jpg,.jpeg,.gif,.webp";

// Read saved messages from localStorage (returns [] if nothing saved or storage is blocked).
function loadMessages() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function AttachmentChip({ file, onRemove, onView }) {
  return (
    <span className="chip" title={file.name}>
      <span className="chip-kind">{KIND_LABELS[file.kind] || "FILE"}</span>
      {onView ? (
        <button type="button" className="chip-name chip-open" onClick={() => onView(file)}>
          {file.name}
        </button>
      ) : (
        <span className="chip-name">{file.name}</span>
      )}
      <span className="chip-size">{formatSize(file.size)}</span>
      {onRemove && (
        <button type="button" className="chip-remove" onClick={onRemove} aria-label={`Remove ${file.name}`}>
          ×
        </button>
      )}
    </span>
  );
}

export default function App() {
  const [messages, setMessages] = useState(loadMessages);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState([]); // uploaded, waiting to be sent
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [showRecent, setShowRecent] = useState(false);
  const [viewing, setViewing] = useState(null); // file shown in the viewer pop-up
  const [filesVersion, setFilesVersion] = useState(0); // bumps after uploads so Recent files reloads
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  // Save the conversation whenever it changes.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // Storage unavailable (e.g. private mode) - the chat still works, it just won't persist.
    }
  }, [messages]);

  // Keep the newest message in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Upload files to the server right away; they're attached to the next message you send.
  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (attachments.length + files.length > MAX_FILES) {
      setError(`You can attach up to ${MAX_FILES} files per message.`);
      return;
    }

    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    setError("");
    setUploading(true);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      setAttachments((prev) => [...prev, ...data.files]);
      setFilesVersion((v) => v + 1);
    } catch (err) {
      setError(err.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  // Attach a file from the Recent files panel.
  function attachExisting(file) {
    setShowRecent(false);
    if (attachments.some((a) => a.id === file.id)) return;
    if (attachments.length >= MAX_FILES) {
      setError(`You can attach up to ${MAX_FILES} files per message.`);
      return;
    }
    setAttachments((prev) => [...prev, file]);
  }

  async function sendMessage() {
    const text = input.trim();
    if ((!text && !attachments.length) || loading || uploading) return;

    const userMessage = { role: "user", content: text };
    if (attachments.length) {
      userMessage.attachments = attachments.map(({ id, name, kind, size }) => ({ id, name, kind, size }));
    }
    const next = [...messages, userMessage];
    setMessages(next);
    setInput("");
    setAttachments([]);
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setMessages([...next, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    // Enter sends; Shift+Enter makes a new line.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function newChat() {
    setMessages([]);
    setAttachments([]);
    setError("");
    setInput("");
  }

  // Drag-and-drop files anywhere on the page.
  function handleDragOver(e) {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      setDragging(true);
    }
  }
  function handleDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
  }
  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  const canSend = (input.trim() || attachments.length) && !loading && !uploading;

  return (
    <div
      className={`app${dragging ? " dragging" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="header">
        <h1>Chat</h1>
        <div className="header-actions">
          <button onClick={() => setShowRecent(true)}>Recent files</button>
          <button className="new-chat" onClick={newChat} disabled={loading}>
            New chat
          </button>
          <form className="signout" method="post" action="/auth/logout">
            <button type="submit">Sign out</button>
          </form>
        </div>
      </header>

      <main className="messages">
        {messages.length === 0 && !loading && (
          <div className="empty">
            <p>Attach a file and tell me what to do with it.</p>
            <p className="muted small">
              e.g. “Total the Sales column”, “Summarize this PDF”, “List every date in this document as a table”
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`row ${m.role}`}>
            <div className="bubble">
              {m.attachments?.length > 0 && (
                <div className="bubble-files">
                  {m.attachments.map((f) => (
                    <AttachmentChip key={f.id} file={f} onView={setViewing} />
                  ))}
                </div>
              )}
              {m.role === "assistant" ? (
                <>
                  <div className="markdown">
                    <Markdown>{m.content}</Markdown>
                  </div>
                  <ResultActions content={m.content} />
                </>
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="row assistant">
            <div className="bubble thinking">Thinking…</div>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div ref={bottomRef} />
      </main>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage();
        }}
      >
        {(attachments.length > 0 || uploading) && (
          <div className="pending-files">
            {attachments.map((f) => (
              <AttachmentChip
                key={f.id}
                file={f}
                onView={setViewing}
                onRemove={() => setAttachments((prev) => prev.filter((a) => a.id !== f.id))}
              />
            ))}
            {uploading && <span className="uploading">Uploading…</span>}
          </div>
        )}
        <div className="composer-row">
          <button
            type="button"
            className="attach"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || loading}
            aria-label="Attach files"
            title="Attach files (PDF, Excel, Word, CSV, text, images)"
          >
            📎
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = ""; // allow picking the same file again
            }}
          />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type an instruction…"
            rows={1}
            aria-label="Message"
          />
          <button type="submit" disabled={!canSend}>
            Send
          </button>
        </div>
      </form>

      {dragging && <div className="drop-overlay">Drop files to attach</div>}

      {showRecent && (
        <RecentFiles
          refreshKey={filesVersion}
          onClose={() => setShowRecent(false)}
          onView={setViewing}
          onAttach={attachExisting}
        />
      )}
      {viewing && <FileViewer file={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
