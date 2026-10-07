import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../src/services/quiz-solver.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^export /gm, '');

function setup(settings) {
  const requests = [];
  const context = createContext({
    settingsStore: { get: async () => settings },
    console: { group() {}, groupEnd() {}, log() {}, error() {} },
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"value":"a","why":"Đúng"}' } }],
        }),
      };
    },
  });
  runInContext(source, context);
  return { context, requests };
}

const settings = {
  llmApiKey: 'test-key',
  llmModel: 'qwen3.8-max',
  quizVisionModel: 'gemini-3.8-flash',
  llmEndpoint: 'https://api.example.test/v1/chat/completions',
};

const question = {
  stem: 'Ảnh này là gì?',
  type: 'single',
  quizName: 'Test',
  options: [{ value: 'a', label: 'A' }],
};

test('quiz có ảnh dùng model dự phòng và payload OpenAI-compatible image_url', async () => {
  const env = setup(settings);
  await env.context.suggestAnswer({
    ...question,
    assets: [{ dataUrl: 'data:image/png;base64,AA==' }],
  });

  assert.equal(env.requests[0].model, 'gemini-3.8-flash');
  assert.deepEqual(env.requests[0].messages[1].content, [
    { type: 'text', text: env.requests[0].messages[1].content[0].text },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
  ]);
});

test('quiz không có ảnh vẫn dùng nguyên model chính và text content', async () => {
  const env = setup(settings);
  await env.context.suggestAnswer({ ...question, assets: [] });

  assert.equal(env.requests[0].model, 'qwen3.8-max');
  assert.equal(typeof env.requests[0].messages[1].content, 'string');
});
