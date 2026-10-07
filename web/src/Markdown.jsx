import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Shows the AI's answer with formatting (headings, lists, tables).
// Raw HTML in the answer is not rendered, so it can't run anything on the page.
const components = {
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
  table: ({ node, ...props }) => (
    <div className="table-wrap">
      <table {...props} />
    </div>
  ),
};

export default function Markdown({ children }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
