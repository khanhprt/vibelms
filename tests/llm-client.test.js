import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../src/services/llm-client.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');

function setup(responses) {
  const requests = [];
  const context = createContext({
    settingsStore: { get: async () => ({ llmApiKey: 'test-key', llmModel: 'test-model', boundAccount: {} }) },
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      const response = responses[requests.length - 1];
      return { status: response.status || 200, ok: (response.status || 200) < 400,
        json: async () => {
          if (response.payload instanceof Error) throw response.payload;
          return response.payload;
        } };
    },
  });
  runInContext(source, context);
  return { context, requests };
}

const valid = { choices: [{ message: { content: '{"title":"Reply","content":"Answer"}' } }] };

test('compatibility fallback removes all optional thinking and JSON parameters', async () => {
  const env = setup([{ status: 422 }, { payload: valid }]);
  await env.context.generateForumReply({ question: 'Group work?' });
  assert.equal(env.requests.length, 2);
  for (const key of ['response_format', 'reasoning_effort', 'enable_thinking', 'chat_template_kwargs']) {
    assert.ok(key in env.requests[0].body);
    assert.equal(key in env.requests[1].body, false);
  }
  assert.equal(env.requests[1].body.model, 'test-model');
});

test('blank content reports finish reason and reasoning token usage', async () => {
  const env = setup([{ payload: { choices: [{ message: { content: '' }, finish_reason: 'length' }],
    usage: { completion_tokens_details: { reasoning_tokens: 800 } } } }]);
  await assert.rejects(env.context.generateForumReply({ question: 'Group work?' }), /length.*800/);
});

test('empty content arrays are rejected while supported content shapes are accepted', async () => {
  for (const payload of [{ content: 'text' }, { draft: 'text' }, { choices: [{ message: { content: [{ text: 'text' }] } }] }]) {
    const env = setup([{ payload }]);
    assert.equal(await env.context.generateForumReply({ question: 'Group work?' }), payload);
  }
  const env = setup([{ payload: { choices: [{ message: { content: [{ text: ' ' }] } }] } }]);
  await assert.rejects(env.context.generateForumReply({ question: 'Group work?' }));
});

test('HTTP failures retain the upstream error message and status, including non-JSON failures', async () => {
  const jsonError = setup([{ status: 503, payload: { error: { message: 'upstream overloaded' } } }]);
  await assert.rejects(jsonError.context.generateForumReply({ question: 'Group work?' }), /503.*upstream overloaded/);
  const htmlError = setup([{ status: 502, payload: new Error('Invalid JSON') }]);
  await assert.rejects(htmlError.context.generateForumReply({ question: 'Group work?' }), /502/);
});

test('error envelopes on HTTP 200 are reported as gateway errors', async () => {
  const env = setup([{ payload: { error: { message: 'model unavailable' } } }]);
  await assert.rejects(env.context.generateForumReply({ question: 'Group work?' }), /model unavailable/);
});
