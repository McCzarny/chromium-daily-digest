export interface GitilesPerson {
  name: string;
  email: string;
  time: string;
}

export interface GitilesCommit {
  commit: string; // hash
  tree: string;
  parents: string[];
  author: GitilesPerson;
  committer: GitilesPerson;
  message: string;
  files?: string[];
}

export interface GitilesLog {
  log: GitilesCommit[];
  next?: string;
}

// Types for the structured summary response from the AI model
export interface SummaryPoint {
  text: string;
  commits: string[]; // Array of commit hashes related to this point
  isBreaking?: boolean; // Flag for breaking changes
}

export interface SummaryCategory {
  title: string;
  points: SummaryPoint[];
}

export interface StructuredSummary {
  title: string;
  overview: string;
  categories: SummaryCategory[];
}

// Configuration types
export interface SummaryConfig {
  // Custom instructions to guide the AI summary generation
  customInstructions?: string;
  
  // Keywords of special interest for the summary
  interestingKeywords?: string;
  
  // Path where the generated HTML pages should be saved
  outputPath?: string;
  
  // Bot email addresses to ignore (in addition to default ones)
  ignoredBotEmails?: string[];
  
  // Focus areas for filtering or emphasizing specific parts
  focusAreas?: string[];
}
