import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { getUpload, toClaudeContent } from "./files.js";

const MODEL = process.env.BEDROCK_MODEL || "anthropic.claude-sonnet-5-5";
const REGION = process.env.AWS_REGION || "us-east-1";
const MAX_HISTORY = 20; // only send the most recent messages, to keep requests small

// Credentials come from the standard AWS chain: the ECS task role in AWS,
// or your AWS CLI profile / environment variables when running locally.
const ai = new AnthropicBedrockMantle({ awsRegion: REGION });

export const aiEnabled = process.env.AI_DISABLED !== "1";
export const modelName = MODEL;

const SYSTEM_INSTRUCTION = `You are a helpful assistant inside a document chat app.
The user gives you instructions, often about files they've attached (PDFs, spreadsheets, Word documents, images, text).
Follow the instructions and return the result directly.
- When the result is a list of values or rows, present it as a Markdown table so it can be downloaded as a spreadsheet.
- Be precise with numbers. For calculations, give the final value and briefly show how you got it.
- If the files don't contain what's needed, say so instead of guessing.`;

// Convert the app's chat messages into Messages API format.
async function buildMessages(messages) {
  const out = [];
  for (const m of messages.slice(-MAX_HISTORY)) {
    if (m.role === "assistant") {
      out.push({ role: "assistant", content: m.content || "(empty)" });
      continue;
    }
    const content = [];
    for (const a of m.attachments || []) {
      const meta = await getUpload(a.id);
      content.push(meta ? await toClaudeContent(meta) : { type: "text", text: `(The file "${a.name}" is no longer available.)` });
    }
    content.push({ type: "text", text: m.content || "(See the attached files.)" });
    out.push({ role: "user", content });
  }
  // The conversation must start with a user turn.
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export async function generateReply(messages) {
  const response = await ai.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" },
    system: SYSTEM_INSTRUCTION,
    messages: await buildMessages(messages),
  });
  if (response.stop_reason === "refusal") {
    return "Sorry, I can't help with that request.";
  }
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return text || "(No response.)";
}

// Turn API errors into messages a user can act on.
export function friendlyError(err) {
  const status = err?.status;
  if (status === 429) return "Too many requests right now. Wait a minute and try again.";
  if (status === 401 || status === 403) return "The server isn't allowed to use Bedrock. Check the task role and Bedrock model access.";
  if (status === 413 || /too large|payload/i.test(err?.message || "")) return "The attached files are too large to send together. Try fewer or smaller files.";
  return "The AI service had a problem. Please try again.";
}
