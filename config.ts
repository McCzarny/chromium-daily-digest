import { SummaryConfig } from './types';
import fs from 'fs/promises';
import path from 'path';

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: SummaryConfig = {
  customInstructions: '',
  interestingKeywords: '',
  outputPath: '', // Subpath within public/summaries (empty = root)
  ignoredBotEmails: [],
  focusAreas: [],
  llmProvider: 'gemini', // Default LLM provider
};

/**
 * Valid LLM providers that can be selected via config or the LLM_PROVIDER env variable
 */
export const VALID_LLM_PROVIDERS = ['gemini', 'openai', 'anthropic', 'nexos', 'opencode'] as const;

/**
 * Apply environment variable overrides on top of a loaded configuration.
 * Currently supports:
 * - LLM_PROVIDER: overrides the configured llmProvider
 */
export function applyEnvOverrides(config: SummaryConfig): SummaryConfig {
  const envProvider = process.env.LLM_PROVIDER?.trim();
  if (envProvider) {
    if (!(VALID_LLM_PROVIDERS as readonly string[]).includes(envProvider)) {
      throw new Error(
        `Invalid LLM_PROVIDER "${envProvider}". Valid values: ${VALID_LLM_PROVIDERS.join(', ')}`
      );
    }
    config.llmProvider = envProvider as SummaryConfig['llmProvider'];
  }
  return config;
}

/**
 * Default bot emails to ignore
 */
export const DEFAULT_IGNORED_BOT_EMAILS = [
  'bling-autoroll-builder@chops-service-accounts.iam.gserviceaccount.com',
  'chromeos-ci-prod@chromeos-bot.iam.gserviceaccount.com',
  'chromium-autoroll@skia-public.iam.gserviceaccount.com',
  'chromium-internal-autoroll@skia-corp.google.com.iam.gserviceaccount.com',
  'mdb.chrome-pki-metadata-release-jobs@google.com',
];

/**
 * Load configuration from a JSON file
 */
export async function loadConfig(configPath?: string): Promise<SummaryConfig> {
  if (!configPath) {
    return applyEnvOverrides({ ...DEFAULT_CONFIG });
  }

  try {
    const absolutePath = path.isAbsolute(configPath) 
      ? configPath 
      : path.join(process.cwd(), configPath);
    
    const configFile = await fs.readFile(absolutePath, 'utf-8');
    const userConfig = JSON.parse(configFile) as Partial<SummaryConfig>;
    
    // Merge with defaults
    const config: SummaryConfig = {
      ...DEFAULT_CONFIG,
      ...userConfig,
      // Ensure outputPath is set (as subpath of public/summaries)
      outputPath: userConfig.outputPath !== undefined ? userConfig.outputPath : DEFAULT_CONFIG.outputPath,
    };
    
    // Apply environment variable overrides
    applyEnvOverrides(config);
    
    // Validate outputPath doesn't try to escape public/summaries
    if (config.outputPath && (config.outputPath.includes('..') || path.isAbsolute(config.outputPath))) {
      throw new Error('outputPath must be a relative subpath within public/summaries (no ".." or absolute paths allowed)');
    }
    
    console.log(`✓ Loaded configuration from: ${absolutePath}`);
    if (config.customInstructions) {
      console.log('  - Custom instructions provided');
    }
    if (config.interestingKeywords) {
      console.log(`  - Keywords: ${config.interestingKeywords}`);
    }
    if (config.focusAreas && config.focusAreas.length > 0) {
      console.log(`  - Focus areas: ${config.focusAreas.join(', ')}`);
    }
    if (config.ignoredBotEmails && config.ignoredBotEmails.length > 0) {
      console.log(`  - Additional ignored bots: ${config.ignoredBotEmails.length}`);
    }
    console.log(`  - Output path: ${config.outputPath}`);
    console.log(`  - LLM provider: ${config.llmProvider}`);
    if (process.env.LLM_PROVIDER?.trim()) {
      console.log('    (overridden by LLM_PROVIDER env variable)');
    }
    if (config.llmModel) {
      console.log(`  - LLM model: ${config.llmModel}`);
    }
    
    return config;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.error(`Config file not found: ${configPath}`);
    } else if (error instanceof SyntaxError) {
      console.error(`Invalid JSON in config file: ${configPath}`);
      console.error(error.message);
    } else {
      console.error(`Error loading config: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get the list of bot emails to ignore
 */
export function getIgnoredBotEmails(config: SummaryConfig): string[] {
  return [
    ...DEFAULT_IGNORED_BOT_EMAILS,
    ...(config.ignoredBotEmails || []),
  ];
}
