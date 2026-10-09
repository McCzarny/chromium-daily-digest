import { randomUUID } from "crypto";
import { GitilesCommit, StructuredSummary, SummaryConfig } from "../types";
import { 
  DailySummaryData,
  PlatformAdapter,
  ToolCall,
  generateSummaryWithStrategy,
  createWeeklyPrompt
} from "./llmService";

const OPENCODE_TOKEN = process.env.SECRET_OPENCODE_API_KEY || process.env.OPENCODE_API_KEY;
const OPENCODE_API_BASE = process.env.OPENCODE_API_BASE || "https://opencode.ai/zen/go/v1";
const DEFAULT_OPENCODE_MODEL = "glm-5.3-flash"; // GLM-5.3-Flash
const BACKUP_OPENCODE_MODEL = "gpt-5.6-luna";
// Identify ourselves with a dedicated user agent rather than the default SDK/HTTP one.
const OPENCODE_USER_AGENT = process.env.OPENCODE_USER_AGENT || "chromium-daily-digest/1.0";

// Retry configuration for transient OpenCode API errors (e.g. 500 Internal Server Error)
const MAX_API_RETRIES = 7;
const RETRY_DELAY_MS = 30000; // 30 seconds
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Resolve the model to use, allowing override via config or environment.
 */
function getOpenCodeModel(config?: SummaryConfig): string {
  return config?.llmModel || process.env.OPENCODE_MODEL || DEFAULT_OPENCODE_MODEL;
}

/**
 * OpenCode Zen serves every model over exactly one protocol. Posting a model to the
 * wrong endpoint fails with `400 ModelProtocolUnsupported`, so the protocol is
 * derived from the model id rather than hardcoded.
 * See https://opencode.ai/docs/zen/#endpoints
 */
type OpenCodeProtocol = "chat-completions" | "responses";

/** Model id prefixes Zen serves over the OpenAI Responses API. */
const RESPONSES_PROTOCOL_PREFIXES = ["gpt-", "grok-", "muse-spark-"];

/**
 * Models Zen serves over a protocol this adapter does not implement. They are
 * rejected up front so the failure names the real cause instead of surfacing a
 * ModelProtocolUnsupported error from the gateway.
 */
const UNSUPPORTED_PROTOCOLS: Array<{ match: (id: string) => boolean; endpoint: string }> = [
  { match: id => id.startsWith("claude-"), endpoint: "the Anthropic Messages API (/v1/messages)" },
  { match: id => id.startsWith("gemini-"), endpoint: "the Google generateContent API (/v1/models/{id})" },
  // These share a prefix with Qwen3.8 Max, which is chat/completions, so they are
  // matched by exact id rather than by prefix.
  {
    match: id => ["qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus", "qwen3.5-plus", "qwen3.8-flash"].includes(id),
    endpoint: "the Anthropic Messages API (/v1/messages)",
  },
];

function resolveProtocol(model: string): OpenCodeProtocol {
  const id = model.trim().toLowerCase();

  for (const { match, endpoint } of UNSUPPORTED_PROTOCOLS) {
    if (match(id)) {
      throw new Error(
        `OpenCode model "${model}" is served over ${endpoint}, which this adapter does not implement. ` +
        `Use a chat/completions model (e.g. glm-5.3-flash, kimi-k3, deepseek-v4.1-flash) ` +
        `or a Responses model (e.g. gpt-5.6-luna).`
      );
    }
  }

  return RESPONSES_PROTOCOL_PREFIXES.some(prefix => id.startsWith(prefix))
    ? "responses"
    : "chat-completions";
}

/**
 * A conversation item in a protocol-neutral shape. The two protocols disagree on how
 * assistant tool calls and tool results are represented, so the adapter stores one
 * internal shape and serializes it per request.
 */
type ConversationItem =
  | { kind: "system"; text: string }
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; toolCalls?: ToolCall[] }
  | { kind: "tool"; callId: string | null; text: string };

interface OpenCodeMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

/** Serialize the conversation to the OpenAI Chat Completions format. */
function toChatCompletionsMessages(items: ConversationItem[]): OpenCodeMessage[] {
  const messages: OpenCodeMessage[] = [];
  for (const item of items) {
    switch (item.kind) {
      case "system":
        messages.push({ role: "system", content: item.text });
        break;
      case "user":
        messages.push({ role: "user", content: item.text });
        break;
      case "assistant":
        messages.push({
          role: "assistant",
          content: item.text,
          ...(item.toolCalls?.length
            ? {
                tool_calls: item.toolCalls.map(call => ({
                  id: call.id,
                  type: "function" as const,
                  function: { name: call.name, arguments: call.arguments },
                })),
              }
            : {}),
        });
        break;
      case "tool":
        // Chat Completions has no dedicated tool role; results go back as user turns.
        messages.push({ role: "user", content: item.text });
        break;
    }
  }
  return messages;
}

/** Serialize the conversation to the OpenAI Responses format. */
function toResponsesInput(items: ConversationItem[]): unknown[] {
  const input: unknown[] = [];
  for (const item of items) {
    switch (item.kind) {
      case "system":
        input.push({ role: "system", content: [{ type: "input_text", text: item.text }] });
        break;
      case "user":
        input.push({ role: "user", content: [{ type: "input_text", text: item.text }] });
        break;
      case "assistant": {
        // A tool-only turn has no text; Responses rejects empty message items.
        if (item.text) {
          input.push({
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: item.text }],
          });
        }
        for (const call of item.toolCalls || []) {
          input.push({
            type: "function_call",
            call_id: call.id,
            name: call.name,
            arguments: call.arguments,
          });
        }
        break;
      }
      case "tool":
        if (item.callId) {
          input.push({ type: "function_call_output", call_id: item.callId, output: item.text });
        } else {
          // No call id was captured for this result, so replay it as a plain turn.
          input.push({ role: "user", content: [{ type: "input_text", text: item.text }] });
        }
        break;
    }
  }
  return input;
}

interface OpenCodeTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, any>;
      required: string[];
    };
  };
}

interface OpenCodeResponse {
  error?: {
    type?: string;
    message?: string;
    code?: string | number;
  };
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenCodeModelInfo {
  id?: string;
  name?: string;
  context_length?: number;
  context_window?: number;
  max_context_length?: number;
  top_provider?: { context_length?: number };
}

const contextLimitCache = new Map<string, Promise<number>>();

/**
 * OpenCode's model list may expose context_length. Treat it as optional because
 * compatible gateways do not all implement /models or use the same field.
 */
async function getContextLimit(model: string): Promise<number> {
  const configuredLimit = Number(process.env.OPENCODE_CONTEXT_LIMIT);
  if (Number.isFinite(configuredLimit) && configuredLimit > 0) return configuredLimit;

  // Zen's /models response omits context_length, which would fall through to the
  // 1M default. Zen bills GPT models at a higher rate above 272K tokens, so treat
  // that as the effective limit to keep the usage warning meaningful.
  if (model.trim().toLowerCase().startsWith("gpt-")) return 272000;

  const defaultLimit = 1000000000; // 1M tokens
  let lookup = contextLimitCache.get(model);
  if (!lookup) {
    lookup = (async () => {
      try {
        const response = await fetch(`${OPENCODE_API_BASE}/models`, {
          headers: {
            "Authorization": `Bearer ${OPENCODE_TOKEN}`,
            "User-Agent": OPENCODE_USER_AGENT,
          },
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return defaultLimit;

        const payload = await response.json() as { data?: OpenCodeModelInfo[] } | OpenCodeModelInfo[];
        const models = Array.isArray(payload) ? payload : payload.data || [];
        const info = models.find(item => item.id === model || item.name === model);
        return info?.context_length || info?.context_window || info?.max_context_length || info?.top_provider?.context_length || defaultLimit;
      } catch {
        // Context discovery is advisory and must never prevent generation.
        return defaultLimit;
      }
    })();
    contextLimitCache.set(model, lookup);
  }
  return lookup;
}

async function warnAboutContextSize(
  model: string,
  payload: unknown,
  tools?: unknown[]
): Promise<void> {
  const contextLimit = await getContextLimit(model);

  // A rough 4 characters/token estimate, reserving space for the response.
  const requestCharacters =
    JSON.stringify(payload)?.length + (tools ? JSON.stringify(tools).length : 0);
  const estimatedPromptTokens = Math.ceil(requestCharacters / 4);
  const reservedOutputTokens = 4096;
  const estimatedContextTokens = estimatedPromptTokens + reservedOutputTokens;
  const usagePercent = estimatedContextTokens / contextLimit;

  console.log(`  Context estimate for ${model}: ~${estimatedContextTokens.toLocaleString()} / ${contextLimit.toLocaleString()} tokens (${Math.round(usagePercent * 100)}%)`);
  if (usagePercent >= 0.8) {
    console.warn(`⚠️  OpenCode context warning: this request may exceed ${model}'s context capacity (${Math.round(usagePercent * 100)}% estimated).`);
  }
}

// Define the tool for getting commit details
const getCommitDetailsTool: OpenCodeTool = {
  type: "function",
  function: {
    name: "get_commit_details",
    description: "Fetches detailed information about specific commits including file changes, diffs, and statistics. Use this when you need more context about what actually changed in a commit beyond just the commit message. You can request details for multiple commits at once.",
    parameters: {
      type: "object",
      properties: {
        commit_hashes: {
          type: "array",
          description: "An array of commit hashes (full SHA) to fetch details for. You can request up to 10 commits at once.",
          items: {
            type: "string",
          },
        },
      },
      required: ["commit_hashes"],
    },
  },
};

// The same tool in the Responses format, which nests nothing under "function".
const getCommitDetailsToolResponses = {
  type: "function" as const,
  name: getCommitDetailsTool.function.name,
  description: getCommitDetailsTool.function.description,
  parameters: getCommitDetailsTool.function.parameters,
};

interface OpenCodeRequest {
  /** Endpoint path appended to OPENCODE_API_BASE. */
  path: string;
  /** Serialized conversation, used for the context-size estimate. */
  payload: unknown;
  tools?: unknown[];
  body: Record<string, unknown>;
}

/**
 * Build the request for the current model, resolving the protocol from the model id.
 * Rebuilt after a failover because the backup model may speak a different protocol.
 */
function buildOpenCodeRequest(
  model: string,
  items: ConversationItem[],
  options: { enableTools?: boolean; requestJson?: boolean }
): OpenCodeRequest {
  const maxOutputTokens = Number(process.env.OPENCODE_MAX_OUTPUT_TOKENS);

  if (resolveProtocol(model) === "responses") {
    const input = toResponsesInput(items);
    return {
      path: "/responses",
      payload: input,
      ...(options.enableTools && { tools: [getCommitDetailsToolResponses] }),
      body: {
        model,
        input,
        // These models reject `temperature` with a 400, so it is intentionally omitted.
        // Opt in to server-side retention with OPENCODE_STORE_RESPONSES=true.
        store: process.env.OPENCODE_STORE_RESPONSES === "true",
        ...(options.requestJson && { text: { format: { type: "json_object" } } }),
        ...(options.enableTools && { tools: [getCommitDetailsToolResponses] }),
        ...(Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
          ? { max_output_tokens: maxOutputTokens }
          : {}),
      },
    };
  }

  const messages = toChatCompletionsMessages(items);
  return {
    path: "/chat/completions",
    payload: messages,
    ...(options.enableTools && { tools: [getCommitDetailsTool] }),
    body: {
      model,
      messages,
      temperature: 0.3,
      ...(options.requestJson && { response_format: { type: "json_object" } }),
      ...(options.enableTools && { tools: [getCommitDetailsTool] }),
    },
  };
}

/** Log token usage and warn when the prompt approaches the context limit. */
async function reportUsage(
  model: string,
  promptTokens: number,
  completionTokens: number,
  totalTokens: number
): Promise<void> {  console.log(
    `  Tokens: ${promptTokens} prompt, ${completionTokens} completion, ${totalTokens} total`
  );
  const contextLimit = await getContextLimit(model);
  if (contextLimit && promptTokens / contextLimit >= 0.8) {
    console.warn(
      `⚠️  OpenCode context warning: API reported ${promptTokens.toLocaleString()} prompt tokens for a ${contextLimit.toLocaleString()}-token context.`
    );
  }
}

/** Extract assistant text and tool calls from a Responses payload. */
function parseResponsesPayload(
  data: any,
  model: string
): { content: string; toolCalls?: ToolCall[] } {
  if (data.status === "failed" || data.error) {
    const error: any = new Error(
      `OpenCode API error: ${data.error?.message || JSON.stringify(data.error)}`
    );
    error.status = 500;
    error.apiErrorType = data.error?.type;
    throw error;
  }

  // Truncation is reported as HTTP 200 with an "incomplete" status. Retrying the
  // identical request would truncate again, so this is surfaced as a hard error
  // rather than silently producing an empty or partial summary.
  if (data.status === "incomplete") {
    const reason = data.incomplete_details?.reason || "unknown";
    const error: any = new Error(
      `OpenCode returned an incomplete ${model} response (reason: ${reason}). ` +
        `Raise OPENCODE_MAX_OUTPUT_TOKENS, or use a model with a larger output budget.`
    );
    error.status = 400;
    throw error;
  }

  const output: any[] = data.output || [];
  const content = output
    .filter(item => item.type === "message")
    .flatMap(item => item.content || [])
    .filter(part => part.type === "output_text")
    .map(part => part.text)
    .join("");

  const toolCalls: ToolCall[] = output
    .filter(item => item.type === "function_call" && item.name)
    .map(item => ({
      id: item.call_id || item.id,
      name: item.name,
      arguments: item.arguments || "{}",
    }));

  if (data.usage) {
    // Usage reporting is advisory and must never turn a good response into a failure.
    reportUsage(
      model,
      data.usage.input_tokens || 0,
      data.usage.output_tokens || 0,
      data.usage.total_tokens || 0
    ).catch(() => {});
  }

  return {
    content,
    ...(toolCalls.length > 0 && { toolCalls }),
  };
}

/** Extract assistant text and tool calls from a Chat Completions payload. */
function parseChatCompletionsPayload(
  data: OpenCodeResponse,
  model: string
): { content: string; toolCalls?: ToolCall[] } {
  const message = data.choices?.[0]?.message;
  const content = message?.content || "";

  const toolCalls: ToolCall[] = (message?.tool_calls || [])
    .filter(tc => tc.function?.name && tc.function?.arguments)
    .map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

  if (data.usage) {
    reportUsage(
      model,
      data.usage.prompt_tokens || 0,
      data.usage.completion_tokens || 0,
      data.usage.total_tokens || 0
    ).catch(() => {});
  }

  return {
    content,
    ...(toolCalls.length > 0 && { toolCalls }),
  };
}

/**
 * OpenCode Platform Adapter
 * Implements the PlatformAdapter interface for the OpenCode Go API, which serves
 * each model over either /chat/completions or /responses depending on the model.
 */
class OpenCodeAdapter implements PlatformAdapter {
  private items: ConversationItem[] = [];
  private model: string;
  // Tool call ids from the most recent assistant turn, in order, so that tool
  // results can be paired with the call they answer.
  private pendingToolCallIds: string[] = [];
  // Stable identifier for this conversation, used for routing and prompt caching.
  private sessionId: string;

  constructor(model: string = DEFAULT_OPENCODE_MODEL) {
    this.model = model;
    this.sessionId = randomUUID();
  }

  getModel(): string {
    return this.model;
  }

  async callAPI(
    _messages: any[],
    options: {
      systemPrompt?: string;
      enableTools?: boolean;
      requestJson?: boolean;
    }
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    if (!OPENCODE_TOKEN) {
      throw new Error("SECRET_OPENCODE_API_KEY environment variable not set");
    }

    const timeoutMs = 900000; // 15 minutes

    // Build the conversation with the optional system prompt, then let
    // buildOpenCodeRequest encode it for whichever protocol this model uses.
    const items: ConversationItem[] = [];
    if (options.systemPrompt) {
      items.push({ kind: "system", text: options.systemPrompt });
    }
    items.push(...this.items);

    let request = buildOpenCodeRequest(this.model, items, options);
    await warnAboutContextSize(this.model, request.payload, request.tools);

    for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`${OPENCODE_API_BASE}${request.path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENCODE_TOKEN}`,
            "User-Agent": OPENCODE_USER_AGENT,
            "x-opencode-session": this.sessionId,
          },
          body: JSON.stringify(request.body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          const error: any = new Error(`OpenCode API error (${response.status}): ${errorText}`);
          error.status = response.status;
          throw error;
        }

        const data = await response.json();

        // Some OpenAI-compatible gateways return errors in a 2xx JSON body.
        if (data.error) {
          const error: any = new Error(
            `OpenCode API error: ${data.error.message || JSON.stringify(data.error)}`
          );
          error.status = response.status >= 400 ? response.status : 500;
          error.apiErrorType = data.error.type;
          throw error;
        }

        return request.path === "/responses"
          ? parseResponsesPayload(data, this.model)
          : parseChatCompletionsPayload(data, this.model);
      } catch (error: any) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
          throw new Error(`Request timed out after ${timeoutMs}ms`);
        }

        const isRetryable = error.status >= 500 || error.status === 429 || error.status === undefined;
        if (isRetryable && attempt < MAX_API_RETRIES) {
          const delay = Math.min(RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
          console.warn(`\n⚠️  Transient OpenCode API error (attempt ${attempt}/${MAX_API_RETRIES})`);
          console.warn(`Error details: ${error.message}`);
          console.warn(`Waiting ${delay / 1000} seconds before retry...`);

          if ( attempt >= (MAX_API_RETRIES / 2) && this.model !== BACKUP_OPENCODE_MODEL) {
            console.warn(`Switching to backup OpenCode model: ${BACKUP_OPENCODE_MODEL}`);
            this.model = BACKUP_OPENCODE_MODEL;
            // The backup model may use a different protocol, so re-encode the request.
            request = buildOpenCodeRequest(this.model, items, options);
          }
 
          await sleep(delay);
          continue;
        }

        throw error;
      }
    }

    throw new Error(`Failed OpenCode API call after ${MAX_API_RETRIES} attempts`);
  }

  addMessage(role: 'user' | 'assistant' | 'tool', content: string, toolCalls?: ToolCall[]): void {
    if (role === 'assistant') {
      this.items.push({ kind: 'assistant', text: content, toolCalls });
      // Remember the call ids in order; executeToolCalls returns results in the
      // same order, so a queue lets each result be paired with its call.
      this.pendingToolCallIds = (toolCalls || []).map(call => call.id);
    } else if (role === 'tool') {
      this.items.push({
        kind: 'tool',
        callId: this.pendingToolCallIds.shift() ?? null,
        text: content,
      });
    } else {
      this.items.push({ kind: 'user', text: content });
    }
  }

  getMessages(): any[] {
    return this.items;
  }

  resetMessages(): void {
    this.items = [];
    this.pendingToolCallIds = [];
  }
}

/**
 * Generate a daily summary using OpenCode Go
 */
export async function generateSummary(
  commits: GitilesCommit[],
  config: SummaryConfig,
  date: string,
  branch: string,
  totalCommitsCount: number,
  relevantCommitsCount: number,
  firstCommit: GitilesCommit,
  lastCommit: GitilesCommit
): Promise<StructuredSummary> {
  const model = getOpenCodeModel(config);
  console.log(`  Using OpenCode (${model}) for summary generation...`);

  const adapter = new OpenCodeAdapter(model);
  const summary = await generateSummaryWithStrategy(
    adapter,
    commits,
    config,
    date,
    branch,
    totalCommitsCount,
    relevantCommitsCount,
    firstCommit,
    lastCommit
  );
  summary.modelUsed = adapter.getModel();
  return summary;
}

/**
 * Generate a weekly summary using OpenCode Go
 */
export async function generateWeeklySummary(
  dailySummaries: DailySummaryData[],
  config: SummaryConfig,
  startDate: string,
  endDate: string,
  year: number,
  week: number
): Promise<StructuredSummary> {
  const model = getOpenCodeModel(config);
  console.log(`  Generating weekly summary for ${year} Week ${week} using OpenCode (${model})...`);

  const adapter = new OpenCodeAdapter(model);
  const prompt = createWeeklyPrompt(
    dailySummaries,
    config,
    startDate,
    endDate,
    year,
    week
  );

  adapter.addMessage('user', prompt);

  const response = await adapter.callAPI(adapter.getMessages(), {
    systemPrompt: 'You are an expert technical writer creating weekly summaries of Chromium development. Respond with valid JSON only.',
    enableTools: false,
    requestJson: true,
  });

  const summary = JSON.parse(response.content) as StructuredSummary;
  summary.modelUsed = adapter.getModel();
  console.log(`  ✓ Weekly summary generated with ${summary.categories.length} categories`);

  return summary;
}
