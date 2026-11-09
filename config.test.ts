import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEnvOverrides } from './config.ts';

const withoutLLMEnv = <T>(run: () => T): T => {
  const provider = process.env.LLM_PROVIDER;
  const fallbackProvider = process.env.LLM_FALLBACK_PROVIDER;
  delete process.env.LLM_PROVIDER;
  delete process.env.LLM_FALLBACK_PROVIDER;
  try {
    return run();
  } finally {
    if (provider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = provider;
    if (fallbackProvider === undefined) delete process.env.LLM_FALLBACK_PROVIDER;
    else process.env.LLM_FALLBACK_PROVIDER = fallbackProvider;
  }
};

test('fallback model requires a fallback provider and is normalized', () => {
  withoutLLMEnv(() => {
    assert.throws(
      () => applyEnvOverrides({ llmFallbackModel: 'deepseek-v4-pro' }),
      /requires llmFallbackProvider/
    );

    const config = applyEnvOverrides({
      llmProvider: 'gemini',
      llmFallbackProvider: 'opencode',
      llmFallbackModel: ' deepseek-v4-pro ',
    });
    assert.equal(config.llmFallbackModel, 'deepseek-v4-pro');
  });
});
