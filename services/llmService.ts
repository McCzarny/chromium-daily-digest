import { GitilesCommit, StructuredSummary, SummaryConfig } from "../types";
import { generateSummary as generateGeminiSummary, generateWeeklySummary as generateGeminiWeeklySummary } from "./geminiService";

/**
 * LLM Provider types
 */
export type LLMProvider = 'gemini' | 'openai' | 'anthropic';

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
