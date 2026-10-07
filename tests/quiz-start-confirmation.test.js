import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../src/content/quiz-extractor.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');

function setup(labels = ['B\u1eaft \u0110\u1ea7u L\u00e0m B\u00e0i', 'H\u1ee7y B\u1ecf']) {
  const clicks = [];
  const settings = { extensionEnabled: true, quizExportEnabled: true,
    autoStartQuiz: true, allowedDomains: ['lms.pttc1.edu.vn'] };
  const buttons = labels.map(textContent => ({ textContent, disabled: false,
    getAttribute: () => null, getClientRects: () => [1] }));
  const dialog = { textContent: labels.join(' '), hidden: false,
    getAttribute: () => null, getClientRects: () => [1],
    querySelector: () => null, querySelectorAll: () => buttons };
  const location = { pathname: '/mod/quiz/view.php', hostname: 'lms.pttc1.edu.vn' };
  const context = createContext({ console, location,
    document: { querySelectorAll: () => [dialog] },
    window: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
    settingsStore: { get: async () => settings },
    recordLessonFailure: async () => {},
    logActivity: () => {},
    clickWithDelay: async button => { clicks.push(button); return true; },
  });
  runInContext(source, context);
  return { context, buttons, dialog, settings, location, clicks };
}

test('confirms Vietnamese timed quiz once and never clicks Cancel', async () => {
  const env = setup();
  assert.equal(await env.context.confirmQuizStartIfNeeded(), true);
  assert.equal(await env.context.confirmQuizStartIfNeeded(), false);
  assert.deepEqual(env.clicks, [env.buttons[0]]);
});

test('handles a dialog appearing after the first scan and English labels', async () => {
  const env = setup(['Start attempt', 'Cancel']);
  env.dialog.hidden = true;
  assert.equal(await env.context.confirmQuizStartIfNeeded(), false);
  env.dialog.hidden = false;
  assert.equal(await env.context.confirmQuizStartIfNeeded(), true);
});

test('ignores disabled, invisible, and final submission controls', async () => {
  const env = setup();
  env.buttons[0].disabled = true;
  assert.equal(await env.context.confirmQuizStartIfNeeded(), false);
  env.buttons[0].disabled = false;
  env.dialog.getClientRects = () => [];
  assert.equal(await env.context.confirmQuizStartIfNeeded(), false);
  const submit = setup(['Submit all and finish', 'Cancel']);
  assert.equal(await submit.context.confirmQuizStartIfNeeded(), false);
});

test('respects settings, domain restrictions, and non-entry quiz pages', async () => {
  for (const key of ['extensionEnabled', 'quizExportEnabled', 'autoStartQuiz']) {
    const env = setup();
    env.settings[key] = false;
    assert.equal(await env.context.confirmQuizStartIfNeeded(), false);
    assert.equal(env.clicks.length, 0);
  }
  const env = setup();
  env.settings.allowedDomains = ['other.example'];
  assert.equal(await env.context.confirmQuizStartIfNeeded(), false);
  env.settings.allowedDomains = [];
  for (const page of ['attempt', 'summary', 'review']) {
    env.location.pathname = `/mod/quiz/${page}.php`;
    assert.equal(await env.context.confirmQuizStartIfNeeded(), false);
  }
});

test('locks concurrent scans during the configured click delay', async () => {
  const env = setup();
  let release;
  env.context.clickWithDelay = button => new Promise(resolve => {
    env.clicks.push(button);
    release = resolve;
  });
  const first = env.context.confirmQuizStartIfNeeded();
  await Promise.resolve();
  assert.equal(await env.context.confirmQuizStartIfNeeded(), false);
  release(true);
  assert.equal(await first, true);
  assert.equal(env.clicks.length, 1);
});

test('allows retry when the button was replaced before the delayed click', async () => {
  const env = setup();
  env.context.clickWithDelay = async () => false;
  assert.equal(await env.context.confirmQuizStartIfNeeded(), false);
  env.context.clickWithDelay = async () => true;
  assert.equal(await env.context.confirmQuizStartIfNeeded(), true);
});
