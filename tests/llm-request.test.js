import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const retrySource = readFileSync(new URL('../src/shared/llm-request.js', import.meta.url), 'utf8')
  .replace(/^export /gm, '');
const forumSource = readFileSync(new URL('../src/content/forum-helper.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');

function setup(responses) {
  let calls = 0;
  const waits = [];
  const context = createContext({
    console: { warn() {}, log() {}, error() {}, group() {}, groupEnd() {} },
    browser: { runtime: { sendMessage: async () => {
      const response = responses[calls++];
      if (response instanceof Error) throw response;
      return response;
    } } },
    setTimeout: (callback, ms) => { waits.push(ms); callback(); },
    logActivity: () => {},
  });
  runInContext(`${retrySource}\n${forumSource}`, context);
  return { context, calls: () => calls, waits };
}

const validDraft = { choices: [{ message: { content: '{"title":"Reply","content":"Answer"}' } }] };

test('forum retries empty gateway responses and malformed drafts, then returns the third valid result', async () => {
  for (const type of ['GENERATE_FORUM_REPLY', 'GENERATE_DISCUSSION']) {
    const env = setup([
      { ok: false, reason: 'handler-failed', error: 'upstream empty' },
      { choices: [{ message: { content: 'not JSON' } }] },
      validDraft,
    ]);
    const draft = await env.context.requestLlmWithRetry({ type }, { parse: env.context.parseDraft });
    assert.equal(draft.content, 'Answer');
    assert.equal(env.calls(), 3);
    assert.deepEqual(env.waits, [700, 1400]);
  }
});

test('successful drafts stop immediately without extra requests', async () => {
  const env = setup([validDraft]);
  const draft = await env.context.requestLlmWithRetry({ type: 'GENERATE_FORUM_REPLY' }, { parse: env.context.parseDraft });
  assert.equal(draft.title, 'Reply');
  assert.equal(env.calls(), 1);
  assert.deepEqual(env.waits, []);
});

test('drafts with blank required fields are retried before they can be posted', async () => {
  const env = setup([{ content: '{"title":"Reply","content":"   "}' }, validDraft]);
  const draft = await env.context.requestLlmWithRetry({ type: 'GENERATE_FORUM_REPLY' }, { parse: env.context.parseDraft });
  assert.equal(draft.content, 'Answer');
  assert.equal(env.calls(), 2);
});

test('three failures report the original gateway reason rather than a blank content error', async () => {
  const env = setup(Array(3).fill({ error: 'upstream empty (length)' }));
  await assert.rejects(
    env.context.requestLlmWithRetry({ type: 'GENERATE_FORUM_REPLY' }, { parse: env.context.parseDraft }),
    /3.*upstream empty \(length\)/,
  );
  assert.equal(env.calls(), 3);
});

test('transport failures and missing background responses also get at most three attempts', async () => {
  const env = setup([new Error('network disconnected'), undefined, validDraft]);
  await env.context.requestLlmWithRetry({ type: 'GENERATE_FORUM_REPLY' }, { parse: env.context.parseDraft });
  assert.equal(env.calls(), 3);
});

test('an announcement detected during retries cancels before sending another request', async () => {
  const env = setup([{ error: 'empty' }, validDraft]);
  const result = await env.context.requestLlmWithRetry({ type: 'GENERATE_FORUM_REPLY' }, {
    parse: env.context.parseDraft,
    shouldContinue: () => env.calls() === 0,
  });
  assert.equal(result, null);
  assert.equal(env.calls(), 1);
});

test('forum parser preserves gateway errors when called directly', () => {
  const env = setup([]);
  assert.throws(() => env.context.parseDraft({ error: 'gateway original reason' }), /gateway original reason/);
});
