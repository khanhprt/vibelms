import { settingsStore } from '../shared/settings-store.js';
import { recordLessonFailure } from '../shared/run-log.js';
import { logActivity } from './activity-log.js';
import { requestLlmWithRetry } from '../shared/llm-request.js';

const HELPER_ID = 'vernal-forum-helper';

const FORUM_CONTEXT_KEY = 'vernal_forum_context';
const FORUM_STATE_PREFIX = 'vernal_forum_state_';
const OPEN_TOP_DISCUSSION_KEY = 'vernal_open_top_discussion';

const AUTO_CREATE_FORUM_PREFIX = 'vernal_forum_auto_create_';

// Lưu trạng thái Forum đã hoàn thành reply.
// Dùng storage.local để reload vẫn còn.
const FORUM_REPLY_COMPLETE_PREFIX =
  'vernal_forum_reply_complete_';

// Discussion đang chờ được reply.
const PENDING_REPLY_DISCUSSION_KEY =
  'vernal_pending_reply_discussion';

const submittingReplies = new Set();
const ANNOUNCEMENT_FORUM_PREFIX = 'vernal_forum_announcement_';
// Chỉ sống trong document hiện tại. sessionStorage "running" có thể còn lại sau
// navigation/reload, trong khi tác vụ cũ đã bị browser hủy cùng document đó.
const activeForumCreates = new Set();

function currentForumId() {
  const url = new URL(location.href);
  if (url.pathname.endsWith('/view.php')) return url.searchParams.get('id');
  if (url.searchParams.get('forum')) return url.searchParams.get('forum');
  const link = document.querySelector('.breadcrumb a[href*="/mod/forum/view.php"], [aria-label="breadcrumb"] a[href*="/mod/forum/view.php"]');
  return link?.href ? new URL(link.href, location.href).searchParams.get('id') : null;
}

function isAnnouncementForum() {
  if (!location.pathname.startsWith('/mod/forum/')) return false;
  const forumId = currentForumId();
  if (forumId && sessionStorage.getItem(`${ANNOUNCEMENT_FORUM_PREFIX}${forumId}`) === 'true') return true;
  const labels = [...document.querySelectorAll(
    '#page-header h1, #page-header h2, .page-header-headings h1, .page-header-headings h2, #region-main > h1, #region-main > h2, #region-main .activity-header h1, #region-main .activity-header h2, .breadcrumb a[href*="/mod/forum/view.php"], [aria-label="breadcrumb"] a[href*="/mod/forum/view.php"], .breadcrumb-item:last-child, [aria-label="breadcrumb"] li:last-child',
  )];
  const announcement = labels.some(node =>
    /^(?:(?:diễn đàn\s+)?thông báo|announcements?|news(?: forum)?)$/i.test(clean(node.textContent).normalize('NFC')),
  );
  if (announcement && forumId) sessionStorage.setItem(`${ANNOUNCEMENT_FORUM_PREFIX}${forumId}`, 'true');
  return announcement;
}

function findAddTopicButton() {
  return document.querySelector('a[data-toggle="collapse"][href="#collapseAddForm"], button[data-target="#collapseAddForm"], a[href*="/mod/forum/post.php?forum="]') ||
    [...document.querySelectorAll('a, button')].find((element) =>
      /thêm một chủ đề thảo luận mới|add a new discussion topic/i.test(clean(element.textContent)),
    );
}

export function forumRequiresTask() {
  if (isAnnouncementForum()) return false;
  if (location.pathname.startsWith('/mod/forum/post.php')) return true;
  if (location.pathname.startsWith('/mod/forum/discuss.php')) return Boolean(replyButton());
  if (!location.pathname.startsWith('/mod/forum/view.php')) return false;
  const forumId = new URL(location.href).searchParams.get('id') || location.pathname;
  const button = findAddTopicButton();
  return Boolean(button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') ||
    Boolean(sessionStorage.getItem(`${AUTO_CREATE_FORUM_PREFIX}${forumId}`)) ||
    sessionStorage.getItem(OPEN_TOP_DISCUSSION_KEY) === 'true';
}

export async function isCurrentForumCompleted() {
  if (!location.pathname.startsWith('/mod/forum/discuss.php')) return false;
  const discussionId = getDiscussionId();
  if (submittingReplies.has(discussionId)) return false;
  const completed = await isForumReplyCompleted(discussionId);
  return completed && !submittingReplies.has(discussionId);
}

const clean = (value) =>
  (value || '')
    .replace(/\s+/g, ' ')
    .trim();

function extractDraft(response) {
  const content =
    response?.choices?.[0]?.message?.content ??
    response?.content ??
    response?.draft ??
    '';

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;

        return (
          item?.text ||
          item?.content ||
          ''
        );
      })
      .join('');
  }

  return String(content || '');
}

function normalizeDraftJson(content) {
  const withoutFence = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  if (!withoutFence) return '';

  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return withoutFence.slice(firstBrace, lastBrace + 1).trim();
  }

  return withoutFence;
}


function parseDraft(response) {
  if (response?.error) throw new Error(response.error);
  const content = extractDraft(response);

  console.group('===== FORUM LLM RESPONSE =====');
  console.log('FULL RESPONSE:', response);
  console.log('CONTENT:', content);
  console.groupEnd();

  if (!content || !content.trim()) {
    throw new Error(
      'LLM trả về content rỗng.'
    );
  }

  const raw = normalizeDraftJson(content);

  if (!raw) {
    throw new Error(
      'LLM trả về JSON rỗng.'
    );
  }

  let draft;

  try {
    draft = JSON.parse(raw);
  } catch {
    console.error(
      'Không parse được JSON forum:',
      raw
    );

    throw new Error(
      `LLM trả về JSON không hợp lệ: ${raw}`
    );
  }

  if (typeof draft?.title !== 'string' || !draft.title.trim() ||
    typeof draft?.content !== 'string' || !draft.content.trim()) {
    throw new Error(
      'LLM không trả về đủ title và content.'
    );
  }

  return {
    title: clean(draft.title),
    // Keep paragraphs in the generated post; only trim the surrounding whitespace.
    content: String(draft.content).trim(),
  };
}

function getLearningContext() {
  const crumbs = [
    ...document.querySelectorAll(
      '.breadcrumb-item, [aria-label="breadcrumb"] li'
    ),
  ]
    .map((item) => clean(item.textContent))
    .filter(Boolean);

  const pageTitle =
    clean(
      document.querySelector(
        '#page-header h1, .page-header-headings h1, h1'
      )?.textContent
    ) ||
    clean(document.title);

  let courseName = null;
  let chapterName = null;

  // Moodle thường có breadcrumb kiểu:
  //
  // Trang chủ
  // > Tên môn
  // > Tên chương / tên Forum
  //
  // Ta ưu tiên 2 phần tử cuối.

  if (crumbs.length >= 2) {
    courseName =
      crumbs[crumbs.length - 2] || null;

    chapterName =
      crumbs[crumbs.length - 1] || null;
  }

  // Nếu không lấy được chapter từ breadcrumb
  // thì fallback sang tiêu đề trang.
  if (!chapterName) {
    chapterName = pageTitle;
  }

  return {
    courseName,
    chapterName,
    pageTitle,
    url: location.href,
  };
}

function readForumPageContext() {
  const main =
    document.querySelector('#region-main');

  const text = clean(
    main?.innerText ||
    document.body?.innerText ||
    ''
  );

  return text.slice(0, 8000);
}

function coursePageUrl() {
  const link = [...document.querySelectorAll('a[href*="/course/view.php?id="]')].find(
    (anchor) => anchor.href,
  );
  if (link?.href) return link.href;

  // Moodle puts the current course id on <body> even when this Forum page does
  // not expose a breadcrumb link back to the course.
  const courseId = document.body.className.match(/\bcourse-(\d+)\b/)?.[1];
  return courseId ? `${location.origin}/course/view.php?id=${courseId}` : null;
}

// A forum page only identifies the forum itself. Look up the matching activity on
// the course page, where Moodle groups it with the actual chapter/section content.
async function getForumSectionContext() {
  const forumId = new URL(location.href).searchParams.get('id');
  const courseUrl = coursePageUrl();
  if (!forumId || !courseUrl) return null;

  try {
    const response = await fetch(courseUrl, { credentials: 'same-origin' });
    if (!response.ok) return null;
    const page = new DOMParser().parseFromString(await response.text(), 'text/html');
    const activity = [...page.querySelectorAll('a[href*="/mod/forum/view.php"]')].find((link) => {
      try {
        return new URL(link.href, courseUrl).searchParams.get('id') === forumId;
      } catch {
        return false;
      }
    });
    const section = activity?.closest(
      '.course-section, li.section, [id^="section-"], .section',
    );
    if (!section) return null;

    const chapterName = clean(
      section.querySelector('.sectionname, .course-section-header, h1, h2, h3, h4')?.textContent,
    );
    const context = clean(section.textContent).slice(0, 6000);
    return chapterName || context ? { chapterName, context } : null;
  } catch {
    // The regular forum-page context remains available as a safe fallback.
    return null;
  }
}

function saveForumContext(context) {
  try {
    console.log(
      'Đã lưu Forum context:',
      context
    );
  } catch (error) {
    console.warn(
      'Không lưu được Forum context:',
      error
    );
  }
}


async function collectForumContext() {
  const learningContext = getLearningContext();
  const sectionContext = await getForumSectionContext();

  return {
    ...learningContext,
    chapterName: sectionContext?.chapterName || learningContext.chapterName,
    // Never send the entire forum-index page if its course section was found:
    // it often lists discussions from unrelated chapters.
    context: sectionContext?.context || readForumPageContext(),

    savedAt: new Date().toISOString(),
  };
}

async function applyPendingForumDraft() {
  if (isAnnouncementForum()) return false;
  const {
    vernalForumDraft: draft
  } = await browser.storage.local.get(
    'vernalForumDraft'
  );

  if (!draft) {
    return false;
  }

  console.log(
    '[FORUM POST] Có pending reply draft:',
    draft
  );

  const subject =
    document.querySelector(
      '#id_subject, input[name="subject"]'
    );

  const message =
    document.querySelector(
      'textarea[name="message"], textarea[name*="message" i], textarea'
    );

  if (!message) {
    console.log(
      '[FORUM POST] Chưa tìm thấy message textarea.'
    );

    return false;
  }

  // ================================
  // 1. ĐIỀN DRAFT
  // ================================

  await fillDiscussionForm(
    {
      subject,
      message
    },
    draft
  );

  console.log(
    '[FORUM POST] Đã điền pending draft.'
  );

  await new Promise(resolve =>
    setTimeout(resolve, 700)
  );

  // ================================
  // 2. TÌM FORM
  // ================================

  const form =
    message.form ||
    subject?.form ||
    document.querySelector('#mformforum') ||
    document.querySelector('form');

  // ================================
  // 3. TÌM NÚT ĐĂNG
  // ================================

  const submitButton =
    form?.querySelector(
      'input[type="submit"][name="submitbutton"]'
    ) ||
    form?.querySelector(
      'button[type="submit"][name="submitbutton"]'
    ) ||
    form?.querySelector(
      'input[type="submit"]'
    ) ||
    form?.querySelector(
      'button[type="submit"]'
    ) ||
    [...document.querySelectorAll(
      'button, input[type="submit"]'
    )].find((element) => {
      const text = clean(
        element.textContent ||
        element.value ||
        element.title ||
        ''
      );

      return (
        /gửi bài viết lên diễn đàn/i.test(text) ||
        /gửi bài lên diễn đàn/i.test(text) ||
        /đăng bài lên diễn đàn/i.test(text) ||
        /post to forum/i.test(text) ||
        /post to the forum/i.test(text)
      );
    });

  if (!submitButton) {
    throw new Error(
      'Không tìm thấy nút "Đăng bài lên diễn đàn" ở trang post.php.'
    );
  }

  // =====================================
  // LẤY DISCUSSION ĐANG ĐƯỢC PHÚC ĐÁP
  // =====================================

  const pending =
    await browser.storage.local.get(
      PENDING_REPLY_DISCUSSION_KEY
    );

  const discussionId =
    pending[PENDING_REPLY_DISCUSSION_KEY];

  // =====================================
  // ĐÁNH DẤU HOÀN THÀNH
  // TRƯỚC KHI MOODLE NAVIGATE
  // =====================================

  if (discussionId) {
    await markForumReplyCompleted(
      discussionId
    );

    console.log(
      '[FORUM POST] Forum COMPLETED:',
      discussionId
    );
  }

  // Draft không còn cần nữa
  await browser.storage.local.remove(
    'vernalForumDraft'
  );

  // Pending cũng hoàn thành
  await browser.storage.local.remove(
    PENDING_REPLY_DISCUSSION_KEY
  );

  console.log(
    '[FORUM POST] Click Gửi Bài Viết Lên Diễn Đàn...'
  );

  if (isAnnouncementForum()) return false;
  submitButton.click();

  return true;
}

function waitForDiscussionForm(timeoutMs = 4_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const subject = document.querySelector('#mformforum #id_subject, #id_subject');
      const message = document.querySelector('#mformforum #id_message, #id_message');
      if (subject && message) return resolve({ subject, message });
      if (Date.now() - startedAt >= timeoutMs)
        return reject(new Error('Form tạo chủ đề chưa sẵn sàng. Hãy thử lại.'));
      window.setTimeout(check, 100);
    };
    check();
  });
}

function waitForReplyForm(timeoutMs = 4_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const message = document.querySelector(
        '#region-main textarea[placeholder*="Viết câu trả lời"], textarea#id_message, textarea[name*="message" i], #region-main textarea',
      );
      if (message) return resolve({ subject: null, message });
      if (Date.now() - startedAt >= timeoutMs)
        return reject(new Error('Form Phúc đáp chưa sẵn sàng. Hãy thử lại.'));
      window.setTimeout(check, 100);
    };
    check();
  });
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}

function discussionContentHtml(content) {
  return content
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

async function fillDiscussionForm({ subject, message }, draft) {
  if (isAnnouncementForum()) return;
  if (subject) {
    subject.value = draft.title;
    const form = subject.form;
    if (form && !form.dataset.vernalOpenTopOnSubmit) {
      form.dataset.vernalOpenTopOnSubmit = 'true';
      form.addEventListener('submit', () => {
        // Only arm this after the user explicitly submits their new topic.
        sessionStorage.setItem(OPEN_TOP_DISCUSSION_KEY, 'true');
      });
    }
  }
  message.value = draft.content;
  if (subject) subject.dispatchEvent(new Event('input', { bubbles: true }));
  if (subject) subject.dispatchEvent(new Event('change', { bubbles: true }));
  message.dispatchEvent(new Event('input', { bubbles: true }));
  message.dispatchEvent(new Event('change', { bubbles: true }));

  // Content scripts run in an isolated world, so window.tinymce may be hidden
  // from us. Moodle's TinyMCE still exposes its same-origin editor iframe in the
  // DOM; update it directly and keep the submitted textarea in sync.
  const html = discussionContentHtml(draft.content);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const iframe = document.querySelector(
      `#${CSS.escape(message.id)}_ifr, .tox-edit-area iframe`,
    );
    const editorBody = iframe?.contentDocument?.body;
    if (editorBody) {
      editorBody.innerHTML = html;
      editorBody.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      message.value = draft.content;
      message.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
}

function discussionQuestion() {
  const post = document.querySelector(
    '#region-main .forumpost, #region-main [data-content="forum-post"], #region-main article',
  );
  return clean(post?.innerText || post?.textContent || '').slice(0, 6_000);
}

function replyButton() {
  const links = [...document.querySelectorAll('a[href*="/mod/forum/post.php?reply="], a[href*="reply="]')];
  return links.find((link) => /phúc đáp|reply/i.test(clean(link.textContent || link.title))) || links[0];
}

function getDiscussionId() {
  const url = new URL(location.href);

  // discuss.php?d=123
  const discussionId = url.searchParams.get('d');

  if (discussionId) {
    return discussionId;
  }

  return null;
}

function forumReplyCompleteKey(discussionId) {
  return `${FORUM_REPLY_COMPLETE_PREFIX}${discussionId}`;
}

async function isForumReplyCompleted(discussionId) {
  if (!discussionId) return false;

  const key = forumReplyCompleteKey(discussionId);

  const result =
    await browser.storage.local.get(key);

  return result[key] === true;
}

async function markForumReplyCompleted(discussionId) {
  if (!discussionId) return;

  // The current document is still submitting; consume completion after navigation.
  submittingReplies.add(discussionId);

  const key =
    forumReplyCompleteKey(discussionId);

  await browser.storage.local.set({
    [key]: true
  });

  console.log(
    '[FORUM] ĐÃ HOÀN THÀNH TOÀN BỘ FORUM:',
    discussionId
  );
}

async function mountDiscussionReplyHelper() {
  if (isAnnouncementForum()) return;
  const discussionId = getDiscussionId();

  if (!discussionId) {
    console.warn(
      '[FORUM REPLY] Không lấy được discussionId.'
    );
    return;
  }

  // =====================================
  // KIỂM TRA FORUM NÀY ĐÃ HOÀN THÀNH CHƯA
  // =====================================

  if (
    await isForumReplyCompleted(
      discussionId
    )
  ) {
    console.log(
      '[FORUM REPLY] Forum đã hoàn thành:',
      discussionId
    );

    // Sau này gọi chuyển activity tiếp theo tại đây.
    //
    // await goToNextActivity();

    return;
  }

  const replyRunKey =
    `vernal_forum_reply_running_${discussionId}`;

  if (
    sessionStorage.getItem(replyRunKey) ===
    'running'
  ) {
    console.log(
      '[FORUM REPLY] Đang xử lý, bỏ qua.'
    );

    return;
  }

  sessionStorage.setItem(
    replyRunKey,
    'running'
  );

  try {
    console.log('[FORUM REPLY] Bắt đầu tự động soạn phản hồi...');
    logActivity('info', 'Bắt đầu soạn phản hồi forum bằng AI');

    // ================================
    // 1. ĐỌC NỘI DUNG DISCUSSION
    // ================================

    const question = discussionQuestion();

    if (!question) {
      throw new Error(
        'Không đọc được nội dung discussion.'
      );
    }

    console.log(
      '[FORUM REPLY] Nội dung discussion:',
      question
    );

    // ================================
    // 2. TÌM NÚT PHÚC ĐÁP
    // ================================

    const reply = replyButton();

    if (!reply) {
      throw new Error(
        'Không tìm thấy nút Phúc đáp của discussion này.'
      );
    }

    console.log(
      '[FORUM REPLY] Đã tìm thấy nút Phúc đáp:',
      reply
    );

    // ================================
    // 3. LẤY CONTEXT
    // ================================

    const {
      courseName,
      chapterName
    } = getLearningContext();

    // ================================
    // 4. GỌI AI SOẠN PHẢN HỒI
    // ================================

    console.log(
      '[FORUM REPLY] Đang gọi AI tạo phản hồi...'
    );

    if (isAnnouncementForum()) return;
    const draft =
      await requestLlmWithRetry({
        type: 'GENERATE_FORUM_REPLY',
        payload: {
          courseName,
          chapterName,
          question
        },
      }, { parse: parseDraft, shouldContinue: () => !isAnnouncementForum() });
    if (!draft) return;

    console.log(
      '[FORUM REPLY] Draft:',
      draft
    );

    // Lưu draft đề phòng reply.click() chuyển sang post.php
    await browser.storage.local.set({
      vernalForumDraft: draft
    });

    // ================================
    // 5. TỰ CLICK PHÚC ĐÁP
    // ================================

    console.log(
      '[FORUM REPLY] Click nút Phúc đáp...'
    );

    await browser.storage.local.set({
      [PENDING_REPLY_DISCUSSION_KEY]:
        discussionId
    });

    console.log(
      '[FORUM REPLY] Lưu pending discussion:',
      discussionId
    );

    if (isAnnouncementForum()) return;
    logActivity('info', 'Đã chọn phúc đáp chủ đề forum');
    reply.click();

    // ================================
    // 6. CHỜ FORM REPLY
    // ================================

    let form;

    try {
      form = await waitForReplyForm(8000);
    } catch {
      // Nếu Moodle navigate sang /post.php thì document hiện tại
      // có thể bị unload; applyPendingForumDraft() sẽ xử lý ở trang mới.
      console.log(
        '[FORUM REPLY] Có thể Moodle đang chuyển sang post.php.'
      );

      return;
    }

    console.log(
      '[FORUM REPLY] Đã mở form Phúc đáp:',
      form
    );

    // ================================
    // 7. TỰ ĐIỀN PHẢN HỒI
    // ================================

    await fillDiscussionForm(
      form,
      {
        content: draft.content
      }
    );

    await browser.storage.local.remove(
      'vernalForumDraft'
    );

    console.log(
      '[FORUM REPLY] Đã điền nội dung phản hồi.'
    );

    // Cho TinyMCE đồng bộ
    await new Promise(resolve =>
      setTimeout(resolve, 700)
    );

    // ================================
    // 8. TÌM FORM + NÚT SUBMIT
    // ================================

    const replyForm =
      form.message?.form ||
      document.querySelector('#mformforum');

    // Chờ Moodle render button hoàn chỉnh
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('[FORUM REPLY] Bắt đầu tìm nút Gửi Bài Viết Lên Diễn Đàn...');

    // ==================================================
    // ƯU TIÊN TÌM ĐÚNG BUTTON THEO TEXT
    // ==================================================

    const allSubmitButtons = [
      ...(replyForm || document).querySelectorAll(
        'button, input[type="submit"], input[type="button"]'
      )
    ];

    console.log(
      '[FORUM REPLY] Các button tìm thấy:',
      allSubmitButtons.map(element => ({
        tag: element.tagName,
        text: clean(
          element.textContent ||
          element.value ||
          element.title ||
          ''
        ),
        type: element.type,
        name: element.name,
        id: element.id
      }))
    );

    const submitButton = allSubmitButtons.find(element => {
      const text = clean(
        element.textContent ||
        element.value ||
        element.title ||
        ''
      ).toLowerCase();

      return (
        text.includes('gửi bài viết lên diễn đàn') ||
        text.includes('gửi bài lên diễn đàn') ||
        text.includes('đăng bài lên diễn đàn') ||
        text.includes('post to forum') ||
        text.includes('post to the forum')
      );
    });

    if (!submitButton) {
      throw new Error(
        'Không tìm thấy nút "Gửi Bài Viết Lên Diễn Đàn".'
      );
    }

    console.log(
      '[FORUM REPLY] ĐÃ TÌM THẤY BUTTON:',
      submitButton
    );

    // ==================================================
    // ĐÁNH DẤU ĐÃ XỬ LÝ
    // ==================================================

    sessionStorage.setItem(
      replyRunKey,
      'done'
    );

    // ==================================================
    // CLICK BUTTON
    // ==================================================

    console.log(
      '[FORUM REPLY] CLICK Gửi Bài Viết Lên Diễn Đàn'
    );

    submitButton.scrollIntoView({
      behavior: 'instant',
      block: 'center'
    });

    // Đảm bảo button không đang disabled
    if (submitButton.disabled) {
      throw new Error(
        'Nút Gửi Bài Viết Lên Diễn Đàn đang bị disabled.'
      );
    }

    await markForumReplyCompleted(
      discussionId
    );

    await browser.storage.local.remove(
      PENDING_REPLY_DISCUSSION_KEY
    );

    sessionStorage.removeItem(
      replyRunKey
    );

    console.log(
      '[FORUM REPLY] COMPLETED = true'
    );


    if (isAnnouncementForum()) return;
    logActivity('info', 'Đang gửi phản hồi forum lên diễn đàn');
    submitButton.click();

    console.log(
      '[FORUM REPLY] Đã gọi submitButton.click()'
    );

  } catch (error) {
    sessionStorage.removeItem(
      replyRunKey
    );
    logActivity('error', 'Tự phúc đáp forum thất bại', error.message || String(error));
    await recordLessonFailure(error.message || String(error), {stage: 'forum-reply'});

    console.error(
      '[FORUM REPLY] ERROR:',
      error
    );
  }
}

function openTopDiscussionAfterSubmit() {
  if (isAnnouncementForum()) return false;
  if (!location.pathname.startsWith('/mod/forum/view.php')) return false;
  if (sessionStorage.getItem(OPEN_TOP_DISCUSSION_KEY) !== 'true') return false;
  sessionStorage.removeItem(OPEN_TOP_DISCUSSION_KEY);
  const discussion = document.querySelector(
    '#discussion-list a[href*="/mod/forum/discuss.php?d="], a[href*="/mod/forum/discuss.php?d="]',
  );
  if (!discussion) return false;
  discussion.click();
  return true;
}

async function autoCreateForumDiscussion() {
  if (isAnnouncementForum()) return false;
  // Chỉ chạy ở trang chính Forum
  if (!location.pathname.startsWith('/mod/forum/view.php')) {
    return false;
  }

  const forumId =
    new URL(location.href).searchParams.get('id') ||
    location.pathname;

  const runKey = `${AUTO_CREATE_FORUM_PREFIX}${forumId}`;

  // Không cho MutationObserver gọi lại LLM nhiều lần
  if (sessionStorage.getItem(runKey) === 'running') {
    if (activeForumCreates.has(runKey)) {
      console.log('Forum auto-create đang chạy, bỏ qua.');
      return true;
    }
    sessionStorage.removeItem(runKey);
    logActivity('warn', 'Đã dọn cờ tạo forum bị kẹt từ trang trước', `cmid ${forumId}`);
  }

  if (sessionStorage.getItem(runKey) === 'done') {
    console.log('Forum này đã xử lý xong trong session hiện tại.');
    return true;
  }

  const addTopicButton = findAddTopicButton();
  // Announcement/read-only forums have no posting task.
  if (!addTopicButton || addTopicButton.disabled || addTopicButton.getAttribute('aria-disabled') === 'true') return false;

  sessionStorage.setItem(runKey, 'running');
  activeForumCreates.add(runKey);

  try {
    console.log('Phát hiện trang Forum. Bắt đầu tự tạo chủ đề...');
    logActivity('info', 'Bắt đầu tự tạo chủ đề forum bằng AI');

    // ================================
    // 1. TÌM NÚT THÊM CHỦ ĐỀ MỚI
    // ================================

    const addForm = document.querySelector('#collapseAddForm');

    // ================================
    // 2. TỰ MỞ FORM
    // ================================

    if (!addForm?.classList.contains('show')) {
      console.log('Đang mở form tạo chủ đề...');
      addTopicButton.click();
    }

    // Chờ Moodle render form
    const form = await waitForDiscussionForm();

    console.log('Đã mở form tạo chủ đề.');

    // ================================
    // 3. ĐỌC CONTEXT
    // ================================

    if (isAnnouncementForum()) return false;
    const forumContext = await collectForumContext();

    saveForumContext(forumContext);

    console.log(
      'Đang gửi context Forum sang LLM:',
      forumContext
    );

    // ================================
    // 4. GỌI LLM
    // ================================

    if (isAnnouncementForum()) return false;
    const draft = await requestLlmWithRetry({
      type: 'GENERATE_DISCUSSION',
      payload: forumContext,
    }, { parse: parseDraft, shouldContinue: () => !isAnnouncementForum() });
    if (!draft) return false;

    console.log('Forum draft:', draft);

    // ================================
    // 5. TỰ ĐIỀN TITLE + CONTENT
    // ================================

    await fillDiscussionForm(form, draft);

    console.log('Đã điền xong nội dung Forum.');

    // Đợi UI/TinyMCE đồng bộ dữ liệu một chút
    await new Promise((resolve) =>
      setTimeout(resolve, 500)
    );

    // ================================
    // 6. TÌM NÚT ĐĂNG BÀI
    // ================================

    const discussionForm =
      form.subject?.form ||
      form.message?.form ||
      document.querySelector('#mformforum');

    const submitButton =
      discussionForm?.querySelector(
        'input[type="submit"][name="submitbutton"]'
      ) ||
      discussionForm?.querySelector(
        'button[type="submit"][name="submitbutton"]'
      ) ||
      discussionForm?.querySelector(
        'input[type="submit"]'
      ) ||
      discussionForm?.querySelector(
        'button[type="submit"]'
      ) ||
      [...document.querySelectorAll('button, input[type="submit"]')].find(
        (element) => {
          const text = clean(
            element.textContent ||
            element.value ||
            element.title ||
            ''
          );

          return /đăng bài lên diễn đàn|post to forum|post to the forum/i.test(
            text
          );
        }
      );

    if (!submitButton) {
      throw new Error(
        'Đã điền bài viết nhưng không tìm thấy nút "Đăng bài lên diễn đàn".'
      );
    }

    console.log(
      'Đã tìm thấy nút đăng bài:',
      submitButton
    );

    // ================================
    // 7. ĐÁNH DẤU ĐỂ SAU KHI SUBMIT
    //    TỰ MỞ DISCUSSION VỪA TẠO
    // ================================

    sessionStorage.setItem(
      OPEN_TOP_DISCUSSION_KEY,
      'true'
    );

    // Đánh dấu hoàn thành trước khi navigation
    sessionStorage.setItem(runKey, 'done');

    console.log('Đang tự động đăng bài lên diễn đàn...');

    // ================================
    // 8. CLICK ĐĂNG BÀI
    // ================================

    if (isAnnouncementForum()) return false;
    logActivity('info', 'Đang đăng chủ đề forum lên diễn đàn');
    submitButton.click();

    return true;
  } catch (error) {
    sessionStorage.removeItem(runKey);
    logActivity('error', 'Tự tạo chủ đề forum thất bại', error.message || String(error));
    await recordLessonFailure(error.message || String(error), {stage: 'forum-create'});

    console.error(
      'Không thể tự động tạo Forum:',
      error
    );

    return false;
  } finally {
    activeForumCreates.delete(runKey);
  }
}

export async function mountForumHelper() {
  if (!location.pathname.startsWith('/mod/forum/')) {
    return;
  }
  if (isAnnouncementForum()) {
    const forumId = currentForumId();
    if (forumId) sessionStorage.removeItem(`${AUTO_CREATE_FORUM_PREFIX}${forumId}`);
    sessionStorage.removeItem(OPEN_TOP_DISCUSSION_KEY);
    document.querySelector(`#${HELPER_ID}`)?.remove();
    return;
  }
  const { forumHelperEnabled } = await settingsStore.get();
  if (!forumHelperEnabled) {
    document.querySelector(`#${HELPER_ID}`)?.remove();
    return;
  }

  // Nếu đang ở trang post.php sau khi navigation,
  // thử áp dụng draft đã lưu trước.
  if (location.pathname.startsWith('/mod/forum/post.php')) {
    try {
      await applyPendingForumDraft();
    } catch (error) {
      logActivity('error', 'Gửi chủ đề forum thất bại', error.message || String(error));
      await recordLessonFailure(error.message || String(error), {stage: 'forum-submit'});
      console.error('Forum submission failed:', error);
    }
    return;
  }

  // Sau khi user gửi topic, code cũ của bạn sẽ mở discussion vừa tạo.
  if (openTopDiscussionAfterSubmit()) {
    return;
  }

  // Nếu đang ở bên trong một discussion thì vẫn giữ helper reply hiện tại.
  if (location.pathname.startsWith('/mod/forum/discuss.php')) {
    if (!forumRequiresTask()) return;
    await mountDiscussionReplyHelper();
    return;
  }

  // ==============================
  // TRANG CHÍNH FORUM
  // ==============================
  //
  // Không hiện nút extension nữa.
  // Vào Forum là tự động mở "Thêm chủ đề mới"
  // và gọi AI tạo nội dung.
  //
  await autoCreateForumDiscussion();
}
