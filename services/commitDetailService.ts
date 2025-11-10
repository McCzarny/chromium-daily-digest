import { GitilesCommit } from '../types';

const API_BASE_URL = 'https://api.github.com/repos/chromium/chromium/commits';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

interface GitHubDetailedCommit {
  sha: string;
  commit: {
    author: { name: string | null; email: string | null; date: string | null; };
    committer: { name: string | null; email: string | null; date: string | null; };
    message: string;
    tree: { sha: string; };
  };
  parents: { sha: string; }[];
  files: { filename: string; status: string; additions: number; deletions: number; changes: number; patch?: string; }[];
  stats: {
    additions: number;
    deletions: number;
    total: number;
  };
}

/**
 * A utility to fetch with a simple retry mechanism for rate limiting.
 */
async function fetchWithRetry(url: string, token?: string, retries = MAX_RETRIES): Promise<Response> {
  const headers: HeadersInit = {
    'Accept': 'application/vnd.github.v3+json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  for (let i = 0; i < retries; i++) {
    const response = await fetch(url, { headers });
    if (response.ok) {
      return response;
    }
    // Retry on rate limit errors
    if (response.status === 403 || response.status === 429) {
      console.warn(`Rate limit detected. Retrying in ${RETRY_DELAY_MS / 1000}s... (${i + 1}/${retries})`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (i + 1))); 
      continue;
    }
    return response; 
  }
  throw new Error(`Failed to fetch from ${url} after ${retries} attempts.`);
}

/**
 * Fetches detailed information about a specific commit including full diff patches.
 * This is designed to be called by the AI agent when it needs more context about a commit.
 * 
 * @param commitHash - The full commit hash
 * @param githubToken - Optional GitHub personal access token
 * @returns Detailed commit information including file changes, additions, deletions, and patches
 */
export async function fetchCommitDetail(commitHash: string, githubToken?: string): Promise<{
  commit: string;
  message: string;
  author: string;
  date: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
  }>;
}> {
  try {
    const url = `${API_BASE_URL}/${commitHash}`;
    const response = await fetchWithRetry(url, githubToken);
    
    if (!response.ok) {
      let errorMsg = `Failed to fetch details for commit ${commitHash}. Status: ${response.status}`;
      try {
        const body = await response.json();
        errorMsg += ` - ${body.message || 'No additional details.'}`;
      } catch (e) {}
      throw new Error(errorMsg);
    }
    
    const data: GitHubDetailedCommit = await response.json();
    
    return {
      commit: data.sha,
      message: data.commit.message,
      author: data.commit.author?.name ?? 'Unknown',
      date: data.commit.author?.date ?? '',
      filesChanged: data.files?.length ?? 0,
      additions: data.stats?.additions ?? 0,
      deletions: data.stats?.deletions ?? 0,
      files: (data.files || []).map(f => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        patch: f.patch, // This contains the actual diff
      })),
    };
  } catch (error) {
    console.error(`Error fetching commit detail for ${commitHash}:`, error);
    throw error;
  }
}

/**
 * Fetches details for multiple commits concurrently (with a reasonable limit).
 * Used when the agent requests multiple commit details at once.
 */
export async function fetchMultipleCommitDetails(
  commitHashes: string[],
  githubToken?: string
): Promise<Array<{
  commit: string;
  message: string;
  author: string;
  date: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
  }>;
}>> {
  // Limit to 5 concurrent requests to avoid rate limiting
  const BATCH_SIZE = 5;
  const results = [];
  
  for (let i = 0; i < commitHashes.length; i += BATCH_SIZE) {
    const batch = commitHashes.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(hash => fetchCommitDetail(hash, githubToken))
    );
    results.push(...batchResults);
    
    // Small delay between batches
    if (i + BATCH_SIZE < commitHashes.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  return results;
}
