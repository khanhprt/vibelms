import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../src/content/auto-resume.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/export function /g, 'function ');
const origin = 'https://lms.pttc1.edu.vn';
const phaseKey = 'vernal:auto-resume-phase';

function card(id, percent) {
  const link = { href: `${origin}/course/view.php?id=${id}` };
  return { querySelector: selector => {
    if (selector.includes('a[href')) return link;
    if (selector.includes('aria-valuenow')) return percent === null ? null : {
      getAttribute: () => String(percent), style: {},
    };
    return null;
  } };
}

function setup(cards = []) {
  const storage = new Map();
  const timers = new Map();
  const navigations = [];
  let id = 0;
  const doc = { querySelectorAll: () => cards, querySelector: () => null };
  const location = { pathname: '/my/courses.php', href: `${origin}/my/courses.php`, origin,
    assign: url => navigations.push(url) };
  const context = createContext({URL, console, document: doc, location,
    finishLearningSession: async () => {},
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key) },
    setTimeout: callback => { timers.set(++id, callback); return id; },
    clearTimeout: key => timers.delete(key),
  });
  runInContext(source, context);
  return {context, storage, doc, location, navigations, runTimer() {
    const callbacks = [...timers.values()];
    timers.clear();
    callbacks.forEach(callback => callback());
  } };
}

test('course selection excludes 100%, preserves real 0% and ignores missing progress', () => {
  const env = setup([card(1, 100), card(2, 20), card(3, 0), card(4, null)]);
  env.context.markAutoResumeAfterLogin();
  env.context.resumeLowestProgressCourse();
  env.runTimer();
  assert.deepEqual(env.navigations, [`${origin}/course/view.php?id=3`]);
});

test('all completed courses stop the resume flow', () => {
  const env = setup([card(1, 100), card(2, 100)]);
  env.context.markAutoResumeAfterLogin();
  env.context.resumeLowestProgressCourse();
  env.runTimer();
  assert.equal(env.navigations.length, 0);
  assert.equal(env.storage.has(phaseKey), false);
});

test('starting on the already-open courses page selects a course without a prior session phase', () => {
  const env = setup([card(1, 80), card(2, 10)]);
  assert.equal(env.context.resumeLowestProgressCourse(), false);
  assert.equal(env.context.resumeLowestProgressCourse({startIfIdle: true}), true);
  env.runTimer();
  assert.deepEqual(env.navigations, [`${origin}/course/view.php?id=2`]);
});

test('a stale activity phase on the courses page is reset only on explicit startup', () => {
  const env = setup([card(1, 30)]);
  env.storage.set(phaseKey, 'activity');
  env.context.resumeLowestProgressCourse({startIfIdle: true});
  env.runTimer();
  assert.deepEqual(env.navigations, [`${origin}/course/view.php?id=1`]);
});

test('course links with parameters before id are recognised', () => {
  const link = {href: `${origin}/course/view.php?section=0&id=9`};
  const item = card(9, 20);
  const originalQuery = item.querySelector;
  item.querySelector = selector => selector.includes('a[href')
    ? selector.includes('/course/view.php?id=') ? null : link
    : originalQuery(selector);
  const env = setup([item]);
  env.context.resumeLowestProgressCourse({startIfIdle: true});
  env.runTimer();
  assert.deepEqual(env.navigations, [link.href]);
});

test('partially loaded course cards retain the flow until links and progress arrive', () => {
  const loaded = card(1, 25);
  let ready = false;
  const pending = {querySelector: selector => ready ? loaded.querySelector(selector) : null};
  const env = setup([pending]);
  env.context.resumeLowestProgressCourse({startIfIdle: true});
  assert.equal(env.storage.get(phaseKey), 'courses');
  env.runTimer();
  assert.equal(env.navigations.length, 0);
  ready = true;
  env.context.resumeLowestProgressCourse();
  env.runTimer();
  assert.deepEqual(env.navigations, [`${origin}/course/view.php?id=1`]);
});

test('missing progress keeps the pending flow instead of declaring all courses finished', () => {
  const env = setup([card(1, null)]);
  env.context.resumeLowestProgressCourse({startIfIdle: true});
  env.runTimer();
  assert.equal(env.storage.get(phaseKey), 'courses');
  assert.equal(env.navigations.length, 0);
});

test('end of course returns directly and skips it even if LMS progress is below 100%', () => {
  const env = setup([card(1, 15), card(2, 40), card(3, 60)]);
  env.doc.querySelector = () => ({href: `${origin}/course/view.php?id=1`});
  env.location.pathname = '/mod/quiz/review.php';
  assert.equal(env.context.finishCourseAndResume(), true);
  env.context.resumeLowestProgressCourse();
  env.runTimer();
  assert.deepEqual(env.navigations, ['/my/courses.php']);
  assert.equal(env.storage.get('vernal_completed_course_1'), 'true');
  env.location.pathname = '/my/courses.php';
  env.context.resumeLowestProgressCourse();
  env.runTimer();
  assert.equal(env.storage.get('vernal_completed_course_1'), 'true');
  assert.equal(env.navigations.at(-1), `${origin}/course/view.php?id=2`);
});

test('the finished course is marked from the body class when the breadcrumb is missing', () => {
  const env = setup([card(1, 15), card(2, 40), card(3, 60)]);
  env.doc.querySelector = () => null;
  env.doc.body = { className: 'path-mod path-mod-quiz course-1' };
  env.location.pathname = '/mod/quiz/review.php';
  assert.equal(env.context.finishCourseAndResume(), true);
  env.location.pathname = '/my/courses.php';
  env.context.resumeLowestProgressCourse();
  env.runTimer();
  assert.equal(env.storage.get('vernal_completed_course_1'), 'true');
  assert.equal(env.navigations.at(-1), `${origin}/course/view.php?id=2`);
});

test('returning to courses does not require a breadcrumb or progress on the old course', () => {
  const env = setup([card(1, null), card(2, 10)]);
  env.location.pathname = '/mod/forum/view.php';
  assert.equal(env.context.finishCourseAndResume(), true);
  env.context.resumeLowestProgressCourse();
  env.runTimer();
  assert.deepEqual(env.navigations, ['/my/courses.php']);
  env.location.pathname = '/my/courses.php';
  env.context.resumeLowestProgressCourse();
  env.runTimer();
  assert.equal(env.navigations.at(-1), `${origin}/course/view.php?id=2`);
});

test('the final PDF without breadcrumbs remembers the selected course and opens the next course', () => {
  const env = setup([card(1, 10), card(2, 30)]);
  env.context.resumeLowestProgressCourse({ startIfIdle: true });
  env.runTimer();
  assert.equal(env.storage.get('vernal:current-course-id'), '1');
  env.location.pathname = '/mod/resource/view.php';
  env.location.href = `${origin}/mod/resource/view.php?id=52526&forceview=1`;
  env.context.finishCourseAndResume();
  assert.equal(env.storage.get('vernal_completed_course_1'), 'true');
  env.runTimer();
  assert.equal(env.navigations.at(-1), '/my/courses.php');
  env.location.pathname = '/my/courses.php';
  env.context.resumeLowestProgressCourse();
  env.runTimer();
  assert.equal(env.navigations.at(-1), `${origin}/course/view.php?id=2`);
});

test('ending a course is recorded even when automatic selection of the next course is disabled', () => {
  const env = setup();
  env.doc.body = { className: 'path-mod-resource course-42' };
  env.location.pathname = '/mod/resource/view.php';
  env.context.finishCourseAndResume({ resume: false });
  env.runTimer();
  assert.equal(env.storage.get('vernal_completed_course_42'), 'true');
  assert.equal(env.navigations.length, 0);
});

test('the course opens its first activity even when completed and not a video', () => {
  const env = setup();
  env.location.pathname = '/course/view.php';
  env.storage.set(phaseKey, 'video');
  const activity = (id, done) => ({ querySelector: selector => {
    if (selector.includes('a[href')) return {href: `${origin}/mod/folder/view.php?id=${id}&forceview=1`, getAttribute: () => null};
    if (selector.includes('manual:undo')) return done ? {} : null;
    if (selector.includes('manual:mark-done')) return done ? null : {};
    return null;
  }, querySelectorAll: () => [] });
  env.doc.querySelectorAll = () => [activity(1, true), activity(2, false)];
  env.context.resumeLowestProgressCourse();
  env.runTimer();
  assert.deepEqual(env.navigations, [`${origin}/mod/folder/view.php?id=1&forceview=1`]);
});

test('an already-open course section starts without a prior course-selection phase', () => {
  const env = setup();
  env.location.pathname = '/course/view.php';
  env.location.href = `${origin}/course/view.php?id=21357&section=1`;
  const first = { href: `${origin}/mod/videotime/view.php?id=100`, getAttribute: () => null };
  env.doc.querySelectorAll = selector => selector.startsWith('li.activity') ? [] : [first];
  assert.equal(env.context.resumeLowestProgressCourse({ startIfIdle: true }), true);
  env.runTimer();
  assert.deepEqual(env.navigations, [first.href]);
  assert.equal(env.storage.get('vernal:current-course-id'), '21357');
});

test('course section startup waits for asynchronously loaded activities and preserves their order', () => {
  const env = setup();
  env.location.pathname = '/course/view.php';
  env.location.href = `${origin}/course/view.php?id=21357&section=1`;
  let links = [];
  env.doc.querySelectorAll = selector => selector.startsWith('li.activity') ? [] : links;
  assert.equal(env.context.resumeLowestProgressCourse({ startIfIdle: true }), false);
  assert.equal(env.storage.get(phaseKey), 'activity');
  links = [
    { href: `${origin}/mod/videotime/view.php?id=1`, getAttribute: () => null },
    { href: `${origin}/mod/resource/view.php?id=2`, getAttribute: () => null },
  ];
  assert.equal(env.context.resumeLowestProgressCourse(), true);
  env.runTimer();
  assert.deepEqual(env.navigations, [links[0].href]);
});

test('the current section ignores external, edit, preview and disabled module links', () => {
  const env = setup();
  env.location.pathname = '/course/view.php';
  env.location.href = `${origin}/course/view.php?id=21357&section=1`;
  const valid = { href: `${origin}/mod/quiz/view.php?id=9`, getAttribute: () => null };
  const links = [
    { href: 'https://example.com/mod/page/view.php?id=1', getAttribute: () => null },
    { href: `${origin}/mod/quiz/preview.php?id=2`, getAttribute: () => null },
    { href: `${origin}/mod/resource/edit.php?id=3`, getAttribute: () => null },
    { href: `${origin}/mod/page/view.php?id=4`, getAttribute: () => 'true' },
    valid,
  ];
  env.doc.querySelectorAll = selector => selector.startsWith('li.activity') ? [] : links;
  env.context.resumeLowestProgressCourse({ startIfIdle: true });
  env.runTimer();
  assert.deepEqual(env.navigations, [valid.href]);
});

test('provider never mistakes the previous activity link for next', () => {
  const providerSource = readFileSync(new URL('../src/providers/pttc1.provider.js', import.meta.url), 'utf8')
    .replace('export const pttc1Provider', 'const pttc1Provider');
  const context = createContext({});
  const provider = runInContext(`${providerSource}\npttc1Provider;`, context);
  const previous = {textContent: 'Previous activity', getAttribute: () => null};
  const doc = {querySelectorAll: () => [previous], querySelector: () => ({})};
  assert.equal(provider.findNextButton(doc), null);
});

test('provider finds the next activity control next to the previous one', () => {
  const providerSource = readFileSync(new URL('../src/providers/pttc1.provider.js', import.meta.url), 'utf8')
    .replace('export const pttc1Provider', 'const pttc1Provider');
  const provider = runInContext(`${providerSource}\npttc1Provider;`, createContext({}));
  const previous = { textContent: '\u2039 Ho\u1ea1t \u0110\u1ed9ng Tr\u01b0\u1edbc', getAttribute: () => null };
  const controls = [previous];
  const doc = { querySelector: () => null, querySelectorAll: () => controls };
  assert.equal(provider.findNextButton(doc), null);
  const next = { textContent: 'Ho\u1ea1t \u0111\u1ed9ng ti\u1ebfp theo \u203a', getAttribute: () => null };
  controls.push(next);
  assert.equal(provider.findNextButton(doc), next);
});
