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
// Identify ourselves with a dedicated user agent rather than the default SDK/HTTP one.
const OPENCODE_USER_AGENT = process.env.OPENCODE_USER_AGENT || "chromium-daily-digest/1.0";

// Retry configuration for transient OpenCode API errors (e.g. 500 Internal Server Error)
const MAX_API_RETRIES = 5;
const RETRY_DELAY_MS = 30000; // 30 seconds

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Resolve the model to use, allowing override via config or environment.
 */
function getOpenCodeModel(config?: SummaryConfig): string {
  return config?.llmModel || process.env.OPENCODE_MODEL || DEFAULT_OPENCODE_MODEL;
}

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

/**
 * OpenCode Platform Adapter
 * Implements the PlatformAdapter interface for the OpenCode Go API,
 * which exposes an OpenAI-compatible /chat/completions endpoint.
 */
class OpenCodeAdapter implements PlatformAdapter {
  private messages: OpenCodeMessage[] = [];
  private model: string;
  // Stable identifier for this conversation, used for routing and prompt caching.
  private sessionId: string;

  constructor(model: string = DEFAULT_OPENCODE_MODEL) {
    this.model = model;
    this.sessionId = randomUUID();
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

    // Build messages with optional system prompt
    const apiMessages: OpenCodeMessage[] = [];
    if (options.systemPrompt) {
      apiMessages.push({ role: "system", content: options.systemPrompt });
    }
    apiMessages.push(...this.messages);

    for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`${OPENCODE_API_BASE}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENCODE_TOKEN}`,
            "User-Agent": OPENCODE_USER_AGENT,
            "x-opencode-session": this.sessionId,
          },
          body: JSON.stringify({
            model: this.model,
            messages: apiMessages,
            temperature: 0.3,
            ...(options.requestJson && { response_format: { type: "json_object" } }),
            ...(options.enableTools && { tools: [getCommitDetailsTool] }),
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          const error: any = new Error(`OpenCode API error (${response.status}): ${errorText}`);
          error.status = response.status;
          throw error;
        }

        const data = (await response.json()) as OpenCodeResponse;

        if (data.usage) {
          console.log(`  Tokens: ${data.usage.prompt_tokens} prompt, ${data.usage.completion_tokens} completion, ${data.usage.total_tokens} total`);
        }

        const message = data.choices?.[0]?.message;
        const content = message?.content || "";

        const toolCalls: ToolCall[] = (message?.tool_calls || [])
          .filter(tc => tc.function?.name && tc.function?.arguments)
          .map(tc => ({
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          }));

        return {
          content,
          ...(toolCalls.length > 0 && { toolCalls }),
        };
      } catch (error: any) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
          throw new Error(`Request timed out after ${timeoutMs}ms`);
        }

        const isRetryable = error.status >= 500 || error.status === 429;
        if (isRetryable && attempt < MAX_API_RETRIES) {
          console.warn(`\n⚠️  Transient OpenCode API error (attempt ${attempt}/${MAX_API_RETRIES})`);
          console.warn(`Error details: ${error.message}`);
          console.warn(`Waiting ${RETRY_DELAY_MS / 1000} seconds before retry...`);
          await sleep(RETRY_DELAY_MS);
          continue;
        }

        throw error;
      }
    }

    throw new Error(`Failed OpenCode API call after ${MAX_API_RETRIES} attempts`);
  }

  addMessage(role: 'user' | 'assistant' | 'tool', content: string, toolCalls?: ToolCall[]): void {
    if (role === 'tool') {
      // Tool responses are added as user messages in OpenAI-compatible APIs
      this.messages.push({ role: 'user', content });
    } else {
      const message: OpenCodeMessage = {
        role: role === 'assistant' ? 'assistant' : 'user',
        content,
      };

      if (toolCalls && toolCalls.length > 0) {
        message.tool_calls = toolCalls.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        }));
      }

      this.messages.push(message);
    }
  }

  getMessages(): any[] {
    return this.messages;
  }

  resetMessages(): void {
    this.messages = [];
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
  return generateSummaryWithStrategy(
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
  console.log(`  ✓ Weekly summary generated with ${summary.categories.length} categories`);

  return summary;
}
