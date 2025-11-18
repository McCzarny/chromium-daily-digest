import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { GitilesCommit, StructuredSummary, SummaryConfig } from "../types";
import { 
  DailySummaryData,
  PlatformAdapter,
  ToolCall,
  generateSummaryWithStrategy,
  createWeeklyPrompt
} from "./llmService";

const SECRET_GEMINI_API_KEY = process.env.SECRET_GEMINI_API_KEY;

if (!SECRET_GEMINI_API_KEY) {
  throw new Error("SECRET_GEMINI_API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: SECRET_GEMINI_API_KEY });
const model = "gemini-2.5-pro";

// Retry configuration
const MAX_API_RETRIES = 10;
const RETRY_DELAY_MS = 60000;

/**
 * Helper function to make API calls with retry logic for rate limit errors
 */
async function generateContentWithRetry(
  contents: any[],
  config: any,
  operationName: string = 'API call'
): Promise<any> {
  for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt++) {
    try {
      return await ai.models.generateContent({
        model,
        contents,
        config,
      });
    } catch (error: any) {
      const isRateLimitError = error?.message?.toLowerCase().includes('rate limit') || 
                               error?.message?.toLowerCase().includes('quota') ||
                               error?.message?.toLowerCase().includes('429') ||
                               error?.message?.toLowerCase().includes('overloaded') ||
                               error?.status === 429;
      
      if (isRateLimitError && attempt < MAX_API_RETRIES) {
        console.warn(`\n⚠️  RATE LIMIT ERROR during ${operationName} (Attempt ${attempt}/${MAX_API_RETRIES})`);
        console.warn(`Error details: ${error?.message || error}`);
        console.warn(`Waiting ${RETRY_DELAY_MS / 1000} seconds before retry...`);
        console.warn(`Chat history preserved - will resume from current state`);
        
        const startTime = Date.now();
        const interval = setInterval(() => {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          const remaining = Math.ceil((RETRY_DELAY_MS / 1000) - elapsed);
          if (remaining > 0) {
            process.stdout.write(`\r⏳ Waiting... ${remaining}s remaining `);
          }
        }, 1000);
        
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        clearInterval(interval);
        process.stdout.write('\r✓ Wait complete, retrying from current state...\n\n');
        continue;
      }
      
      // Not a rate limit error or max retries reached
      if (attempt === MAX_API_RETRIES) {
        throw new Error(`Failed ${operationName} after ${MAX_API_RETRIES} attempts. Last error: ${error?.message || error}`);
      }
      throw error;
    }
  }
  throw new Error(`Failed ${operationName} after all retry attempts`);
}

// Define the function that the AI can call to get commit details
const getCommitDetailsTool: FunctionDeclaration = {
  name: "get_commit_details",
  description: "Fetches detailed information about specific commits including file changes, diffs, and statistics. Use this when you need more context about what actually changed in a commit beyond just the commit message. You can request details for multiple commits at once.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      commit_hashes: {
        type: Type.ARRAY,
        description: "An array of commit hashes (full SHA) to fetch details for. You can request up to 10 commits at once.",
        items: {
          type: Type.STRING,
        },
      },
    },
    required: ["commit_hashes"],
  },
};

/**
 * Gemini Platform Adapter
 * Implements the PlatformAdapter interface for Google Gemini API
 */
class GeminiAdapter implements PlatformAdapter {
  private chatHistory: any[] = [];

  async callAPI(
    _messages: any[],
    options: {
      systemPrompt?: string;
      enableTools?: boolean;
      requestJson?: boolean;
    }
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    const config: any = {};

    if (options.enableTools) {
      config.tools = [{
        functionDeclarations: [getCommitDetailsTool],
      }];
    }

    if (options.requestJson) {
      config.responseMimeType = "application/json";
      config.responseSchema = {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          overview: { type: Type.STRING },
          categories: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                points: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      text: { type: Type.STRING },
                      commits: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING }
                      },
                      isBreaking: { type: Type.BOOLEAN }
                    },
                    required: ["text", "commits"]
                  }
                }
              },
              required: ["title", "points"]
            }
          }
        },
        required: ["title", "overview", "categories"]
      };
    }

    const response = await generateContentWithRetry(
      this.chatHistory,
      config,
      'API call'
    );

    // Add AI response to history
    this.chatHistory.push({ 
      role: "model", 
      parts: response.candidates?.[0]?.content?.parts || []
    });

    // Check if AI made function calls
    const functionCalls = response.functionCalls;
    
    if (functionCalls && functionCalls.length > 0) {
      const toolCalls: ToolCall[] = functionCalls.map((call: any) => ({
        id: `call_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        name: call.name,
        arguments: JSON.stringify(call.args),
      }));

      return {
        content: response.text || "",
        toolCalls,
      };
    }

    return {
      content: response.text || "",
    };
  }

  addMessage(role: 'user' | 'assistant' | 'tool', content: string, toolCalls?: ToolCall[]): void {
    if (role === 'tool') {
      // Tool responses in Gemini are added as function responses
      const functionResponse = {
        name: "get_commit_details",
        response: JSON.parse(content.split('\n').slice(1).join('\n')), // Extract JSON from formatted response
      };
      
      this.chatHistory.push({
        role: "user",
        parts: [{ functionResponse }],
      });
    } else if (role === 'user') {
      this.chatHistory.push({
        role: "user",
        parts: [{ text: content }],
      });
    } else if (role === 'assistant') {
      // Assistant messages with tool calls are already added in callAPI
      // This is a no-op for Gemini since we add them during the API call
    }
  }

  getMessages(): any[] {
    return this.chatHistory;
  }

  resetMessages(): void {
    this.chatHistory = [];
  }
}

/**
 * Main function to generate summary with automatic chunking if needed
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
  console.log("  Using Gemini for summary generation...");

  const adapter = new GeminiAdapter();
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
 * Generate a weekly summary from daily summaries
 */
export async function generateWeeklySummary(
  dailySummaries: DailySummaryData[],
  config: SummaryConfig,
  startDate: string,
  endDate: string,
  year: number,
  week: number
): Promise<StructuredSummary> {
  console.log(`  Generating weekly summary for ${year} Week ${week} using Gemini...`);

  const adapter = new GeminiAdapter();
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
    systemPrompt: 'You are an expert technical writer creating weekly summaries of Chromium development.',
    enableTools: false,
    requestJson: true,
  });

  const summary = JSON.parse(response.content) as StructuredSummary;
  console.log(`  ✓ Weekly summary generated with ${summary.categories.length} categories`);
  
  return summary;
}
