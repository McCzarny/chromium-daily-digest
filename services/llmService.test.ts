import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FailoverPlatformAdapter, PlatformAdapter } from './llmService.ts';
import { GeminiAdapter } from './geminiService.ts';

class TestAdapter implements PlatformAdapter {
  readonly history: Array<{ role: string; content: string; toolCalls?: any[] }> = [];
  calls = 0;

  constructor(
    private readonly failOnCall?: number,
    private readonly responses: string[] = []
  ) {}

  async callAPI(): Promise<{ content: string }> {
    this.calls++;
    if (this.calls === this.failOnCall) {
      throw new Error('provider failed');
    }
    return { content: this.responses[this.calls - 1] ?? `response ${this.calls}` };
  }

  addMessage(role: 'user' | 'assistant' | 'tool', content: string, toolCalls?: any[]): void {
    this.history.push({ role, content, toolCalls });
  }

  getMessages(): any[] {
    return this.history;
  }

  resetMessages(): void {
    this.history.length = 0;
  }
}

test('failover replays completed conversation turns before retrying', async () => {
  const primary = new TestAdapter(2);
  const fallback = new TestAdapter();
  const adapter = new FailoverPlatformAdapter(primary, fallback, 'opencode');

  adapter.addMessage('user', 'investigate commits');
  assert.deepEqual(await adapter.callAPI([], {}), { content: 'response 1' });
  adapter.addMessage('user', 'continue analysis');

  assert.deepEqual(await adapter.callAPI([], {}), { content: 'response 1' });
  assert.deepEqual(
    fallback.history.map(({ role, content }) => [role, content]),
    [
      ['user', 'investigate commits'],
      ['assistant', 'response 1'],
      ['user', 'continue analysis'],
      ['assistant', 'response 1'],
    ]
  );
  assert.equal(adapter.getActiveProvider('gemini'), 'opencode');
  adapter.resetMessages();
  assert.equal(adapter.getActiveProvider('gemini'), 'opencode');
});

test('failover surfaces an error if both providers fail', async () => {
  const adapter = new FailoverPlatformAdapter(
    new TestAdapter(1),
    new TestAdapter(1),
    'opencode'
  );

  await assert.rejects(adapter.callAPI([], {}), AggregateError);
});

test('failover retries malformed JSON responses on the backup provider', async () => {
  const adapter = new FailoverPlatformAdapter(
    new TestAdapter(undefined, ['not json']),
    new TestAdapter(undefined, ['{"ok":true}']),
    'nexos'
  );

  assert.deepEqual(await adapter.callAPI([], { requestJson: true }), { content: '{"ok":true}' });
  assert.equal(adapter.getActiveProvider('gemini'), 'nexos');
});

test('Gemini can restore assistant and tool turns from another provider', () => {
  const adapter = new GeminiAdapter();
  adapter.restoreMessages([
    { role: 'user', content: 'investigate' },
    { role: 'assistant', content: 'Found a relevant change.' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tool-1', name: 'get_commit_details', arguments: '{"commit_hashes":["abc"]}' }],
    },
    { role: 'tool', content: 'Tool call result for get_commit_details:\n{"commits":[]}' },
  ]);

  const messages = adapter.getMessages();
  assert.equal(messages[0].parts[0].text, 'investigate');
  assert.equal(messages[1].role, 'model');
  assert.equal(messages[1].parts[0].text, 'Found a relevant change.');
  assert.equal(messages[2].parts[0].functionCall.name, 'get_commit_details');
  assert.equal(messages[3].parts[0].functionResponse.name, 'get_commit_details');
});
