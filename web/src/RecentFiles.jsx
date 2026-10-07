import { useEffect, useState } from "react";
import { KIND_LABELS, formatDate, formatSize } from "./utils.js";

// Side panel listing everything uploaded so far, newest first.
export default function RecentFiles({ onClose, onView, onAttach, refreshKey }) {
  const [files, setFiles] = useState(null); // null = loading
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const res = await fetch("/api/files");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFiles(data.files);
    } catch {
      setError("Couldn't load recent files.");
      setFiles([]);
    }
  }

  useEffect(() => {
    load();
  }, [refreshKey]);

  async function remove(file) {
    if (!window.confirm(`Delete "${file.name}"? This can't be undone.`)) return;
    const res = await fetch(`/api/files/${file.id}`, { method: "DELETE" });
    if (res.ok) setFiles((prev) => prev.filter((f) => f.id !== file.id));
    else setError("Couldn't delete the file.");
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Recent files">
        <div className="drawer-header">
          <h2>Recent files</h2>
          <button type="button" onClick={onClose} aria-label="Close recent files">×</button>
        </div>

        {error && <p className="error">{error}</p>}
        {files === null && <p className="muted">Loading…</p>}
        {files?.length === 0 && !error && <p className="muted">No files uploaded yet.</p>}

        <ul className="file-list">
          {files?.map((f) => (
            <li key={f.id} className="file-item">
              <div className="file-info">
                <span className="chip-kind">{KIND_LABELS[f.kind] || "FILE"}</span>
                <div className="file-text">
                  <span className="file-name" title={f.name}>{f.name}</span>
                  <span className="muted small">
                    {formatSize(f.size)} · {formatDate(f.uploadedAt)}
                  </span>
                </div>
              </div>
              <div className="file-actions">
                <button type="button" onClick={() => onView(f)}>View</button>
                <button type="button" onClick={() => onAttach(f)}>Attach</button>
                <a className="button" href={`/api/files/${f.id}?download=1`}>Download</a>
                <button type="button" className="danger" onClick={() => remove(f)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
