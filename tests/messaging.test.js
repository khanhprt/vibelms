import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { createMessageListener } from '../src/shared/message-listener.js';

test('Chrome callback listener keeps the channel open until an async response arrives', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const listener = createMessageListener(['COURSE_STATUS'], () => pending);
  let response;
  let receive;
  const received = new Promise(resolve => { receive = resolve; });
  assert.equal(listener({ type: 'COURSE_STATUS' }, {}, result => { response = result; receive(result); }), true);
  await Promise.resolve();
  assert.equal(response, undefined);
  release({ supported: true });
  await received;
  assert.equal(response.supported, true);
});

test('unrelated messages do not claim a response channel', () => {
  const listener = createMessageListener(['COURSE_STATUS'], () => assert.fail('unexpected handler'));
  assert.equal(listener({ type: 'RUN_LOG_START' }, {}, () => assert.fail('unexpected response')), false);
});

test('handler failures reach the caller instead of disappearing', async () => {
  for (const handler of [() => { throw new Error('failed'); }, async () => { throw new Error('failed'); }]) {
    const response = await new Promise(resolve => {
      assert.equal(createMessageListener(['TEST'], handler)({ type: 'TEST' }, {}, resolve), true);
    });
    assert.equal(response.ok, false);
    assert.equal(response.error, 'failed');
  }
});

const browserSource = readFileSync(new URL('../src/shared/browser.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/export async function/g, 'async function');

function setup(browser) {
  const context = createContext({ browser, URL, console: { warn() {} },
    resolveProvider: url => url.hostname === 'lms.pttc1.edu.vn' ? {} : null });
  runInContext(browserSource, context);
  return context;
}

test('an open LMS tab without a receiver gets a content script and one retry', async () => {
  let sends = 0;
  let injections = 0;
  const context = setup({
    tabs: {
      get: async () => ({ url: 'https://lms.pttc1.edu.vn/my/courses.php' }),
      sendMessage: async () => {
        if (++sends === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
        return { supported: true };
      },
    },
    scripting: { executeScript: async options => {
      injections++;
      assert.equal(options.target.tabId, 10);
      assert.equal(options.files[0], 'content-scripts/content.js');
    } },
  });
  assert.equal((await context.sendToActiveTab(10, { type: 'COURSE_STATUS' })).supported, true);
  assert.equal(sends, 2);
  assert.equal(injections, 1);
});

test('working connections and failed commands are not reinjected or replayed', async () => {
  for (const failure of [false, true]) {
    let sends = 0;
    const context = setup({ tabs: { sendMessage: async () => {
      sends++;
      if (failure) throw new Error('The message port closed before a response was received.');
      return { ok: true };
    } } });
    const result = await context.sendToActiveTab(10, { type: 'NEXT_LESSON' });
    assert.equal(sends, 1);
    assert.equal(result.ok, !failure);
    if (failure) assert.equal(result.error, 'The message port closed before a response was received.');
  }
});

test('unsupported tabs are not injected and denied access stays visible', async () => {
  for (const supported of [false, true]) {
    let injections = 0;
    const context = setup({ tabs: {
      get: async () => ({ url: supported ? 'https://lms.pttc1.edu.vn/' : 'https://example.com/' }),
      sendMessage: async () => { throw new Error('Receiving end does not exist.'); },
    }, scripting: { executeScript: async () => { injections++; throw new Error('Cannot access contents of the page'); } } });
    const result = await context.sendToActiveTab(10, { type: 'COURSE_STATUS' });
    assert.equal(injections, supported ? 1 : 0);
    assert.equal(result.reason, supported ? 'connection-failed' : 'unsupported-page');
    if (supported) assert.equal(result.error, 'Cannot access contents of the page');
  }
});
