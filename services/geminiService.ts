import { GoogleGenAI, Type } from "@google/genai";
import { GitilesCommit, StructuredSummary } from "../types";

const SECRET_GEMINI_API_KEY = process.env.SECRET_GEMINI_API_KEY;

if (!SECRET_GEMINI_API_KEY) {
  throw new Error("SECRET_GEMINI_API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: SECRET_GEMINI_API_KEY });
const model = "gemini-2.5-pro";

function createPrompt(
  commits: GitilesCommit[], 
  interestingKeywords: string, 
  date: string, 
  branch: string,
  totalCommitsCount: number,
  relevantCommitsCount: number,
  firstCommit: GitilesCommit,
  lastCommit: GitilesCommit
): string {
  const keywordsText = interestingKeywords.trim() ? `These keywords are of special interest: ${interestingKeywords}` : 'No special keywords were provided.';
  
  const commitDataForPrompt = commits.map(c => {
    const filePaths = c.files && c.files.length > 0
      ? `\nFiles:\n${c.files.map(f => `- ${f}`).join('\n')}`
      : '';
    return `Commit: ${c.commit}\nMessage:\n${c.message}${filePaths}`;
  }).join('\n---\n');

  return `
You are an expert software engineer and technical writer creating a daily summary of changes for the Chromium project. Your output will be a structured JSON object.

Based on the following data and list of commits from ${date} on the '${branch}' branch, generate a summary.

**Instructions:**
1.  **Analyze and Categorize:** Group the commits into logical categories like "Performance", "Security", "Blink Engine", "V8 JavaScript Engine", "UI/UX", "Developer Tools", "Bug Fixes", and "Infrastructure". Skip any categories that have no relevant commits.
2.  **Generate JSON:** Create a JSON object matching the provided schema.
    *   **title**: Create a main title in the format "Chromium Digest: YYYY-MM-DD".
    *   **overview**: Write a short paragraph stating the total number of commits for the day and how many remain after filtering. Mention the first and last commit links. Use the data provided in the 'Overview Data' section. For example: "A total of X commits were made to the '${branch}' branch. After filtering, Y relevant commits were analyzed. The day's changes span from commit [short_hash](link) to [short_hash](link)."
    *   **categories**: Create an array of category objects.
    *   **categories.title**: The name of the category (e.g., "Performance").
    *   **categories.points**: An array of summary points for that category.
    *   **categories.points.text**: A concise summary of a commit or group of related commits. If relevant, mention key files or directories affected. Use markdown for formatting, like \`code\` for file paths.
    *   **categories.points.commits**: An array of full commit hashes that this summary point relates to.
3.  **Content Prioritization:**
    *   **Highlight:** Pay special attention to commits related to the following. ${keywordsText}
    *   **Summarize:** You don't need to list every single commit. Synthesize and summarize. Focus on user-facing changes, significant architectural shifts, and major bug fixes.
4.  **Tone:** The tone should be professional, informative, and accessible to other software engineers.

**Overview Data:**
-   **Total Commits:** ${totalCommitsCount}
-   **Relevant Commits:** ${relevantCommitsCount}
-   **First Commit Hash (oldest):** ${firstCommit.commit}
-   **Last Commit Hash (newest):** ${lastCommit.commit}

**Commit Data (commit hash, message, and changed files, separated by '---'):**
---
${commitDataForPrompt}
---

Provide only the JSON object.
  `;
}

export async function generateSummary(
  commits: GitilesCommit[],
  interestingKeywords: string,
  date: string,
  branch: string,
  totalCommitsCount: number,
  relevantCommitsCount: number,
  firstCommit: GitilesCommit,
  lastCommit: GitilesCommit
): Promise<StructuredSummary> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 60000; // 1 minute
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const prompt = createPrompt(commits, interestingKeywords, date, branch, totalCommitsCount, relevantCommitsCount, firstCommit, lastCommit);
      
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
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
                          }
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
        }
      });
      
      const jsonString = response.text.trim();
      return JSON.parse(jsonString) as StructuredSummary;

    } catch (error: any) {
      const isRateLimitError = error?.message?.toLowerCase().includes('rate limit') || 
                               error?.message?.toLowerCase().includes('quota') ||
                               error?.message?.toLowerCase().includes('429') ||
                               error?.status === 429;
      
      if (isRateLimitError && attempt < MAX_RETRIES) {
        console.warn(`\n⚠️  RATE LIMIT ERROR (Attempt ${attempt}/${MAX_RETRIES})`);
        console.warn(`Error details: ${error?.message || error}`);
        console.warn(`Waiting ${RETRY_DELAY_MS / 1000} seconds before retry...`);
        console.warn(`Next attempt will be ${attempt + 1}/${MAX_RETRIES}\n`);
        
        // Log progress during wait
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
        process.stdout.write('\r✓ Wait complete, retrying now...\n\n');
        continue;
      }
      
      console.error("Error generating summary with Gemini API:", error);
      if (attempt === MAX_RETRIES) {
        throw new Error(`Failed to generate summary after ${MAX_RETRIES} attempts. The AI service may be rate-limited or unavailable. Last error: ${error?.message || error}`);
      }
      throw new Error("Failed to generate summary. The AI service may be unavailable or returned an invalid format.");
    }
  }
  
  throw new Error("Failed to generate summary after all retry attempts.");
}
