import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../src/content/learning-controller.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace('export function createLearningController', 'function createLearningController');

async function settle() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

async function setup(path, overrides = {}, {storage = new Map(), providerOverrides = {}, docOverrides = {}, logFailure = false, logHangs = false, realResume = false, initiallyComplete = false} = {}) {
  const settings = {
    extensionEnabled: true, allowedDomains: [], autoResumeCourse: true,
    autoPlayVideo: false, autoNextLesson: false, nextLessonDelaySeconds: 5,
    ...overrides,
  };
  const calls = { next: 0, resume: 0, mark: 0, stop: 0, quiz: 0, forum: 0, verify: 0, resumeOptions: [], redirects: [] };
  const timers = new Map();
  let id = 0;
  let now = 0;
  let forumCompleted = false;
  let forumTask = true;
  let delay = async () => {};
  const url = new URL(`https://lms.pttc1.edu.vn${path}`);
  const location = { href: url.href, origin: url.origin, pathname: url.pathname, search: url.search, hostname: url.hostname,
    assign: target => calls.redirects.push(target) };
  const button = { isConnected: true, disabled: false, click: () => calls.next++ };
  const doc = { body: {}, documentElement: {}, querySelector: () => null, querySelectorAll: () => [], ...docOverrides };
  const provider = {
    id: 'test', findNextButton: () => button, findVideo: () => null,
    getAccount: () => ({ authenticated: true }),
    ...providerOverrides,
  };
  const context = createContext({
    Date: { now: () => now }, URL,
    console: { warn() {} },
    ensureLearningSession: async () => { if (logHangs) return new Promise(() => {}); if (logFailure) throw new Error('Log storage unavailable'); return 'test-session'; }, finishLearningSession: async () => {}, recordLessonFailure: async () => {},
    logActivity: () => {},
    URLSearchParams, location, MESSAGE: { START_AUTO_RESUME: 'resume', NEXT_LESSON: 'next', LOGIN_WITH_SAVED_CREDENTIALS: 'login', COURSE_STATUS: 'status' },
    sessionStorage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)},
    settingsStore: { get: async () => settings },
    document: doc,
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: (callback, ms) => { timers.set(++id, { callback, ms }); return id; },
    clearTimeout: key => timers.delete(key), setInterval: () => ++id, clearInterval: () => {},
    nextLessonDelayMs: seconds => seconds * 1000, waitClickDelay: waitedMs => delay(waitedMs),
    syncCourseStatusPanel: () => {}, autoBindLocalAccount: async () => {},
    markAutoResumeAfterLogin: () => calls.mark++, rememberCurrentActivity: () => {},
    wasQuizOrForumInitiallyCompleted: () => initiallyComplete, resumeLowestProgressCourse: options => {
      calls.resumeOptions.push(options);
      calls.resume++;
    },
    stopAutoResume: () => calls.stop++, isCurrentForumCompleted: async () => forumCompleted,
    forumRequiresTask: () => forumTask,
    finishCourseAndResume: () => { calls.verify++; return true; },
    mountForumHelper: () => calls.forum++, mountQuizExtractor: () => { calls.quiz++; return () => {}; },
  });
  if (realResume) {
    const resumeSource = readFileSync(new URL('../src/content/auto-resume.js', import.meta.url), 'utf8')
      .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
    runInContext(resumeSource, context);
  }
  runInContext(source, context);
  const controller = context.createLearningController(provider);
  await settle();
  calls.resume = 0;
  return { controller, settings, calls, timers, location, provider, doc,
    setTime: value => { now = value; },
    setForumTask: value => { forumTask = value; },
    completeForum: () => { forumCompleted = true; }, setDelay: value => { delay = value; } };
}

test('resume keeps video, forum and quiz on the current activity without remounting quiz', async () => {
  for (const path of ['/mod/videotime/view.php?id=1', '/mod/forum/view.php?id=2', '/mod/quiz/attempt.php?attempt=3']) {
    const env = await setup(path);
    for (let i = 0; i < 2; i++) {
      const result = await env.controller.handleMessage({ type: 'resume' });
      assert.equal(result.resumedCurrentActivity, true);
    }
    assert.equal(env.calls.mark, 0);
    assert.equal(env.calls.resume, 0);
    assert.equal(env.calls.quiz, 1);
    env.controller.destroy();
  }
});

test('baseline-complete quiz is skipped without mounting its helper', async () => {
  const env = await setup('/mod/quiz/view.php?id=1', {}, { initiallyComplete: true });
  await settle();
  assert.equal(env.calls.quiz, 0);
  assert.equal(env.calls.forum, 0);
  assert.equal(env.calls.next, 1);
  env.controller.destroy();
});

test('a buttonless page reached after Next is treated as the end of its course', async () => {
  const storage = new Map([['vernal:activity-navigation-pending', JSON.stringify({
    source: 'https://lms.pttc1.edu.vn/mod/page/view.php?id=1', startedAt: 1,
  })]]);
  const env = await setup('/mod/forum/view.php?id=2', {}, {
    storage,
    providerOverrides: { findNextButton: () => null },
  });
  await settle();
  assert.equal(env.calls.verify, 1);
  assert.equal(env.calls.forum, 0);
  assert.equal(storage.has('vernal:activity-navigation-pending'), false);
  env.controller.destroy();
});

test('a buttonless course page reached after Next is also treated as course completion', async () => {
  const storage = new Map([['vernal:activity-navigation-pending', JSON.stringify({
    source: 'https://lms.pttc1.edu.vn/mod/page/view.php?id=1', startedAt: 1,
  })]]);
  const env = await setup('/course/view.php?id=2', {}, {
    storage,
    providerOverrides: { findNextButton: () => null },
  });
  await settle();
  assert.equal(env.calls.verify, 1);
  assert.equal(storage.has('vernal:activity-navigation-pending'), false);
  env.controller.destroy();
});

test('initial controller startup and power-on seed course selection on an open dashboard', async () => {
  const env = await setup('/my/courses.php');
  assert.ok(env.calls.resumeOptions.some(options => options?.startIfIdle === true));
  env.calls.resumeOptions.length = 0;
  env.controller.setEnabled(false);
  env.controller.setEnabled(true);
  await settle();
  assert.ok(env.calls.resumeOptions.some(options => options?.startIfIdle === true));
  env.controller.destroy();
});

test('forum advances only after the current discussion is complete, once', async () => {
  const env = await setup('/mod/forum/discuss.php?d=7');
  assert.equal((await env.controller.handleMessage({ type: 'next' })).reason, 'activity-incomplete');
  env.completeForum();
  await env.controller.handleMessage({ type: 'next' });
  await env.controller.handleMessage({ type: 'next' });
  assert.equal(env.calls.next, 1);
  env.controller.destroy();
});

test('quiz attempt and summary cannot advance; submitted review can', async () => {
  for (const page of ['attempt', 'summary', 'review']) {
    const env = await setup(`/mod/quiz/${page}.php?attempt=9`);
    await env.controller.handleMessage({ type: 'next' });
    assert.equal(env.calls.next, page === 'review' ? 1 : 0);
    env.controller.destroy();
  }
});

test('video uses the configured delay to complete and advances once', async () => {
  const env = await setup('/mod/videotime/view.php?id=1', { autoNextLesson: true });
  assert.equal(env.calls.next, 0);
  const timer = [...env.timers.values()].find(item => item.ms === 5000);
  assert.ok(timer);
  timer.callback();
  await settle();
  assert.equal(env.calls.next, 1);
  await env.controller.handleMessage({ type: 'resume' });
  assert.equal(env.calls.next, 1);
  env.controller.destroy();
});

test('disabling the controller during click delay cancels navigation', async () => {
  const env = await setup('/mod/quiz/review.php?attempt=9');
  let release;
  env.setDelay(() => new Promise(resolve => { release = resolve; }));
  const pending = env.controller.handleMessage({ type: 'next' });
  await settle();
  env.controller.setEnabled(false);
  release();
  await pending;
  assert.equal(env.calls.next, 0);
  env.controller.destroy();
});

test('automatic navigation rechecks auto-next after click delay', async () => {
  const env = await setup('/mod/forum/discuss.php?d=7', { autoNextLesson: true });
  env.completeForum();
  let release;
  env.setDelay(() => new Promise(resolve => { release = resolve; }));
  const pending = env.controller.handleMessage({ type: 'resume' });
  await settle();
  env.settings.autoNextLesson = false;
  release();
  await pending;
  assert.equal(env.calls.next, 0);
  env.controller.destroy();
});

test('pending course navigation is cancelled when resuming an existing activity', () => {
  const resumeSource = readFileSync(new URL('../src/content/auto-resume.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export function /g, 'function ');
  const storage = new Map();
  const timers = new Map();
  let timerId = 0;
  const context = createContext({
    sessionStorage: {
      getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    location: { pathname: '/my/', assign: () => assert.fail('Unexpected navigation') },
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: key => timers.delete(key),
  });
  runInContext(resumeSource, context);
  context.markAutoResumeAfterLogin();
  context.resumeLowestProgressCourse();
  context.resumeLowestProgressCourse();
  assert.equal(timers.size, 1);
  context.location.pathname = '/mod/quiz/attempt.php';
  context.resumeLowestProgressCourse();
  assert.equal(timers.size, 0);
  assert.equal(storage.size, 0);
});

test('last submitted quiz returns to courses once, without skipping an unfinished attempt', async () => {
  for (const page of ['attempt', 'review']) {
    const env = await setup(`/mod/quiz/${page}.php?attempt=9`);
    env.provider.findNextButton = () => null;
    await env.controller.handleMessage({ type: 'next' });
    await env.controller.handleMessage({ type: 'next' });
    assert.equal(env.calls.verify, page === 'review' ? 1 : 0);
    assert.equal(env.calls.next, 0);
    env.controller.destroy();
  }
});

test('last quiz review automatically returns to courses with only a previous activity control', async () => {
  const providerSource = readFileSync(new URL('../src/providers/pttc1.provider.js', import.meta.url), 'utf8')
    .replace('export const pttc1Provider', 'const pttc1Provider');
  const provider = runInContext(`${providerSource}\npttc1Provider;`, createContext({}));
  const controls = [{ textContent: 'Ho\u1ea1t \u0110\u1ed9ng Tr\u01b0\u1edbc', getAttribute: () => null }];
  for (const page of ['attempt', 'summary', 'review']) {
    const env = await setup(`/mod/quiz/${page}.php?attempt=355333&cmid=50281`, { autoNextLesson: true }, {
      providerOverrides: { findNextButton: doc => provider.findNextButton(doc) },
      docOverrides: { querySelectorAll: () => controls },
    });
    await env.controller.handleMessage({ type: 'resume' });
    await env.controller.handleMessage({ type: 'resume' });
    assert.equal(env.calls.verify, page === 'review' ? 1 : 0);
    assert.equal(env.calls.next, 0);
    env.controller.destroy();
  }
});

test('a last video page with no next link at all still returns to courses', async () => {
  const env = await setup('/mod/videotime/view.php?id=1', { autoNextLesson: true });
  env.provider.findNextButton = () => null;
  env.doc.querySelectorAll = () => [];
  const timer = [...env.timers.values()].find(item => item.ms === 5000);
  timer.callback();
  await settle();
  assert.equal(env.calls.verify, 1);
  assert.equal(env.calls.next, 0);
  env.controller.destroy();
});

test('the final PDF with only Phan Truoc ends the course exactly once after 3 seconds', async () => {
  const providerSource = readFileSync(new URL('../src/providers/pttc1.provider.js', import.meta.url), 'utf8')
    .replace('export const pttc1Provider', 'const pttc1Provider');
  const provider = runInContext(`${providerSource}\npttc1Provider;`, createContext({}));
  const previous = { textContent: 'Phần Trước', getAttribute: () => null };
  const env = await setup('/mod/resource/view.php?id=52526&forceview=1', {
    autoNextLesson: true, nextLessonDelaySeconds: 3,
  }, { providerOverrides: { findNextButton: doc => provider.findNextButton(doc) },
    docOverrides: { querySelectorAll: () => [previous] } });
  const timer = [...env.timers.values()].find(item => item.ms === 3000);
  assert.ok(timer);
  timer.callback();
  await settle();
  assert.equal(env.calls.verify, 1);
  assert.equal(env.calls.next, 0);
  assert.equal((await env.controller.handleMessage({ type: 'status' })).courseFinished, true);
  await env.controller.handleMessage({ type: 'next' });
  assert.equal(env.calls.verify, 1);
  env.controller.destroy();
});

test('log failures do not block dashboard startup, power-on or the resume command', async () => {
  const env = await setup('/my/courses.php', {}, { logFailure: true });
  assert.ok(env.calls.resumeOptions.some(options => options?.startIfIdle));
  env.calls.resumeOptions.length = 0;
  env.controller.setEnabled(false);
  env.controller.setEnabled(true);
  await settle();
  assert.ok(env.calls.resumeOptions.some(options => options?.startIfIdle));
  assert.equal((await env.controller.handleMessage({ type: 'resume' })).ok, true);
  env.controller.destroy();
});

test('a next link that renders during the click delay is still followed', async () => {
  const env = await setup('/mod/videotime/view.php?id=1');
  const late = { isConnected: true, disabled: false, click: () => env.calls.next++ };
  env.provider.findNextButton = () => (env.calls.next || env.calls.verify ? null : late);
  await env.controller.handleMessage({ type: 'next' });
  assert.equal(env.calls.verify, 0);
  assert.equal(env.calls.next, 1);
  env.controller.destroy();
});

test('resume on a finished PDF preserves the real return-to-courses navigation instead of cancelling it', async () => {
  const storage = new Map([['vernal:current-course-id', '42']]);
  const env = await setup('/mod/resource/view.php?id=52526&forceview=1', {}, {
    storage, realResume: true, providerOverrides: { findNextButton: () => null },
  });
  await env.controller.handleMessage({ type: 'next' });
  assert.equal(storage.get('vernal_completed_course_42'), 'true');
  assert.equal(storage.get('vernal:auto-resume-phase'), 'return-courses');
  const result = await env.controller.handleMessage({ type: 'resume' });
  assert.equal(result.returningToCourses, true);
  assert.equal(storage.get('vernal:auto-resume-phase'), 'return-courses');
  const timer = [...env.timers.values()].find(item => item.ms === 500);
  assert.ok(timer);
  timer.callback();
  assert.deepEqual(env.calls.redirects, ['/my/courses.php']);
  env.controller.destroy();
});

test('a pending logging request does not hold dashboard startup or the resume command', async () => {
  const env = await setup('/my/courses.php', {}, { logHangs: true });
  assert.ok(env.calls.resumeOptions.some(options => options?.startIfIdle));
  assert.equal((await env.controller.handleMessage({ type: 'resume' })).ok, true);
  env.controller.destroy();
});

test('controller startup opens content in a directly opened course section', async () => {
  const first = { href: 'https://lms.pttc1.edu.vn/mod/videotime/view.php?id=123', getAttribute: () => null };
  const env = await setup('/course/view.php?id=21357&section=1', {}, {
    realResume: true,
    docOverrides: { querySelectorAll: selector => selector.startsWith('li.activity') ? [] : [first] },
  });
  const timer = [...env.timers.values()].find(item => item.ms === 500);
  assert.ok(timer);
  timer.callback();
  assert.deepEqual(env.calls.redirects, [first.href]);
  env.controller.destroy();
});

test('the resume command stays in the open course section instead of returning to the course list', async () => {
  const first = { href: 'https://lms.pttc1.edu.vn/mod/resource/view.php?id=123', getAttribute: () => null };
  const env = await setup('/course/view.php?id=21357&section=1', { autoResumeCourse: false }, {
    realResume: true,
    docOverrides: { querySelectorAll: selector => selector.startsWith('li.activity') ? [] : [first] },
  });
  const result = await env.controller.handleMessage({ type: 'resume' });
  assert.equal(result.resumedCurrentCourse, true);
  assert.equal(result.waitingForActivities, false);
  const timer = [...env.timers.values()].find(item => item.ms === 500);
  assert.ok(timer);
  timer.callback();
  assert.deepEqual(env.calls.redirects, [first.href]);
  env.controller.destroy();
});

test('a hidden next placeholder on the final PDF reaches the real course return flow', async () => {
  const providerSource = readFileSync(new URL('../src/providers/pttc1.provider.js', import.meta.url), 'utf8')
    .replace('export const pttc1Provider', 'const pttc1Provider');
  const provider = runInContext(`${providerSource}\npttc1Provider;`, createContext({ URL }));
  const placeholder = { id: 'next-activity-link', tagName: 'A', hidden: true,
    textContent: 'Phần Tiếp Theo', getAttribute: name => name === 'href' ? '#' : null };
  const storage = new Map([['vernal:current-course-id', '42']]);
  const env = await setup('/mod/resource/view.php?id=52526&forceview=1', {
    autoNextLesson: true, nextLessonDelaySeconds: 3,
  }, { storage, realResume: true, providerOverrides: { findNextButton: doc => provider.findNextButton(doc) },
    docOverrides: { querySelectorAll: () => [placeholder] } });
  [...env.timers.values()].find(item => item.ms === 3000).callback();
  await settle();
  assert.equal(storage.get('vernal_completed_course_42'), 'true');
  [...env.timers.values()].find(item => item.ms === 500).callback();
  assert.deepEqual(env.calls.redirects, ['/my/courses.php']);
  env.controller.destroy();
});

test('a disabled next link ends the course instead of being clicked', async () => {
  const env = await setup('/mod/quiz/review.php?attempt=9');
  env.provider.findNextButton = () => ({
    isConnected: true, disabled: false, getAttribute: name => name === 'aria-disabled' ? 'true' : null,
    click: () => env.calls.next++,
  });
  await env.controller.handleMessage({ type: 'next' });
  assert.equal(env.calls.verify, 1);
  assert.equal(env.calls.next, 0);
  env.controller.destroy();
});

test('disabled course resume keeps the last activity open instead of returning', async () => {
  const env = await setup('/mod/quiz/review.php?attempt=9', { autoResumeCourse: false });
  env.provider.findNextButton = () => null;
  const result = await env.controller.handleMessage({ type: 'next' });
  assert.equal(result.reason, 'course-finished');
  assert.equal(env.calls.verify, 1);
  assert.equal((await env.controller.handleMessage({ type: 'status' })).courseFinished, true);
  env.controller.destroy();
});

test('last activity returns to courses without waiting for a manual completion marker', async () => {
  const env = await setup('/mod/videotime/view.php?id=1');
  env.provider.findNextButton = () => null;
  let confirmed = false;
  let clicks = 0;
  const mark = {isConnected: true, click: () => clicks++};
  env.doc.querySelector = selector => {
    if (selector.includes('manual:mark-done')) return confirmed ? null : mark;
    if (selector.includes('manual:undo')) return confirmed ? {} : null;
    return null;
  };
  await env.controller.handleMessage({type: 'next'});
  await env.controller.handleMessage({type: 'next'});
  assert.equal(clicks, 0);
  assert.equal(env.calls.verify, 1);
  confirmed = true;
  await env.controller.handleMessage({type: 'next'});
  assert.equal(env.calls.verify, 1);
  env.controller.destroy();
});

test('folder and other passive module pages advance after the configured delay', async () => {
  for (const module of ['folder', 'resource', 'page', 'url', 'book']) {
    for (const seconds of [3, 5]) {
      const env = await setup(`/mod/${module}/view.php?id=1&forceview=1`, {
        autoNextLesson: true, nextLessonDelaySeconds: seconds,
      });
      assert.equal(env.calls.next, 0);
      const timer = [...env.timers.values()].find(item => item.ms === seconds * 1000);
      assert.ok(timer);
      timer.callback();
      await settle();
      assert.equal(env.calls.next, 1);
      env.controller.destroy();
    }
  }
});

test('assignment follows the sequential course flow', async () => {
  const env = await setup('/mod/assign/view.php?id=1&forceview=1', {
    autoNextLesson: true, nextLessonDelaySeconds: 3,
  });
  const timer = [...env.timers.values()].find(item => item.ms === 3000);
  assert.ok(timer);
  env.controller.destroy();
});

test('folder follows Phan Tiep Theo outside the standard navigation wrapper after 3 seconds', async () => {
  const providerSource = readFileSync(new URL('../src/providers/pttc1.provider.js', import.meta.url), 'utf8')
    .replace('export const pttc1Provider', 'const pttc1Provider');
  const provider = runInContext(`${providerSource}\npttc1Provider;`, createContext({}));
  for (const label of ['Phần Tiếp Theo', 'Phần Tiếp Theo'.normalize('NFD'), 'Phần Tiếp Theo \u203a']) {
    let clicks = 0;
    const previous = { textContent: 'Hoạt Động Trước', getAttribute: () => null };
    const next = { textContent: label, isConnected: true, getAttribute: () => null, click: () => clicks++ };
    const env = await setup('/mod/folder/view.php?id=50535&forceview=1', {
      autoNextLesson: true, nextLessonDelaySeconds: 3,
    }, {
      providerOverrides: { findNextButton: doc => provider.findNextButton(doc) },
      docOverrides: { querySelectorAll: selector => selector === 'a, button' ? [previous, next] : [] },
    });
    let creditedMs;
    env.setDelay(async ms => { creditedMs = ms; });
    const timer = [...env.timers.values()].find(item => item.ms === 3000);
    assert.ok(timer);
    assert.equal(clicks, 0);
    timer.callback();
    await settle();
    assert.equal(clicks, 1);
    assert.equal(creditedMs, 3000);
    assert.equal(env.calls.verify, 0);
    env.controller.destroy();
  }
});

test('changing the delay on an open folder preserves time already spent there', async () => {
  const env = await setup('/mod/folder/view.php?id=50535&forceview=1', {
    autoNextLesson: true, nextLessonDelaySeconds: 5,
  });
  const originalTimer = [...env.timers.keys()][0];
  env.setTime(2000);
  env.settings.nextLessonDelaySeconds = 3;
  await env.controller.refreshSettings();
  assert.equal(env.timers.has(originalTimer), false);
  const timer = [...env.timers.values()].find(item => item.ms === 1000);
  assert.ok(timer);
  timer.callback();
  await settle();
  assert.equal(env.calls.next, 1);
  env.controller.destroy();
});

test('disabling auto-next cancels the pending folder timer', async () => {
  const env = await setup('/mod/folder/view.php?id=50535&forceview=1', { autoNextLesson: true });
  env.settings.autoNextLesson = false;
  await env.controller.refreshSettings();
  assert.equal(env.timers.size, 0);
  assert.equal(env.calls.next, 0);
  env.controller.destroy();
});

test('folder navigation without autoplay does not depend on video detection', async () => {
  const env = await setup('/mod/folder/view.php?id=50535&forceview=1', {
    autoNextLesson: true, nextLessonDelaySeconds: 3,
  }, { providerOverrides: { findVideo: () => assert.fail('document navigation should not scan video') } });
  const timer = [...env.timers.values()].find(item => item.ms === 3000);
  assert.ok(timer);
  timer.callback();
  await settle();
  assert.equal(env.calls.next, 1);
  env.controller.destroy();
});

test('read-only forum advances after the delay, posting forum waits for its task', async () => {
  for (const hasTask of [false, true]) {
    const env = await setup('/mod/forum/view.php?id=64089', {autoNextLesson: true, nextLessonDelaySeconds: 3});
    env.setForumTask(hasTask);
    await env.controller.handleMessage({type: 'resume'});
    assert.equal(env.calls.next, 0);
    const timer = [...env.timers.values()].find(item => item.ms === 3000);
    if (hasTask) assert.equal(timer, undefined);
    else {
      assert.ok(timer);
      timer.callback();
      await settle();
      assert.equal(env.calls.next, 1);
    }
    env.controller.destroy();
  }
});

test('a forum posting task appearing during the delay prevents automatic navigation', async () => {
  const env = await setup('/mod/forum/view.php?id=64089', {autoNextLesson: true});
  env.setForumTask(false);
  await env.controller.handleMessage({type: 'resume'});
  const timer = [...env.timers.values()].find(item => item.ms === 5000);
  env.setForumTask(true);
  timer.callback();
  await settle();
  assert.equal(env.calls.next, 0);
  env.controller.destroy();
});

test('forum helper does not call the LLM or create run state for announcements', async () => {
  const forumSource = readFileSync(new URL('../src/content/forum-helper.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  let addButton = null;
  const context = createContext({
    URL, console,
    location: {pathname: '/mod/forum/view.php', href: 'https://lms.pttc1.edu.vn/mod/forum/view.php?id=64089'},
    document: {querySelector: () => addButton, querySelectorAll: () => []},
    sessionStorage: {getItem: () => null, setItem: () => assert.fail('Read-only forum must not start posting')},
    settingsStore: {get: async () => ({forumHelperEnabled: true})},
    browser: {runtime: {sendMessage: () => assert.fail('Read-only forum must not call the LLM')}},
  });
  runInContext(forumSource, context);
  assert.equal(context.forumRequiresTask(), false);
  await context.mountForumHelper();
  addButton = {disabled: false, getAttribute: () => null};
  assert.equal(context.forumRequiresTask(), true);
  addButton.disabled = true;
  assert.equal(context.forumRequiresTask(), false);
});

test('login confirmation logs out once and automatically submits saved credentials on the next document', async () => {
  const storage = new Map();
  let logoutClicks = 0;
  const loginCalls = [];
  const credentials = {pttc1Username: 'saved-user', pttc1Password: 'test-password'};
  const providerOverrides = {
    isLoginPage: loc => loc.pathname === '/login/index.php',
    findLoginLogoutButton: () => ({isConnected: true, click: () => logoutClicks++}),
    login: () => assert.fail('Must log out before submitting credentials'),
  };
  const first = await setup('/login/index.php', {...credentials, pttc1AutoLogin: true}, {storage, providerOverrides});
  assert.equal(logoutClicks, 1);
  assert.equal(storage.get('vernal:login-flow'), 'login');
  await first.controller.handleMessage({type: 'login'});
  assert.equal(logoutClicks, 1);
  assert.equal(first.calls.resumeOptions.length, 0);
  first.controller.destroy();
  const next = await setup('/login/index.php', {...credentials, pttc1AutoLogin: false}, {storage,
    providerOverrides: {...providerOverrides, findLoginLogoutButton: () => null,
      login: payload => { loginCalls.push(payload); return {ok: true}; }},
  });
  assert.equal(loginCalls.length, 1);
  assert.equal(loginCalls[0].username, 'saved-user');
  assert.equal(loginCalls[0].password, 'test-password');
  assert.equal(storage.get('vernal:login-flow'), 'submitted');
  assert.equal(next.calls.mark, 1);
  next.controller.destroy();
  const success = await setup('/my/courses.php', {}, {storage});
  assert.equal(storage.has('vernal:login-flow'), false);
  success.controller.destroy();
});

test('logout landing page returns to the login form without resuming a course', async () => {
  const storage = new Map([['vernal:login-flow', 'login']]);
  const env = await setup('/', {}, {storage});
  assert.deepEqual(env.calls.redirects, ['/login/index.php']);
  assert.equal(env.calls.resumeOptions.length, 0);
  env.controller.destroy();
});

test('missing saved credentials never logs out an existing account', async () => {
  const env = await setup('/login/index.php', {pttc1AutoLogin: true}, {providerOverrides: {
    isLoginPage: () => true,
    findLoginLogoutButton: () => assert.fail('Credentials must be checked first'),
  }});
  const result = await env.controller.handleMessage({type: 'login'});
  assert.equal(result.reason, 'username-missing');
  env.controller.destroy();
});

test('missing saved password reports password specifically', async () => {
  const env = await setup('/login/index.php', {pttc1AutoLogin: true, pttc1Username: 'saved-user'}, {
    providerOverrides: {
      isLoginPage: () => true,
      findLoginLogoutButton: () => assert.fail('Credentials must be checked first'),
    },
  });
  const result = await env.controller.handleMessage({type: 'login'});
  assert.equal(result.reason, 'password-missing');
  env.controller.destroy();
});

test('provider selects Thoat on the logged-in confirmation and never Cancel', () => {
  const providerSource = readFileSync(new URL('../src/providers/pttc1.provider.js', import.meta.url), 'utf8')
    .replace('export const pttc1Provider', 'const pttc1Provider');
  const provider = runInContext(`${providerSource}\npttc1Provider;`, createContext({}));
  const cancel = {textContent: 'Hủy Bỏ', getAttribute: () => null};
  const logout = {textContent: 'Thoát', getAttribute: () => null};
  const doc = {body: {textContent: 'Bạn đã đăng nhập với tên A, cần đăng xuất trước khi đăng nhập làm người dùng khác.'},
    querySelectorAll: () => [cancel, logout]};
  assert.equal(provider.findLoginLogoutButton(doc), logout);
  doc.body.textContent = 'Username Password';
  assert.equal(provider.findLoginLogoutButton(doc), null);
});

test('provider submits login forms with generic Moodle field names', () => {
  const providerSource = readFileSync(new URL('../src/providers/pttc1.provider.js', import.meta.url), 'utf8')
    .replace('export const pttc1Provider', 'const pttc1Provider');
  let submitted = 0;
  const form = {requestSubmit: () => submitted++};
  const username = {
    type: 'text', name: 'loginfmt', id: '', autocomplete: 'username', placeholder: '',
    labels: [], value: '', closest: () => form, dispatchEvent: () => {},
    getAttribute: () => null,
  };
  const password = {
    type: 'password', name: 'passwd', id: '', autocomplete: 'current-password', placeholder: '',
    labels: [], value: '', closest: () => form, dispatchEvent: () => {},
    getAttribute: () => null,
  };
  const document = {
    querySelector: selector => selector.includes('recaptcha') ? null : null,
    querySelectorAll: selector => selector === 'input' ? [username, password] : [],
  };
  const provider = runInContext(`${providerSource}\npttc1Provider;`, createContext({
    document,
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
  }));

  assert.equal(provider.login({username: 'student01', password: 'secret'}).ok, true);
  assert.equal(username.value, 'student01');
  assert.equal(password.value, 'secret');
  assert.equal(submitted, 1);
});
