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
    *   **IMPORTANT**: Mark as BREAKING CHANGES (isBreaking: true) ONLY:
        - Removal of stable, public APIs that embedders use
        - Major signature changes to stable public interfaces
        - Significant behavioral changes to stable features requiring embedder code updates
    *   **DO NOT mark as breaking**: Experimental features, internal changes, deprecation warnings, feature flag changes, or changes only affecting outdated implementations
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
 * Create Phase 1 prompt: Find potential breaking changes
 */
export function createPhase1Prompt(
  commits: GitilesCommit[],
  config: SummaryConfig
): string {
  const commitDataForPrompt = commits.map(c => {
    const filePaths = c.files && c.files.length > 0
      ? `\nFiles (top ${Math.min(c.files.length, 20)}):\n${c.files.slice(0, 20).map(f => `- ${f}`).join('\n')}`
      : '';
    return `Commit: ${c.commit}\nMessage:\n${c.message}${filePaths}`;
  }).join('\n---\n');

  return `
You are an expert at identifying MAJOR breaking changes in Chromium commits.

**YOUR TASK:**
Analyze these commits and identify only MAJOR BREAKING CHANGES that would significantly impact production builds using Chromium.

**ONLY mark as breaking if:**
- Public API removals (NOT deprecations, only actual removals)
- Stable API signature changes affecting embedders
- Major behavioral changes to stable features requiring code updates
- Removal of stable, widely-used features
- Changes to core public interfaces used by embedders

**DO NOT mark as breaking:**
- Experimental features (with "Experimental" prefix, behind flags, or in origin trials)
- Internal implementation changes
- Changes to private/internal APIs
- Deprecation warnings (only mark if actually removed)
- Bug fixes that restore correct behavior
- Changes that only affect very old implementations
- Internal refactoring
- Changes to test-only code
- Feature flags being added, removed, or modified (unless it's a stable flag removal)

**YOUR TOOL:**
You have access to "get_commit_details" to fetch full diffs and patches for commits.

**Instructions:**
1. Review commit messages and file paths
2. Identify ONLY commits that look like MAJOR breaking changes to stable, public APIs
3. Use get_commit_details to fetch details for suspicious commits (up to 10 at a time)
4. Based on the details, list the commit hashes that are confirmed MAJOR breaking changes
5. Be conservative - when in doubt, it's NOT a breaking change

${config.focusAreas && config.focusAreas.length > 0 ? `Focus areas: ${config.focusAreas.join(', ')}` : ''}

**Commits:**
---
${commitDataForPrompt}
---

Respond with a list of commit hashes that are potential breaking changes, one per line. If none found, respond with "No potential breaking changes found."
`;
}

/**
 * Create Phase 2 prompt: Analyze and verify breaking changes
 */
export function createPhase2Prompt(
  commits: GitilesCommit[],
  potentialBreakingCommits: string[],
  config: SummaryConfig
): string {
    const customInstructionsText = config.customInstructions?.trim()
    ? `\n\n**CUSTOM INSTRUCTIONS:**\n${config.customInstructions}\n`
    : '';

  return `
You previously identified these commits as potential breaking changes:
${potentialBreakingCommits.map(c => `- ${c}`).join('\n')}

Now:
1. Review the commit details you fetched
2. Determine which are CONFIRMED MAJOR breaking changes
3. Apply strict criteria: Only confirm if it's a significant change to stable public APIs that production embedders rely on
4. Provide a brief summary of ALL commits (not just breaking ones)
5. If there are custom instructions, follow them carefully ignoring changes out of the interest scope.
6. Ignore major changes like transparent type changes like 'const std::string&' to 'std::string_view' or container references to 'std::span'.

**Remember:** Be conservative. Exclude:
- Experimental features
- Internal changes
- Changes only affecting old/outdated code
- Deprecations (only removals count)
- Feature flags

${customInstructionsText}

Format your response as:

**CONFIRMED BREAKING CHANGES:**
- commit_hash: Brief reason why it's a MAJOR breaking change to stable public APIs
(Or "None" if no major breaking changes confirmed)

**GENERAL SUMMARY:**
Brief overview of all commits analyzed, grouped by logical categories.
`;
}

/**
 * Create Phase 3 prompt: Pick commits needing more context
 */
export function createPhase3Prompt(
  commits: GitilesCommit[]
): string {
  return `
Based on your previous analysis, identify commits that need more detailed information to write an accurate summary.

Look for commits where:
- The message is vague or unclear
- The scope of changes is uncertain
- You want to verify technical details
- The commit seems important but lacks details

List the commit hashes you want to investigate further (up to 10), one per line.
If no additional details needed, respond with "No additional details needed."
`;
}

/**
 * Create Phase 4 prompt: Summarize with details
 */
export function createPhase4Prompt(): string {
  return `
Now that you have all the commit details you requested, create a comprehensive summary of all commits.

Group them by logical categories (Performance, Security, Blink, V8, UI/UX, Developer Tools, Bug Fixes, Infrastructure, etc.).

For each category, provide:
- Key changes (be specific using the details you gathered)
- Which commits are involved (include full hashes)
- Mark any breaking changes

Provide your summary as structured text.
`;
}

/**
 * Create Phase 5 prompt: Write general summary
 */
export function createPhase5Prompt(
  config: SummaryConfig
): string {
  const customInstructionsText = config.customInstructions?.trim()
    ? `\n\n**CUSTOM INSTRUCTIONS:**\n${config.customInstructions}\n`
    : '';
  
  return `
Using all the information from your previous analysis:
1. The confirmed breaking changes
2. The detailed summaries of commits
3. All commit details you gathered

Create a final, polished summary organized by categories.

For each category:
- Synthesize related changes together
- Be specific and technical
- Highlight breaking changes clearly
- Include relevant commit hashes
${customInstructionsText}

Provide your final summary as well-organized text.
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
    *   **IMPORTANT**: Mark as BREAKING CHANGES (isBreaking: true) ONLY when:
        - Stable, public API is removed (not deprecated, actually removed)
        - Major signature change to stable public interface used by embedders
        - Significant behavioral change to stable feature requiring embedder code updates
    *   **DO NOT mark as breaking**: Experimental features, internal APIs, deprecation warnings, feature flags, internal refactoring, or changes only affecting very old code
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
          "isBreaking": true  // ONLY for MAJOR breaking changes to stable public APIs
        }
      ]
    }
  ]
}

IMPORTANT: Mark as isBreaking: true ONLY for:
- Removal of stable public APIs (not deprecation)
- Major signature changes to stable public interfaces
- Significant behavioral changes to stable features requiring embedder code updates

DO NOT mark as breaking: experimental features, internal changes, deprecations, feature flags, or minor compatibility issues.

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
 * Execute the phased analysis approach
 */
async function executePhasedAnalysis(
  adapter: PlatformAdapter,
  commits: GitilesCommit[],
  config: SummaryConfig,
  chunkIndex?: number,
  totalChunks?: number
): Promise<string> {
  const chunkPrefix = chunkIndex !== undefined ? `Chunk ${chunkIndex + 1}/${totalChunks} - ` : '';
  
  // Phase 1: Find potential breaking changes
  console.log(`  ${chunkPrefix}Phase 1: Finding potential breaking changes...`);
  adapter.resetMessages();
  adapter.addMessage('user', createPhase1Prompt(commits, config));
  
  let response = await adapter.callAPI(adapter.getMessages(), {
    systemPrompt: 'You are an expert at identifying breaking changes in Chromium commits.',
    enableTools: true,
    requestJson: false,
  });
  
  // Allow tool calls for Phase 1
  let iteration = 0;
  while (response.toolCalls && response.toolCalls.length > 0 && iteration < 5) {
    iteration++;
    console.log(`    ${chunkPrefix}Phase 1 - Fetching details (iteration ${iteration})...`);
    adapter.addMessage('assistant', response.content, response.toolCalls);
    const toolResponses = await executeToolCalls(response.toolCalls);
    for (const toolResponse of toolResponses) {
      adapter.addMessage('tool', toolResponse);
    }
    response = await adapter.callAPI(adapter.getMessages(), {
      systemPrompt: 'You are an expert at identifying breaking changes in Chromium commits.',
      enableTools: true,
      requestJson: false,
    });
  }
  
  const potentialBreakingCommits = response.content
    .split('\n')
    .filter(line => line.trim() && !line.toLowerCase().includes('no potential'))
    .map(line => line.replace(/^[\s\-\*]+/, '').trim())
    .filter(line => /^[a-f0-9]{40}$/i.test(line));
  
  console.log(`    ${chunkPrefix}✓ Found ${potentialBreakingCommits.length} potential breaking change(s)`);
  
  // Phase 2: Analyze and verify breaking changes
  console.log(`  ${chunkPrefix}Phase 2: Analyzing and verifying commits...`);
  adapter.addMessage('user', createPhase2Prompt(commits, potentialBreakingCommits, config));
  
  response = await adapter.callAPI(adapter.getMessages(), {
    systemPrompt: 'You are an expert software engineer analyzing Chromium commits.',
    enableTools: false,
    requestJson: false,
  });
  
  console.log(`    ${chunkPrefix}✓ Analysis complete`);
  
  // Phase 3: Pick commits needing more context
  console.log(`  ${chunkPrefix}Phase 3: Identifying commits needing more context...`);
  adapter.addMessage('user', createPhase3Prompt(commits));
  
  response = await adapter.callAPI(adapter.getMessages(), {
    systemPrompt: 'You are an expert software engineer analyzing Chromium commits.',
    enableTools: true,
    requestJson: false,
  });
  
  // Allow tool calls for Phase 3
  iteration = 0;
  while (response.toolCalls && response.toolCalls.length > 0 && iteration < 5) {
    iteration++;
    console.log(`    ${chunkPrefix}Phase 3 - Fetching additional details (iteration ${iteration})...`);
    adapter.addMessage('assistant', response.content, response.toolCalls);
    const toolResponses = await executeToolCalls(response.toolCalls);
    for (const toolResponse of toolResponses) {
      adapter.addMessage('tool', toolResponse);
    }
    response = await adapter.callAPI(adapter.getMessages(), {
      systemPrompt: 'You are an expert software engineer analyzing Chromium commits.',
      enableTools: true,
      requestJson: false,
    });
  }
  
  console.log(`    ${chunkPrefix}✓ Context gathering complete`);
  
  // Phase 4: Summarize with details
  console.log(`  ${chunkPrefix}Phase 4: Creating detailed summary...`);
  adapter.addMessage('user', createPhase4Prompt());
  
  response = await adapter.callAPI(adapter.getMessages(), {
    systemPrompt: 'You are an expert software engineer creating technical summaries.',
    enableTools: false,
    requestJson: false,
  });
  
  console.log(`    ${chunkPrefix}✓ Detailed summary created`);
  
  // Phase 5: Write general summary
  console.log(`  ${chunkPrefix}Phase 5: Writing final summary...`);
  adapter.addMessage('user', createPhase5Prompt(config));
  
  response = await adapter.callAPI(adapter.getMessages(), {
    systemPrompt: 'You are an expert technical writer creating polished summaries.',
    enableTools: false,
    requestJson: false,
  });
  
  console.log(`    ${chunkPrefix}✓ Final summary complete`);
  
  return response.content;
}

/**
 * Common generation strategy for all LLM providers
 * Handles chunking, phased analysis, and final JSON generation
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
  const CHUNK_THRESHOLD = 300;
  const CHUNK_SIZE = 250;

  adapter.resetMessages();

  // Determine if we need to chunk the commits (Phase 0)
  const needsChunking = commits.length > CHUNK_THRESHOLD;

  if (needsChunking) {
    console.log(`  Phase 0: Large commit set detected (${commits.length} commits)`);
    console.log('  Using chunked processing approach...');

    // Split commits into chunks
    const chunks: GitilesCommit[][] = [];
    for (let i = 0; i < commits.length; i += CHUNK_SIZE) {
      chunks.push(commits.slice(i, i + CHUNK_SIZE));
    }

    console.log(`  Processing ${chunks.length} chunk(s) with phased approach...`);

    // Execute phased analysis for each chunk
    const chunkSummaries: string[] = [];
    for (let idx = 0; idx < chunks.length; idx++) {
      console.log(`\n  === Processing chunk ${idx + 1}/${chunks.length} (${chunks[idx].length} commits) ===`);
      const summary = await executePhasedAnalysis(adapter, chunks[idx], config, idx, chunks.length);
      chunkSummaries.push(summary);
    }

    console.log('\n  Phase 6: Synthesizing all chunk summaries into final JSON...');

    // Phase 6: Use all summaries to generate final JSON
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
    console.log('  Executing phased analysis...');
    
    // Execute all 5 phases for the full commit set
    const summary = await executePhasedAnalysis(adapter, commits, config);
    
    // Phase 6: Generate final JSON from the complete analysis
    console.log('\n  Phase 6: Generating final JSON from analysis...');
    // The conversation history is already maintained in the adapter
  }

  // Final step: Generate structured JSON output
  adapter.addMessage('user', createFinalJsonPrompt(date));

  const finalResponse = await adapter.callAPI(adapter.getMessages(), {
    systemPrompt: 'You are an expert software engineer and technical writer. Generate valid JSON only.',
    enableTools: false,
    requestJson: true,
  });

  console.log('  ✓ Final JSON summary generated');
  return JSON.parse(finalResponse.content) as StructuredSummary;
}
