// Client Messages API tối giản bằng fetch (không cần @anthropic-ai/sdk).
// Transport có thể thay bằng stub để test không cần API key.

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "thinking"; thinking: string; signature?: string };

export type UserBlock =
  | { type: "text"; text: string }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface Message {
  role: "user" | "assistant";
  content: string | (ContentBlock | UserBlock)[];
}

export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ToolChoice =
  | { type: "auto" }
  | { type: "any" }
  | { type: "tool"; name: string }
  | { type: "none" };

export interface MessagesRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Message[];
  tools?: Tool[];
  tool_choice?: ToolChoice;
  thinking?: { type: "enabled"; budget_tokens: number };
}

export interface MessagesResponse {
  id: string;
  role: "assistant";
  content: ContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "pause_turn" | "refusal";
  usage?: { input_tokens: number; output_tokens: number };
}

export type Transport = (req: MessagesRequest) => Promise<MessagesResponse>;

export const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5";

/** Transport thật: gọi https://api.anthropic.com/v1/messages, cần ANTHROPIC_API_KEY. */
export function httpTransport(apiKey = process.env.ANTHROPIC_API_KEY): Transport {
  if (!apiKey) throw new Error("Thiếu ANTHROPIC_API_KEY (hoặc dùng bản chạy bằng CLI: run_cli.sh)");
  const base = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
  return async (req) => {
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`Messages API ${res.status}: ${await res.text()}`);
    return (await res.json()) as MessagesResponse;
  };
}

export const textOf = (r: MessagesResponse): string =>
  r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");

export const toolUsesOf = (r: MessagesResponse) =>
  r.content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
