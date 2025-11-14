import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { GitilesCommit, StructuredSummary, SummaryConfig } from "../types";
import { fetchMultipleCommitDetails } from "./commitDetailService";

const SECRET_GEMINI_API_KEY = process.env.SECRET_GEMINI_API_KEY;
const SECRET_GITHUB_TOKEN = process.env.SECRET_GITHUB_TOKEN;

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

function createAgenticPrompt(
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
 * Generates intermediate summaries for a chunk of commits
 */
async function generateChunkSummary(
  commits: GitilesCommit[],
  chunkIndex: number,
  totalChunks: number
): Promise<string> {
  const MAX_ITERATIONS = 5;
  
  const commitDataForPrompt = commits.map(c => {
    const filePaths = c.files && c.files.length > 0
      ? `\nFiles (top ${Math.min(c.files.length, 15)}):\n${c.files.slice(0, 15).map(f => `- ${f}`).join('\n')}`
      : '';
    return `Commit: ${c.commit}\nMessage:\n${c.message}${filePaths}`;
  }).join('\n---\n');

  const prompt = `
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

  let iteration = 0;
  let chatHistory: any[] = [{ role: "user", parts: [{ text: prompt }] }];
  
  while (iteration < MAX_ITERATIONS) {
    iteration++;
    
    const response = await generateContentWithRetry(
      chatHistory,
      {
        tools: [{
          functionDeclarations: [getCommitDetailsTool],
        }],
      },
      `chunk ${chunkIndex + 1} iteration ${iteration}`
    );
    
    chatHistory.push({ 
      role: "model", 
      parts: response.candidates?.[0]?.content?.parts || []
    });
    
    const functionCalls = response.functionCalls;
    
    if (functionCalls && functionCalls.length > 0) {
      const functionResponses = await Promise.all(
        functionCalls.map(async (call) => {
          if (call.name === "get_commit_details") {
            const commitHashes = call.args.commit_hashes as string[];
            try {
              const details = await fetchMultipleCommitDetails(commitHashes, SECRET_GITHUB_TOKEN);
              return {
                name: call.name,
                response: {
                  commits: details.map(d => ({
                    commit: d.commit,
                    message: d.message,
                    files_changed: d.filesChanged,
                    additions: d.additions,
                    deletions: d.deletions,
                    top_files: d.files.slice(0, 8).map(f => ({
                      filename: f.filename,
                      status: f.status,
                      additions: f.additions,
                      deletions: f.deletions,
                    })),
                  })),
                },
              };
            } catch (error) {
              return {
                name: call.name,
                response: { error: `Failed to fetch: ${error}` },
              };
            }
          }
          return { name: call.name, response: { error: "Unknown function" } };
        })
      );
      
      chatHistory.push({
        role: "user",
        parts: functionResponses.map(fr => ({ functionResponse: fr })),
      });
    } else {
      return response.text.trim();
    }
  }
  
  throw new Error('Max iterations reached in chunk summary');
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
  const MAX_ITERATIONS = 10;
  
  // Determine if we need to chunk the commits
  const needsChunking = commits.length > 300; // If more than 300 commits, use chunking
  
  let summaryInput: string;
  if (needsChunking) {
    console.log(`  Large commit set detected (${commits.length} commits)`);
    console.log('  Using chunked processing approach...');
    
    // Split commits into chunks
    const chunkSize = 250;
    const chunks: GitilesCommit[][] = [];
    for (let i = 0; i < commits.length; i += chunkSize) {
      chunks.push(commits.slice(i, i + chunkSize));
    }
        
    console.log(`  Processing ${chunks.length} chunk(s)...`);
    
    // Generate summaries for each chunk sequentially
    // to avoid hitting rate limits
    const chunkSummaries: string[] = [];
    for (let idx = 0; idx < chunks.length; idx++) {
      console.log(`  Processing chunk ${idx + 1}/${chunks.length} (${chunks[idx].length} commits)...`);
      const summary = await generateChunkSummary(chunks[idx], idx, chunks.length);
      chunkSummaries.push(summary);
    }
    
    console.log('  ✓ All chunks processed, creating final summary...');
    
    // Combine chunk summaries into input for final summary
    summaryInput = `
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
`;
  } else {
    console.log('  Starting agentic analysis...');
    summaryInput = createAgenticPrompt(
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
  
  let iteration = 0;
  let continueLoop = true;
  let chatHistory: any[] = [{ role: "user", parts: [{ text: summaryInput }] }];
      
  // Phase 1: Agentic investigation (only if not chunked)
  if (!needsChunking) {
    while (continueLoop && iteration < MAX_ITERATIONS) {
      iteration++;
      console.log(`  Iteration ${iteration}...`);
      
      const response = await generateContentWithRetry(
        chatHistory,
        {
          tools: [{
            functionDeclarations: [getCommitDetailsTool],
          }],
        },
        `investigation iteration ${iteration}`
      );
      
      // Add AI response to history
      chatHistory.push({ 
        role: "model", 
        parts: response.candidates?.[0]?.content?.parts || []
      });
      
      // Check if AI made function calls
      const functionCalls = response.functionCalls;
      
      if (functionCalls && functionCalls.length > 0) {
        console.log(`  AI requested details for ${functionCalls.length} function call(s)`);
        
        // Execute all function calls
        const functionResponses = await Promise.all(
          functionCalls.map(async (call) => {
            if (call.name === "get_commit_details") {
              const commitHashes = call.args.commit_hashes as string[];
              console.log(`    Fetching details for ${commitHashes.length} commit(s)...`);
              
              try {
                const details = await fetchMultipleCommitDetails(commitHashes, SECRET_GITHUB_TOKEN);
                console.log(`    ✓ Successfully fetched ${details.length} commit detail(s)`);
                
                return {
                  name: call.name,
                  response: {
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
                  },
                };
              } catch (error) {
                console.error(`    ✗ Error fetching commit details:`, error);
                return {
                  name: call.name,
                  response: {
                    error: `Failed to fetch commit details: ${error}`,
                  },
                };
              }
            }
            
            return {
              name: call.name,
              response: { error: "Unknown function" },
            };
          })
        );
        
        // Add function responses to history
        chatHistory.push({
          role: "user",
          parts: functionResponses.map(fr => ({
            functionResponse: fr,
          })),
        });
      } else {
        // No function calls, AI is done investigating
        console.log('  ✓ Investigation complete');
        break;
      }
    }
  }
      
  // Phase 2: Generate final structured JSON
  console.log('  Generating final JSON summary...');
  chatHistory.push({
    role: "user",
    parts: [{
      text: `Now generate the final summary as a JSON object with this exact structure:
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

Provide ONLY the JSON object, no other text.`
    }]
  });
  
  const finalResponse = await generateContentWithRetry(
    chatHistory,
    {
      responseMimeType: "application/json",
      responseSchema: {
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
      }
    },
    'final JSON generation'
  );
  
  const jsonText = finalResponse.text.trim();
  console.log('  ✓ Final summary generated');
  return JSON.parse(jsonText) as StructuredSummary;
}

/**
 * Daily summary data for weekly aggregation
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
  
  const systemPrompt = `You are an expert technical writer creating weekly summaries of Chromium development.
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
}`;

  const userPrompt = `Daily summaries for Week ${week} of ${year}:

${dailyContent}

Create a focused weekly summary highlighting only the most important changes. Skip minor updates and combine related changes across days.`;

  try {
    const response = await generateContentWithRetry(
      [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: 'I understand. I will create a focused weekly summary in JSON format.' }] },
        { role: 'user', parts: [{ text: userPrompt }] }
      ],
      {
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: {
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
        }
      },
      `weekly summary ${year}-W${week}`
    );

    const jsonText = response.text.trim();
    const summary = JSON.parse(jsonText) as StructuredSummary;
    console.log(`  ✓ Weekly summary generated with ${summary.categories.length} categories`);
    
    return summary;
  } catch (error) {
    console.error('Failed to generate weekly summary:', error);
    throw error;
  }
}
