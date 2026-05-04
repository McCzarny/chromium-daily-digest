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

/**
 * Stable list of Chromium component tags.
 * Keep this list stable so the AI can assign consistent tags across summaries.
 */
export const CHROMIUM_COMPONENTS = [
"AI",
"Accessibility",
"Android",
"Ash",
"Autofill",
"Banner",
"Base",
"Blink",
"Bluetooth",
"Bookmarks",
"Browser",
"Build",
"CSS",
"ChromeOS",
"Compositor",
"Crypto",
"DevTools",
"Downloads",
"Enterprise",
"Extensions",
"Fonts",
"GPU",
"HTML",
"History",
"I18n",
"Infra",
"iOS",
"Linux",
"macOS",
"Media",
"Navigation",
"Network",
"Notifications",
"PDF",
"PasswordManager",
"Payments",
"Performance",
"Policy",
"Printing",
"Privacy",
"Profiles",
"SSL",
"Security",
"ServiceWorker",
"Storage",
"Sync",
"Tabs",
"Testing",
"Themes",
"UI",
"USB",
"Updater",
"V8",
"WebAssembly",
"WebGL",
"WebGPU",
"WebRTC",
"Windows",
"XR"
] as const;

export type ChromiumComponent = typeof CHROMIUM_COMPONENTS[number];

// Types for the structured summary response from the AI model
export interface SummaryPoint {
  text: string;
  commits: string[]; // Array of commit hashes related to this point
  isBreaking?: boolean; // Flag for breaking changes
  components?: ChromiumComponent[]; // Chromium component tags
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
  
  // LLM provider to use for summary generation (default: 'nexos')
  llmProvider?: 'gemini' | 'openai' | 'anthropic' | 'nexos';
}
