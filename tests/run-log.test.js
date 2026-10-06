import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const source = readFileSync(new URL('../src/services/run-log.js', import.meta.url), 'utf8')
  .replace('export function handleRunLogMessage', 'function handleRunLogMessage');

function setup() {
  const stored = {};
  const downloads = [];
  let failDownload = false;
  const context = createContext({URL, crypto: {randomUUID}, browser: {
    storage: {local: {get: async () => structuredClone(stored),
      set: async value => Object.assign(stored, structuredClone(value))}},
    downloads: {download: async options => {
      if (failDownload) throw new Error('Download unavailable');
      downloads.push(structuredClone(options));
      return downloads.length;
    }},
  }});
  runInContext(source, context);
  return {stored, downloads, send: message => context.handleRunLogMessage(message),
    failDownload: value => { failDownload = value; }};
}

test('session survives document reloads and a completed session gets a new ID', async () => {
  const env = setup();
  const first = await env.send({type: 'RUN_LOG_START'});
  const resumed = await env.send({type: 'RUN_LOG_START', payload: {sessionId: first.sessionId}});
  assert.equal(resumed.sessionId, first.sessionId);
  await env.send({type: 'RUN_LOG_FINISH', payload: {sessionId: first.sessionId}});
  const next = await env.send({type: 'RUN_LOG_START', payload: {sessionId: first.sessionId}});
  assert.notEqual(next.sessionId, first.sessionId);
  assert.equal(Object.keys(env.stored.vernalRunLogs.sessions).length, 2);
});

test('concurrent failures are persisted without lost updates and duplicates aggregate', async () => {
  const env = setup();
  const {sessionId} = await env.send({type: 'RUN_LOG_START'});
  const payload = {sessionId, url: 'https://lms.test/mod/quiz/attempt.php?attempt=1',
    stage: 'quiz-answer', reason: 'No answer', questionKey: 'q1'};
  await Promise.all([
    env.send({type: 'RUN_LOG_FAILURE', payload}),
    env.send({type: 'RUN_LOG_FAILURE', payload}),
    env.send({type: 'RUN_LOG_FAILURE', payload: {...payload, questionKey: 'q2'}}),
  ]);
  const errors = env.stored.vernalRunLogs.sessions[sessionId].errors;
  assert.equal(errors.length, 2);
  assert.equal(errors[0].count, 2);
});

test('finish exports one log per session with exact activity URLs and reasons', async () => {
  const env = setup();
  const {sessionId} = await env.send({type: 'RUN_LOG_START'});
  await env.send({type: 'RUN_LOG_FAILURE', payload: {sessionId,
    url: 'https://lms.test/mod/forum/view.php?id=7', reason: 'Submission failed', stage: 'forum-submit'}});
  await env.send({type: 'RUN_LOG_FINISH', payload: {sessionId}});
  await env.send({type: 'RUN_LOG_FINISH', payload: {sessionId}});
  assert.equal(env.downloads.length, 1);
  assert.ok(env.downloads[0].filename.startsWith('Vernal/logs/session-'));
  const text = decodeURIComponent(env.downloads[0].url.split(',')[1]);
  assert.ok(text.includes('https://lms.test/mod/forum/view.php?id=7'));
  assert.ok(text.includes('Submission failed'));
  assert.ok(text.includes('Activities with errors: 1'));
});

test('failed download preserves logs and can be retried', async () => {
  const env = setup();
  const {sessionId} = await env.send({type: 'RUN_LOG_START'});
  env.failDownload(true);
  await assert.rejects(env.send({type: 'RUN_LOG_FINISH', payload: {sessionId}}), /Download/);
  assert.ok(env.stored.vernalRunLogs.sessions[sessionId].finishedAt);
  env.failDownload(false);
  assert.equal((await env.send({type: 'RUN_LOG_EXPORT'})).ok, true);
  assert.equal(env.downloads.length, 1);
});

test('session exports stay separate and late failures update the existing filename', async () => {
  const env = setup();
  const {sessionId} = await env.send({type: 'RUN_LOG_START'});
  await env.send({type: 'RUN_LOG_FINISH', payload: {sessionId}});
  await env.send({type: 'RUN_LOG_FAILURE', payload: {sessionId,
    url: 'https://lms.test/mod/folder/view.php?id=3', reason: 'Navigation failed'}});
  assert.equal(env.downloads[1].filename, env.downloads[0].filename);
  assert.ok(decodeURIComponent(env.downloads[1].url).includes('Navigation failed'));
  const next = await env.send({type: 'RUN_LOG_START'});
  assert.equal(env.stored.vernalRunLogs.sessions[next.sessionId].errors.length, 0);
});
