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
