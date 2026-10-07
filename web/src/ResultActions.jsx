import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "./Markdown.jsx";
import { downloadBlob } from "./utils.js";

// Styles for the standalone result page (used for "View online" and the .html download).
const PAGE_STYLE = `
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.55;
         max-width: 820px; margin: 0 auto; padding: 32px 16px; color: #1c1c1f; background: #fff; }
  table { border-collapse: collapse; margin: 12px 0; }
  th, td { border: 1px solid #d5d5da; padding: 6px 10px; text-align: left; }
  th { background: #f2f2f5; }
  pre, code { background: #f2f2f5; border-radius: 4px; }
  pre { padding: 12px; overflow-x: auto; }
  .meta { color: #6b6b73; font-size: 0.85rem; border-bottom: 1px solid #e3e3e6; padding-bottom: 8px; margin-bottom: 16px; }
`;

function resultHtml(content) {
  return renderToStaticMarkup(<Markdown>{content}</Markdown>);
}

function resultPage(content) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Result</title><style>${PAGE_STYLE}</style></head>
<body><div class="meta">Result generated ${new Date().toLocaleString()}</div>${resultHtml(content)}</body></html>`;
}

function baseName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `result-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// Markdown tables look like "| a | b |" followed by a "|---|---|" line.
function hasTable(content) {
  return /^\s*\|.*\|\s*$/m.test(content) && /^\s*\|?\s*:?-{3,}/m.test(content);
}

// Asks whether to view the result in a browser tab or download it, then does it.
export default function ResultActions({ content }) {
  const [step, setStep] = useState("ask"); // "ask" or "download"
  const [error, setError] = useState("");

  function viewOnline() {
    const url = URL.createObjectURL(new Blob([resultPage(content)], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function downloadText() {
    downloadBlob(new Blob([content], { type: "text/plain;charset=utf-8" }), `${baseName()}.txt`);
  }

  function downloadHtml() {
    downloadBlob(new Blob([resultPage(content)], { type: "text/html;charset=utf-8" }), `${baseName()}.html`);
  }

  async function downloadExcel() {
    setError("");
    try {
      const XLSX = await import("xlsx"); // loaded only when needed
      const holder = document.createElement("div");
      holder.innerHTML = resultHtml(content);
      const wb = XLSX.utils.book_new();
      holder.querySelectorAll("table").forEach((table, i) => {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(table), `Table ${i + 1}`);
      });
      XLSX.writeFile(wb, `${baseName()}.xlsx`);
    } catch {
      setError("Couldn't create the Excel file.");
    }
  }

  return (
    <div className="result-actions">
      {step === "ask" ? (
        <>
          <span className="result-question">View this result online or download it?</span>
          <button type="button" onClick={viewOnline}>View online</button>
          <button type="button" onClick={() => setStep("download")}>Download</button>
        </>
      ) : (
        <>
          <span className="result-question">Download as:</span>
          {hasTable(content) && (
            <button type="button" onClick={downloadExcel}>Excel (.xlsx)</button>
          )}
          <button type="button" onClick={downloadHtml}>Web page (.html)</button>
          <button type="button" onClick={downloadText}>Text (.txt)</button>
          <button type="button" className="link" onClick={() => setStep("ask")}>Back</button>
        </>
      )}
      {error && <span className="result-error">{error}</span>}
    </div>
  );
}
