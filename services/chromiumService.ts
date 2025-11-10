import { GitilesCommit } from '../types';

const API_BASE_URL = 'https://api.github.com/repos/chromium/chromium/commits';
const MAX_PAGES = 3; // Fetch up to 3 pages of commits (300 total)
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 1000;

// A minimal type for the commit list API response.
interface GitHubCommitListItem {
  sha: string;
}

// A more detailed type for the single commit API response.
interface GitHubDetailedCommit {
  sha: string;
  commit: {
    author: { name: string | null; email: string | null; date: string | null; };
    committer: { name: string | null; email: string | null; date: string | null; };
    message: string;
    tree: { sha: string; };
  };
  parents: { sha: string; }[];
  files: { filename: string; }[];
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
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (i + 1))); // simple backoff
      continue;
    }
    // For other errors, fail immediately
    return response; 
  }
  throw new Error(`Failed to fetch from ${url} after ${retries} attempts.`);
}

/**
 * Fetches commits for a specific date from the Chromium GitHub mirror, including changed files.
 * @param date - The date in 'YYYY-MM-DD' format.
 * @param branch - The branch or tag to query.
 * @param githubToken - Optional GitHub personal access token to avoid rate limits.
 * @returns A promise that resolves to an array of commit objects.
 */
export async function fetchCommitsForDate(date: string, branch: string, githubToken?: string): Promise<GitilesCommit[]> {
  const since = `${date}T00:00:00Z`;
  const until = `${date}T23:59:59Z`;
  
  let allCommitShas: string[] = [];
  let page = 1;

  try {
    console.log(`  Fetching commit list for ${date}...`);
    // Stage 1: Fetch all commit SHAs for the given day.
    while (page <= MAX_PAGES) {
      const url = new URL(API_BASE_URL);
      url.searchParams.append('sha', branch);
      url.searchParams.append('since', since);
      url.searchParams.append('until', until);
      url.searchParams.append('per_page', '100');
      url.searchParams.append('page', page.toString());

      console.log(`  Fetching page ${page}...`);
      const response = await fetchWithRetry(url.toString(), githubToken);
      
      if (!response.ok) {
        console.log(response)
        let errorMsg = `Failed to fetch commits from GitHub. Status: ${response.status}`;
        try {
          const body = await response.json();
          errorMsg += ` - ${body.message || 'No additional details.'}`;
        } catch (e) {}
        console.error(errorMsg);
        throw new Error(errorMsg);
      }

      const commitsOnPage: GitHubCommitListItem[] = await response.json();
      
      if (commitsOnPage.length === 0) {
        break; // No more commits for this day
      }

      allCommitShas = allCommitShas.concat(commitsOnPage.map(c => c.sha));
      
      if (commitsOnPage.length < 100) {
        break;
      }

      page++;
    }

    if (allCommitShas.length === 0) {
        console.log('  No commits found for this date');
        return [];
    }

    console.log(`  Found ${allCommitShas.length} commit(s), fetching details...`);
    // Stage 2: Fetch detailed information for each commit concurrently.
    const detailPromises = allCommitShas.map(sha =>
      fetchWithRetry(`${API_BASE_URL}/${sha}`, githubToken).then(async res => {
        if (!res.ok) {
          let errorMsg = `Failed to fetch details for commit ${sha}. Status: ${res.status}`;
           try {
              const body = await res.json();
              errorMsg += ` - ${body.message || 'No additional details.'}`;
            } catch (e) {}
          console.warn(errorMsg);
          return null; // Return null on failure to avoid crashing the whole process
        }
        return res.json() as Promise<GitHubDetailedCommit>;
      })
    );
    
    const detailedCommitsResults = await Promise.all(detailPromises);
    const successfulDetailedCommits = detailedCommitsResults.filter((c): c is GitHubDetailedCommit => c !== null);
    
    const failedCount = detailedCommitsResults.length - successfulDetailedCommits.length;
    if (failedCount > 0) {
      console.warn(`  Warning: Failed to fetch details for ${failedCount} commit(s)`);
    }
    console.log(`  Successfully fetched details for ${successfulDetailedCommits.length} commit(s)`);

    // Stage 3: Map the detailed responses to our internal GitilesCommit type.
    const allCommits: GitilesCommit[] = successfulDetailedCommits.map(ghCommit => ({
      commit: ghCommit.sha,
      tree: ghCommit.commit.tree.sha,
      parents: ghCommit.parents.map(p => p.sha),
      author: {
        name: ghCommit.commit.author?.name ?? 'Unknown Author',
        email: ghCommit.commit.author?.email ?? '',
        time: ghCommit.commit.author?.date ?? '',
      },
      committer: {
        name: ghCommit.commit.committer?.name ?? 'Unknown Committer',
        email: ghCommit.commit.committer?.email ?? '',
        time: ghCommit.commit.committer?.date ?? '',
      },
      message: ghCommit.commit.message,
      files: ghCommit.files?.map(f => f.filename).slice(0, 50) || [],
    }));
    
    // The API returns commits in reverse chronological order (newest first), which is what we want.
    return allCommits;

  } catch (error) {
    console.error('Error fetching Chromium commits:', error);
    if (error instanceof Error) {
        throw new Error(`Could not fetch data from the GitHub API. Check branch name, network connection, or for API rate limits. Original error: ${error.message}`);
    }
    throw new Error('An unknown error occurred while fetching data from the GitHub API.');
  }
}
