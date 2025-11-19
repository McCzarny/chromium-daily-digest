import { GitilesCommit, StructuredSummary, SummaryConfig } from "../types";
import { 
  DailySummaryData,
  PlatformAdapter,
  ToolCall,
  generateSummaryWithStrategy,
  createWeeklyPrompt
} from "./llmService";

const NEXOS_TOKEN = process.env.SECRET_NEXOS_TOKEN;
const NEXOS_API_BASE = "https://api.nexos.ai/v1";
const NEXOS_MODEL = "8b77459d-7cc0-4bcd-a671-34648dd4aec6"; // gemini-2.5-pro

interface NexosMessage {
  role: "system" | "user" | "assistant";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface NexosTool {
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

interface NexosStreamChunk {
  choices: Array<{
    delta: {
      content?: string;
      role?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
    index: number;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Define the tool for getting commit details
const getCommitDetailsTool: NexosTool = {
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
 * Nexos Platform Adapter
 * Implements the PlatformAdapter interface for Nexos.ai API
 */
class NexosAdapter implements PlatformAdapter {
  private messages: NexosMessage[] = [];

  async callAPI(
    _messages: any[],
    options: {
      systemPrompt?: string;
      enableTools?: boolean;
      requestJson?: boolean;
    }
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    if (!NEXOS_TOKEN) {
      throw new Error("SECRET_NEXOS_TOKEN environment variable not set");
    }

    const timeoutMs = 300000; // 5 minutes
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Build messages with optional system prompt
    const apiMessages: NexosMessage[] = [];
    if (options.systemPrompt) {
      apiMessages.push({ role: "system", content: options.systemPrompt });
    }
    apiMessages.push(...this.messages);

    try {
      const response = await fetch(`${NEXOS_API_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${NEXOS_TOKEN}`,
        },
        body: JSON.stringify({
          model: NEXOS_MODEL,
          messages: apiMessages,
          temperature: 0.3,
          response_format: options.requestJson ? { type: "json_object" } : undefined,
          stream: true,
          ...(options.enableTools && { tools: [getCommitDetailsTool] }),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Nexos API error (${response.status}): ${errorText}`);
      }

      if (!response.body) {
        throw new Error("No response body from Nexos API");
      }

      // Process streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let usage: any = null;
      let chunks = "";
      const toolCallsMap = new Map<number, { id?: string; name?: string; arguments?: string }>();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks += decoder.decode(value, { stream: true });
        }
      } finally {
        reader.releaseLock();
      }

      const lines = chunks.split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed: NexosStreamChunk = JSON.parse(data);

            if (parsed.choices && parsed.choices[0]?.delta) {
              const delta = parsed.choices[0].delta;
              
              if (delta.content) {
                fullContent += delta.content;
              }
              
              if (delta.tool_calls) {
                for (const toolCall of delta.tool_calls) {
                  const index = toolCall.index ?? 0;
                  if (!toolCallsMap.has(index)) {
                    toolCallsMap.set(index, {});
                  }
                  const existing = toolCallsMap.get(index)!;
                  
                  if (toolCall.id) existing.id = toolCall.id;
                  if (toolCall.function?.name) existing.name = toolCall.function.name;
                  if (toolCall.function?.arguments) {
                    existing.arguments = (existing.arguments || '') + toolCall.function.arguments;
                  }
                }
              }
            }
            if (parsed.usage) {
              usage = parsed.usage;
            }
          } catch (e) {
            // Ignore parsing errors for individual chunks
            continue;
          }
        }
      }

      if (usage) {
        console.log(`  Tokens: ${usage.prompt_tokens} prompt, ${usage.completion_tokens} completion, ${usage.total_tokens} total`);
      }

      // Convert tool calls map to array
      const toolCalls: ToolCall[] = [];
      for (const [, toolCall] of toolCallsMap) {
        if (toolCall.id && toolCall.name && toolCall.arguments) {
          toolCalls.push({
            id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
          });
        }
      }

      return { 
        content: fullContent, 
        ...(toolCalls.length > 0 && { toolCalls })
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
      throw error;
    }
  }

  addMessage(role: 'user' | 'assistant' | 'tool', content: string, toolCalls?: ToolCall[]): void {
    if (role === 'tool') {
      // Tool responses are added as user messages in OpenAI-compatible APIs
      this.messages.push({ role: 'user', content });
    } else {
      const message: NexosMessage = { 
        role: role === 'assistant' ? 'assistant' : 'user', 
        content 
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
 * Generate a daily summary using Nexos.ai
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
  console.log("  Using Nexos.ai for summary generation...");
  
  const adapter = new NexosAdapter();
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
 * Generate a weekly summary using Nexos.ai
 */
export async function generateWeeklySummary(
  dailySummaries: DailySummaryData[],
  config: SummaryConfig,
  startDate: string,
  endDate: string,
  year: number,
  week: number
): Promise<StructuredSummary> {
  console.log(`  Generating weekly summary for ${year} Week ${week} using Nexos.ai...`);

  const adapter = new NexosAdapter();
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
