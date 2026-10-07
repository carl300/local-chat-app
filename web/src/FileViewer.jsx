import { useEffect, useState } from "react";

const PREVIEW_STYLE = `<style>
  body { font-family: system-ui, sans-serif; margin: 16px; color: #1c1c1f; background: #fff; }
  table { border-collapse: collapse; margin-bottom: 20px; }
  td, th { border: 1px solid #d5d5da; padding: 4px 8px; }
  h2 { font-size: 1rem; }
  pre { white-space: pre-wrap; }
</style>`;

// Pop-up that shows a file: PDFs and images directly, other files as a preview.
export default function FileViewer({ file, onClose }) {
  const [html, setHtml] = useState(null);
  const [error, setError] = useState("");
  const direct = file.kind === "pdf" || file.kind === "image";
  const src = `/api/files/${file.id}`;

  useEffect(() => {
    if (direct) return;
    fetch(`${src}/preview`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setHtml(data.html);
      })
      .catch((e) => setError(e.message || "Couldn't preview this file."));
  }, [file.id]);

  // Close with the Escape key.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={file.name}>
        <div className="modal-header">
          <span className="file-name" title={file.name}>{file.name}</span>
          <div className="file-actions">
            <a className="button" href={src} target="_blank" rel="noreferrer">Open in new tab</a>
            <a className="button" href={`${src}?download=1`}>Download</a>
            <button type="button" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>
        <div className="modal-body">
          {file.kind === "pdf" && <iframe src={src} title={file.name} />}
          {file.kind === "image" && <img src={src} alt={file.name} />}
          {!direct && error && <p className="error">{error}</p>}
          {!direct && !error && html === null && <p className="muted">Loading preview…</p>}
          {/* sandbox="" stops anything in the document from running scripts */}
          {!direct && html !== null && <iframe sandbox="" srcDoc={PREVIEW_STYLE + html} title={file.name} />}
        </div>
      </div>
    </div>
  );
}
