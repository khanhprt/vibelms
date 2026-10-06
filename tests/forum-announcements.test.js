import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../src/content/forum-helper.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');

function setup(path, title, { breadcrumb = false, storage = new Map() } = {}) {
  let label = title;
  let adds = 0;
  const forumLink = { href: 'https://lms.pttc1.edu.vn/mod/forum/view.php?id=61340', textContent: title };
  const addButton = { disabled: false, getAttribute: () => null, click: () => assert.fail('Announcements must not open posting forms') };
  const url = new URL(`https://lms.pttc1.edu.vn${path}`);
  const context = createContext({ URL, console,
    location: { pathname: url.pathname, href: url.href },
    document: {
      querySelector: selector => {
        if (selector.startsWith('.breadcrumb a')) return breadcrumb ? forumLink : null;
        if (selector.startsWith('a[data-toggle')) { adds++; return addButton; }
        return null;
      },
      querySelectorAll: selector => selector.startsWith('#page-header h1')
        ? (breadcrumb ? [forumLink] : [{ textContent: label }]) : [],
    },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    settingsStore: { get: async () => ({ forumHelperEnabled: true }) },
    browser: {
      runtime: { sendMessage: () => assert.fail('Announcements must not call the LLM') },
      storage: { local: { get: () => assert.fail('Announcements must not apply pending drafts') } },
    },
  });
  runInContext(source, context);
  return { context, storage, adds: () => adds, setTitle: value => { label = value; } };
}

test('Thong bao with a working Add topic button is skipped even with stale posting state', async () => {
  for (const title of ['Thông báo', 'THÔNG BÁO', 'Thông báo'.normalize('NFD'), 'Announcements', 'News forum']) {
    const storage = new Map([
      ['vernal_forum_auto_create_61340', 'running'], ['vernal_open_top_discussion', 'true'],
    ]);
    const env = setup('/mod/forum/view.php?id=61340', title, { storage });
    assert.equal(env.context.forumRequiresTask(), false);
    await env.context.mountForumHelper();
    assert.equal(env.adds(), 0);
    assert.equal(storage.has('vernal_forum_auto_create_61340'), false);
    assert.equal(storage.has('vernal_open_top_discussion'), false);
  }
});

test('announcement protection also applies to discussion replies and pending post drafts', async () => {
  for (const path of ['/mod/forum/discuss.php?d=10', '/mod/forum/post.php?reply=20', '/mod/forum/post.php?forum=61340']) {
    const env = setup(path, 'Thông báo', { breadcrumb: true });
    assert.equal(env.context.forumRequiresTask(), false);
    await env.context.mountForumHelper();
    assert.equal(await env.context.applyPendingForumDraft(), false);
    await env.context.mountDiscussionReplyHelper();
  }
});

test('remembered announcement forum stays protected on a post page without its title', async () => {
  const env = setup('/mod/forum/view.php?id=61340', 'Thông báo');
  assert.equal(env.context.forumRequiresTask(), false);
  const post = setup('/mod/forum/post.php?forum=61340', 'Thêm chủ đề', { storage: env.storage });
  assert.equal(post.context.forumRequiresTask(), false);
  await post.context.mountForumHelper();
});

test('regular discussion forums with Add topic still require a task', () => {
  const env = setup('/mod/forum/view.php?id=42', 'Thảo luận nhóm');
  assert.equal(env.context.forumRequiresTask(), true);
  assert.equal(env.adds(), 1);
});

test('an announcement title appearing while the form loads prevents the LLM request and submission', async () => {
  const env = setup('/mod/forum/view.php?id=61340', 'Thảo luận');
  let clicks = 0;
  const add = { disabled: false, getAttribute: () => null, click: () => clicks++ };
  env.context.document.querySelector = selector => selector.startsWith('a[data-toggle') ? add : null;
  env.context.waitForDiscussionForm = async () => {
    env.setTitle('Thông báo');
    return { subject: {}, message: {} };
  };
  assert.equal(await env.context.autoCreateForumDiscussion(), false);
  assert.equal(clicks, 1);
});
