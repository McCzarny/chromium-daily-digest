import { GitilesCommit, StructuredSummary, SummaryConfig } from "../types";
import { generateSummary as generateGeminiSummary, generateWeeklySummary as generateGeminiWeeklySummary } from "./geminiService";
import { generateSummary as generateNexosSummary, generateWeeklySummary as generateNexosWeeklySummary } from "./nexosService";
import { fetchMultipleCommitDetails } from "./commitDetailService";

const SECRET_GITHUB_TOKEN = process.env.SECRET_GITHUB_TOKEN;

/**
 * LLM Provider types
 */
export type LLMProvider = 'gemini' | 'openai' | 'anthropic' | 'nexos';

/**
 * Daily summary data extracted from HTML
 */
export interface DailySummaryData {
  date: string;
  title: string;
  overview: string;
  categories: Array<{
    title: string;
    points: Array<{
      text: string;
      isBreaking: boolean;
      commits: string[];
    }>;
  }>;
  totalCommits: number;
  relevantCommits: number;
}

/**
 * Interface for LLM service implementations
 */
export interface ILLMService {
  generateSummary(
    commits: GitilesCommit[],
    config: SummaryConfig,
    date: string,
    branch: string,
    totalCommitsCount: number,
    relevantCommitsCount: number,
    firstCommit: GitilesCommit,
    lastCommit: GitilesCommit
  ): Promise<StructuredSummary>;
  
  generateWeeklySummary(
    dailySummaries: DailySummaryData[],
    config: SummaryConfig,
    startDate: string,
    endDate: string,
    year: number,
    week: number
  ): Promise<StructuredSummary>;
}

/**
 * LLM Service Proxy
 * 
 * This class acts as a proxy to different LLM providers.
 * Currently supports:
 * - Gemini (default)
 * 
 * Future providers can be added by:
 * 1. Creating a new service file (e.g., openaiService.ts)
 * 2. Implementing the ILLMService interface
 * 3. Adding the provider to the LLMProvider type
 * 4. Adding a case in getService() method
 */
export class LLMService implements ILLMService {
  private provider: LLMProvider;
  private service: ILLMService;

  constructor(provider: LLMProvider = 'gemini') {
    this.provider = provider;
    this.service = this.getService(provider);
  }

  /**
   * Get the appropriate service implementation based on provider
   */
  private getService(provider: LLMProvider): ILLMService {
    switch (provider) {
      case 'gemini':
        return {
          generateSummary: generateGeminiSummary,
          generateWeeklySummary: generateGeminiWeeklySummary,
        };
      case 'nexos':
        return {
          generateSummary: generateNexosSummary,
          generateWeeklySummary: generateNexosWeeklySummary,
        };
      case 'openai':
        throw new Error('OpenAI provider not yet implemented');
      case 'anthropic':
        throw new Error('Anthropic provider not yet implemented');
      default:
        throw new Error(`Unknown LLM provider: ${provider}`);
    }
  }

  /**
   * Generate summary using the configured LLM provider
   */
  async generateSummary(
    commits: GitilesCommit[],
    config: SummaryConfig,
    date: string,
    branch: string,
    totalCommitsCount: number,
    relevantCommitsCount: number,
    firstCommit: GitilesCommit,
    lastCommit: GitilesCommit
  ): Promise<StructuredSummary> {
    console.log(`  Using LLM provider: ${this.provider}`);
    return this.service.generateSummary(
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
   * Generate weekly summary using the configured LLM provider
   */
  async generateWeeklySummary(
    dailySummaries: DailySummaryData[],
    config: SummaryConfig,
    startDate: string,
    endDate: string,
    year: number,
    week: number
  ): Promise<StructuredSummary> {
    console.log(`  Using LLM provider: ${this.provider}`);
    return this.service.generateWeeklySummary(
      dailySummaries,
      config,
      startDate,
      endDate,
      year,
      week
    );
  }

  /**
   * Get the current provider
   */
  getProvider(): LLMProvider {
    return this.provider;
  }
}

/**
 * Factory function to create LLM service with specified provider
 */
export function createLLMService(provider: LLMProvider = 'gemini'): LLMService {
  return new LLMService(provider);
}

/**
 * Create prompt for daily summary generation
 * This is a shared utility function that can be used by different LLM providers
 */
export function createDailyPrompt(
  commits: GitilesCommit[],
  config: SummaryConfig,
  date: string,
  branch: string,
  totalCommitsCount: number,
  relevantCommitsCount: number,
  firstCommit: GitilesCommit,
  lastCommit: GitilesCommit
): string {
  const keywordsText = config.interestingKeywords?.trim() 
    ? `These keywords are of special interest: ${config.interestingKeywords}` 
    : 'No special keywords were provided.';
  
  const focusAreasText = config.focusAreas && config.focusAreas.length > 0
    ? `Focus particularly on these areas: ${config.focusAreas.join(', ')}`
    : '';
  
  const customInstructionsText = config.customInstructions?.trim()
    ? `\n\n**CUSTOM INSTRUCTIONS:**\n${config.customInstructions}\n`
    : '';
  
  const commitDataForPrompt = commits.map(c => {
    const filePaths = c.files && c.files.length > 0
      ? `\nFiles (top ${Math.min(c.files.length, 20)}):\n${c.files.slice(0, 20).map(f => `- ${f}`).join('\n')}`
      : '';
    return `Commit: ${c.commit}\nMessage:\n${c.message}${filePaths}`;
  }).join('\n---\n');

  return `
You are an expert software engineer and technical writer creating a daily summary of changes for the Chromium project. 

**YOUR TASK:**
Based on the commits from ${date} on the '${branch}' branch, generate a structured summary.

**Instructions:**
1.  **Analyze and Categorize:** 
    - Review the commit messages and file paths provided
    - Group commits into logical categories like "Performance", "Security", "Blink Engine", "V8 JavaScript Engine", "UI/UX", "Developer Tools", "Bug Fixes", and "Infrastructure"
    - Skip any categories that have no relevant commits
    
2.  **Generate JSON:** Create a JSON object with this structure:
    *   **title**: "Chromium Digest: YYYY-MM-DD"
    *   **overview**: A short paragraph stating total commits, filtered commits, and the first/last commit links
        Example: "A total of X commits were made to the '${branch}' branch. After filtering, Y relevant commits were analyzed. The day's changes span from commit [short_hash](https://github.com/chromium/chromium/commit/full_hash) to [short_hash](https://github.com/chromium/chromium/commit/full_hash)."
    *   **categories**: Array of category objects with:
        - **title**: Category name
        - **points**: Array of summary points, each with:
          - **text**: Concise summary using markdown. Use \`code\` for file paths. Be specific about what changed.
          - **commits**: Array of full commit hashes this point relates to
          - **isBreaking**: Boolean (optional) - Set to true if this change is BREAKING for projects using Chromium. Breaking changes include: API removals, signature changes, behavior changes that require code updates, removed flags, deprecated features being removed, or changes to public interfaces.
          
3.  **Content Prioritization:**
    *   ${keywordsText}
    *   ${focusAreasText}
    *   **IMPORTANT**: Pay special attention to BREAKING CHANGES - API removals, signature changes, behavioral changes, removed flags, or deprecated features being removed. Mark these with isBreaking: true.
    *   Focus on user-facing changes, significant architectural shifts, and major bug fixes
    *   Synthesize and summarize - don't list every commit separately unless necessary
    ${customInstructionsText}

4.  **Tone:** Professional, informative, and accessible to software engineers.

**Overview Data:**
-   **Total Commits:** ${totalCommitsCount}
-   **Relevant Commits:** ${relevantCommitsCount}
-   **First Commit Hash:** ${firstCommit.commit}
-   **Last Commit Hash:** ${lastCommit.commit}
${config.interestingKeywords ? `-   **Keywords of Interest:** ${config.interestingKeywords}` : ''}
${config.focusAreas && config.focusAreas.length > 0 ? `-   **Focus Areas:** ${config.focusAreas.join(', ')}` : ''}

**Available Commit Data (hash, message, and up to 20 file paths):**
---
${commitDataForPrompt}
---

Provide ONLY a valid JSON object with the structure specified above. No additional text.
  `;
}

/**
 * Create agentic prompt for daily summary generation with tool calling support
 * This is a shared utility function that can be used by different LLM providers
 */
export function createAgenticPrompt(
  commits: GitilesCommit[],
  config: SummaryConfig,
  date: string,
  branch: string,
  totalCommitsCount: number,
  relevantCommitsCount: number,
  firstCommit: GitilesCommit,
  lastCommit: GitilesCommit
): string {
  const keywordsText = config.interestingKeywords?.trim() 
    ? `These keywords are of special interest: ${config.interestingKeywords}` 
    : 'No special keywords were provided.';
  
  const focusAreasText = config.focusAreas && config.focusAreas.length > 0
    ? `Focus particularly on these areas: ${config.focusAreas.join(', ')}`
    : '';
  
  const customInstructionsText = config.customInstructions?.trim()
    ? `\n\n**CUSTOM INSTRUCTIONS:**\n${config.customInstructions}\n`
    : '';
  
  const commitDataForPrompt = commits.map(c => {
    const filePaths = c.files && c.files.length > 0
      ? `\nFiles (top ${Math.min(c.files.length, 20)}):\n${c.files.slice(0, 20).map(f => `- ${f}`).join('\n')}`
      : '';
    return `Commit: ${c.commit}\nMessage:\n${c.message}${filePaths}`;
  }).join('\n---\n');

  return `
You are an expert software engineer and technical writer creating a daily summary of changes for the Chromium project. 

**YOUR TOOLS:**
You have access to a function called "get_commit_details" that allows you to fetch detailed information about any commit, including:
- Full file diffs and patches
- Exact code changes (additions/deletions)
- Complete list of modified files
- Statistics about the changes

**WHEN TO USE THE TOOL:**
- When a commit message is vague or unclear about what actually changed
- When you want to verify what files were actually modified
- When you need to understand the scope or impact of a change
- When grouping commits and want to confirm they're actually related
- When highlighting important changes and need concrete details

**HOW TO USE IT:**
Simply call the function with an array of commit hashes when you need more information. You can request details for multiple commits at once (up to 10). Based on the detailed information, create better, more accurate summaries.

**YOUR TASK:**
Based on the commits from ${date} on the '${branch}' branch, generate a structured summary.

**Instructions:**
1.  **Analyze and Categorize:** 
    - Review the commit messages and file paths provided
    - When needed, use get_commit_details to fetch more information about specific commits
    - Group commits into logical categories like "Performance", "Security", "Blink Engine", "V8 JavaScript Engine", "UI/UX", "Developer Tools", "Bug Fixes", and "Infrastructure"
    - Skip any categories that have no relevant commits
    
2.  **Generate JSON:** Create a JSON object with this structure:
    *   **title**: "Chromium Digest: YYYY-MM-DD"
    *   **overview**: A short paragraph stating total commits, filtered commits, and the first/last commit links
        Example: "A total of X commits were made to the '${branch}' branch. After filtering, Y relevant commits were analyzed. The day's changes span from commit [short_hash](https://github.com/chromium/chromium/commit/full_hash) to [short_hash](https://github.com/chromium/chromium/commit/full_hash)."
    *   **categories**: Array of category objects with:
        - **title**: Category name
        - **points**: Array of summary points, each with:
          - **text**: Concise summary using markdown. Use \`code\` for file paths. Be specific about what changed based on the details you gathered.
          - **commits**: Array of full commit hashes this point relates to
          - **isBreaking**: Boolean (optional) - Set to true if this change is BREAKING for projects using Chromium. Breaking changes include: API removals, signature changes, behavior changes that require code updates, removed flags, deprecated features being removed, or changes to public interfaces.
          
3.  **Content Prioritization:**
    *   ${keywordsText}
    *   ${focusAreasText}
    *   **IMPORTANT**: Pay special attention to BREAKING CHANGES - API removals, signature changes, behavioral changes, removed flags, or deprecated features being removed. Mark these with isBreaking: true. Do not generate explicit "BREAKING CHANGE" in text.
    *   Focus on user-facing changes, significant architectural shifts, and major bug fixes
    *   Synthesize and summarize - don't list every commit separately unless necessary
    *   Use the get_commit_details function to provide accurate, detailed summaries
    ${customInstructionsText}

4.  **Tone:** Professional, informative, and accessible to software engineers.

**Overview Data:**
-   **Total Commits:** ${totalCommitsCount}
-   **Relevant Commits:** ${relevantCommitsCount}
-   **First Commit Hash:** ${firstCommit.commit}
-   **Last Commit Hash:** ${lastCommit.commit}
${config.interestingKeywords ? `-   **Keywords of Interest:** ${config.interestingKeywords}` : ''}
${config.focusAreas && config.focusAreas.length > 0 ? `-   **Focus Areas:** ${config.focusAreas.join(', ')}` : ''}

**Available Commit Data (hash, message, and up to 20 file paths):**
---
${commitDataForPrompt}
---

Start by analyzing the commits. Use get_commit_details when you need more context. Then provide the final JSON object.
  `;
}

/**
 * Create prompt for weekly summary generation
 * This is a shared utility function that can be used by different LLM providers
 */
export function createWeeklyPrompt(
  dailySummaries: DailySummaryData[],
  config: SummaryConfig,
  startDate: string,
  endDate: string,
  year: number,
  week: number
): string {
  // Prepare the daily summaries content
  let dailyContent = '';
  for (const daily of dailySummaries) {
    dailyContent += `\n## ${daily.date} - ${daily.title}\n\n`;
    dailyContent += `Overview: ${daily.overview}\n\n`;
    
    for (const category of daily.categories) {
      dailyContent += `### ${category.title}\n`;
      for (const point of category.points) {
        const breakingPrefix = point.isBreaking ? '[BREAKING] ' : '';
        const commitRefs = point.commits.map(c => `(${c.substring(0, 7)})`).join(' ');
        dailyContent += `- ${breakingPrefix}${point.text} ${commitRefs}\n`;
      }
      dailyContent += '\n';
    }
  }
  
  const totalCommits = dailySummaries.reduce((sum, d) => sum + d.totalCommits, 0);
  const totalRelevantCommits = dailySummaries.reduce((sum, d) => sum + d.relevantCommits, 0);

  return `You are an expert technical writer creating weekly summaries of Chromium development.
You will be given ${dailySummaries.length} daily summaries covering ${startDate} to ${endDate}.

Your task is to create a concise weekly summary that:
1. Highlights the most important changes and breaking changes across the week
2. Groups related changes across multiple days into coherent themes
3. Skips less relevant or minor changes to keep the summary focused
4. Maintains technical accuracy while being accessible

${config.customInstructions ? `Additional instructions: ${config.customInstructions}` : ''}
${config.focusAreas && config.focusAreas.length > 0 ? `Focus areas: ${config.focusAreas.join(', ')}` : ''}

Respond with valid JSON matching this exact structure:
{
  "title": "Chromium Weekly: ${year} Week ${week}",
  "overview": "A brief overview paragraph (2-4 sentences). Mention: ${totalRelevantCommits} relevant commits out of ${totalCommits} total across ${dailySummaries.length} days.",
  "categories": [
    {
      "title": "Category Name",
      "points": [
        {
          "text": "Description. Use **BREAKING CHANGE** prefix if applicable. Use \`code\` for code elements.",
          "isBreaking": boolean,
          "commits": ["full_hash1", "full_hash2"]
        }
      ]
    }
  ]
}

Daily summaries for Week ${week} of ${year}:

${dailyContent}

Create a focused weekly summary highlighting only the most important changes. Skip minor updates and combine related changes across days. Provide ONLY valid JSON, no additional text.`;
}

/**
 * Create prompt for chunk summary generation
 * This generates intermediate plain-text summaries for commit chunks
 */
export function createChunkPrompt(
  commits: GitilesCommit[],
  chunkIndex: number,
  totalChunks: number
): string {
  const commitDataForPrompt = commits.map(c => {
    const filePaths = c.files && c.files.length > 0
      ? `\nFiles (top ${Math.min(c.files.length, 20)}):\n${c.files.slice(0, 20).map(f => `- ${f}`).join('\n')}`
      : '';
    return `Commit: ${c.commit}\nMessage:\n${c.message}${filePaths}`;
  }).join('\n---\n');

  return `
You are analyzing a chunk (${chunkIndex + 1}/${totalChunks}) of Chromium commits.

**YOUR TOOL:**
You can call "get_commit_details" with commit hashes to fetch detailed diffs, patches, and statistics.

**YOUR TASK:**
Create a concise summary of these commits grouped by logical categories (Performance, Security, Blink, V8, UI/UX, Developer Tools, Bug Fixes, Infrastructure, etc.).

For each category, list key changes with:
- What changed (be specific based on commit messages or fetched details)
- Which commits (include full hashes)

**Commits:**
---
${commitDataForPrompt}
---

Provide your summary as plain text, not JSON. Focus on the most important changes.
  `;
}

/**
 * Create prompt for final summary from chunks
 * This synthesizes chunk summaries into the final structured output
 */
export function createFinalSummaryFromChunksPrompt(
  chunkSummaries: string[],
  config: SummaryConfig,
  date: string,
  branch: string,
  totalCommitsCount: number,
  relevantCommitsCount: number,
  firstCommit: GitilesCommit,
  lastCommit: GitilesCommit
): string {
  return `
You are creating a final daily summary for Chromium changes on ${date} (${branch} branch).

Below are pre-analyzed summaries of different parts of the day's commits. Synthesize these into a final structured summary.
Focus on changes that can impact developers working on Chromium-based projects.
Especially look for BREAKING CHANGES or things that require code updates, or allowing improvements to existing code.
${config.customInstructions ? `\n**CUSTOM INSTRUCTIONS:**\n${config.customInstructions}\n` : ''}

**Pre-analyzed Summaries:**
${chunkSummaries.map((s, i) => `\n=== Chunk ${i + 1} ===\n${s}`).join('\n')}

**Overview Data:**
- Total Commits: ${totalCommitsCount}
- Relevant Commits: ${relevantCommitsCount}
- First Commit: ${firstCommit.commit}
- Last Commit: ${lastCommit.commit}
${config.interestingKeywords?.trim() ? `- Keywords of Interest: ${config.interestingKeywords}` : ''}
${config.focusAreas && config.focusAreas.length > 0 ? `- Focus Areas: ${config.focusAreas.join(', ')}` : ''}

Create a structured JSON summary with the standard format (title, overview, categories with points).
`;
}

/**
 * Create final JSON generation prompt
 * This is used after the agentic investigation phase to request the final structured output
 */
export function createFinalJsonPrompt(date: string): string {
  return `Now generate the final summary as a JSON object with this exact structure:
{
  "title": "Chromium Digest: ${date}",
  "overview": "A paragraph with total commits, filtered commits, and links to first/last commits",
  "categories": [
    {
      "title": "Category Name",
      "points": [
        {
          "text": "Summary text with markdown formatting",
          "commits": ["full_commit_hash1", "full_commit_hash2"],
          "isBreaking": true  // ONLY if this is a breaking change for Chromium-based projects
        }
      ]
    }
  ]
}

IMPORTANT: Mark changes as isBreaking: true if they are API removals, signature changes, behavior changes requiring code updates, removed flags, or deprecated features being removed.

Provide ONLY the JSON object, no other text.`;
}

/**
 * Common interface for tool calls across different LLM providers
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Platform adapter interface - each LLM service implements this
 */
export interface PlatformAdapter {
  /**
   * Call the LLM API with messages and optional tools
   * @returns The response content and any tool calls made
   */
  callAPI(
    messages: any[],
    options: {
      systemPrompt?: string;
      enableTools?: boolean;
      requestJson?: boolean;
    }
  ): Promise<{ content: string; toolCalls?: ToolCall[] }>;

  /**
   * Add a message to the conversation history
   */
  addMessage(role: 'user' | 'assistant' | 'tool', content: string, toolCalls?: ToolCall[]): void;

  /**
   * Get the current message history
   */
  getMessages(): any[];

  /**
   * Reset the message history
   */
  resetMessages(): void;
}

/**
 * Execute tool calls and return formatted responses
 */
export async function executeToolCalls(toolCalls: ToolCall[]): Promise<string[]> {
  const responses: string[] = [];

  for (const toolCall of toolCalls) {
    if (toolCall.name === 'get_commit_details') {
      try {
        const args = JSON.parse(toolCall.arguments);
        const commitHashes = args.commit_hashes as string[];
        console.log(`    Fetching details for ${commitHashes.length} commit(s)...`);

        const details = await fetchMultipleCommitDetails(commitHashes, SECRET_GITHUB_TOKEN);
        console.log(`    ✓ Successfully fetched ${details.length} commit detail(s)`);

        const toolResponse = {
          commits: details.map(d => ({
            commit: d.commit,
            message: d.message,
            author: d.author,
            date: d.date,
            files_changed: d.filesChanged,
            additions: d.additions,
            deletions: d.deletions,
            top_files: d.files.slice(0, 10).map(f => ({
              filename: f.filename,
              status: f.status,
              additions: f.additions,
              deletions: f.deletions,
              patch: (f.additions + f.deletions < 50) ? f.patch : undefined,
            })),
          })),
        };

        responses.push(`Tool call result for ${toolCall.name}:\n${JSON.stringify(toolResponse, null, 2)}`);
      } catch (error) {
        console.error(`    ✗ Error fetching commit details:`, error);
        responses.push(`Tool call error for ${toolCall.name}: ${error}`);
      }
    }
  }

  return responses;
}

/**
 * Common generation strategy for all LLM providers
 * Handles chunking, agentic investigation, and final JSON generation
 */
export async function generateSummaryWithStrategy(
  adapter: PlatformAdapter,
  commits: GitilesCommit[],
  config: SummaryConfig,
  date: string,
  branch: string,
  totalCommitsCount: number,
  relevantCommitsCount: number,
  firstCommit: GitilesCommit,
  lastCommit: GitilesCommit
): Promise<StructuredSummary> {
  const MAX_ITERATIONS = 10;
  const CHUNK_THRESHOLD = 300;
  const CHUNK_SIZE = 250;
  const MAX_CHUNK_ITERATIONS = 5;

  adapter.resetMessages();

  // Determine if we need to chunk the commits
  const needsChunking = commits.length > CHUNK_THRESHOLD;

  if (needsChunking) {
    console.log(`  Large commit set detected (${commits.length} commits)`);
    console.log('  Using chunked processing approach...');

    // Split commits into chunks
    const chunks: GitilesCommit[][] = [];
    for (let i = 0; i < commits.length; i += CHUNK_SIZE) {
      chunks.push(commits.slice(i, i + CHUNK_SIZE));
    }

    console.log(`  Processing ${chunks.length} chunk(s) with agentic approach...`);

    // Generate summaries for each chunk with full agentic approach
    const chunkSummaries: string[] = [];
    for (let idx = 0; idx < chunks.length; idx++) {
      console.log(`  Processing chunk ${idx + 1}/${chunks.length} (${chunks[idx].length} commits)...`);
      
      adapter.resetMessages();
      const prompt = createAgenticPrompt(
        chunks[idx],
        config,
        date,
        branch,
        chunks[idx].length,
        chunks[idx].length,
        chunks[idx][0],
        chunks[idx][chunks[idx].length - 1]
      );
      adapter.addMessage('user', prompt);

      // Agentic loop for chunk processing with full tool calling support
      let iteration = 0;
      let chunkComplete = false;
      while (iteration < MAX_ITERATIONS) {
        iteration++;
        console.log(`    Chunk ${idx + 1} - Iteration ${iteration}...`);

        const response = await adapter.callAPI(adapter.getMessages(), {
          systemPrompt: 'You are an expert software engineer and technical writer analyzing Chromium commits.',
          enableTools: true,
          requestJson: false,
        });

        if (response.toolCalls && response.toolCalls.length > 0) {
          console.log(`    AI requested details for ${response.toolCalls.length} tool call(s)`);
          adapter.addMessage('assistant', response.content, response.toolCalls);
          const toolResponses = await executeToolCalls(response.toolCalls);
          for (const toolResponse of toolResponses) {
            adapter.addMessage('tool', toolResponse);
          }
        } else {
          console.log(`    ✓ Chunk ${idx + 1} investigation complete`);
          chunkSummaries.push(response.content);
          chunkComplete = true;
          break;
        }
      }

      if (!chunkComplete) {
        console.warn(`    ⚠ Chunk ${idx + 1} reached max iterations, using partial analysis`);
        // Request a summary of what was analyzed so far
        adapter.addMessage('user', 'Please provide a summary of your analysis so far based on the information you gathered.');
        const partialResponse = await adapter.callAPI(adapter.getMessages(), {
          systemPrompt: 'You are an expert software engineer and technical writer analyzing Chromium commits.',
          enableTools: false,
          requestJson: false,
        });
        chunkSummaries.push(partialResponse.content);
      }
    }

    console.log('  ✓ All chunks processed, conducting final analysis with all chunk summaries...');

    // Create final analysis including all chunk summaries
    adapter.resetMessages();
    const finalPrompt = createFinalSummaryFromChunksPrompt(
      chunkSummaries,
      config,
      date,
      branch,
      totalCommitsCount,
      relevantCommitsCount,
      firstCommit,
      lastCommit
    );
    adapter.addMessage('user', finalPrompt);
  } else {
    console.log('  Starting agentic analysis...');

    const agenticPrompt = createAgenticPrompt(
      commits,
      config,
      date,
      branch,
      totalCommitsCount,
      relevantCommitsCount,
      firstCommit,
      lastCommit
    );
    adapter.addMessage('user', agenticPrompt);

    // Phase 1: Agentic investigation
    let iteration = 0;
    while (iteration < MAX_ITERATIONS) {
      iteration++;
      console.log(`  Iteration ${iteration}...`);

      const response = await adapter.callAPI(adapter.getMessages(), {
        systemPrompt: 'You are an expert software engineer and technical writer creating daily summaries of Chromium project changes.',
        enableTools: true,
        requestJson: false,
      });

      if (response.toolCalls && response.toolCalls.length > 0) {
        console.log(`  AI requested details for ${response.toolCalls.length} tool call(s)`);
        adapter.addMessage('assistant', response.content, response.toolCalls);
        const toolResponses = await executeToolCalls(response.toolCalls);
        for (const toolResponse of toolResponses) {
          adapter.addMessage('tool', toolResponse);
        }
      } else {
        console.log('  ✓ Investigation complete');
        break;
      }
    }
  }

  // Phase 2: Generate final structured JSON
  console.log('  Generating final JSON summary...');
  adapter.addMessage('user', createFinalJsonPrompt(date));

  const finalResponse = await adapter.callAPI(adapter.getMessages(), {
    systemPrompt: 'You are an expert software engineer and technical writer. Generate valid JSON only.',
    enableTools: false,
    requestJson: true,
  });

  console.log('  ✓ Final summary generated');
  return JSON.parse(finalResponse.content) as StructuredSummary;
}
