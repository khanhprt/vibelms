import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../src/shared/delays.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/export (async )?function/g, '$1function');

test('the activity timer counts toward the click delay rather than adding another wait', async () => {
  for (const [clickDelaySeconds, waitedMs, expected] of [[1, 3000, []], [5, 3000, [2000]], [1, 0, [1000]]]) {
    const waits = [];
    const context = createContext({
      DEFAULT_SETTINGS: { clickDelaySeconds: 1, nextLessonDelaySeconds: 5 },
      settingsStore: { get: async () => ({ clickDelaySeconds }) },
      setTimeout: (callback, ms) => { waits.push(ms); callback(); },
    });
    runInContext(source, context);
    await context.waitClickDelay(waitedMs);
    assert.deepEqual(waits, expected);
  }
});
