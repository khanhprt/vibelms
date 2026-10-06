const HOSTNAME = 'lms.pttc1.edu.vn';
// Video nhúng thường nằm trong iframe khác origin (YouTube/Vimeo) — không đọc được DOM
// của iframe đó, nên nhận diện qua src để vẫn coi đây là trang có video.
const VIDEO_FRAME_PATTERN =
  /(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com|vimeo\.com|dailymotion\.com|jwplayer|flowplayer|brightcove|html5player|\.m3u8|\.mp4|\.webm)/i;

function text(selector) {
  return document.querySelector(selector)?.textContent?.trim() || '';
}

function videoFrames(doc) {
  return [...doc.querySelectorAll('iframe')].filter((frame) =>
    VIDEO_FRAME_PATTERN.test(frame.src || ''),
  );
}

function frameVideoIn(frame) {
  try {
    return frame.contentDocument?.querySelector('video') || null;
  } catch {
    return null; // iframe khác origin: contentDocument bị chặn.
  }
}

function findLoginInput(doc, selectors, keywords = []) {
  const direct = doc.querySelector(selectors);
  if (direct) return direct;

  return [...doc.querySelectorAll('input')].find((input) => {
    const type = (input.type || '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button') return false;
    const haystack = [
      input.name,
      input.id,
      input.autocomplete,
      input.placeholder,
      input.getAttribute?.('aria-label'),
      input.labels ? [...input.labels].map((label) => label.textContent).join(' ') : '',
    ].join(' ').normalize('NFC');
    return keywords.some((keyword) => keyword.test(haystack));
  }) || null;
}

function findLoginForm(doc, usernameInput, passwordInput) {
  return (
    usernameInput?.closest?.('form') ||
    passwordInput?.closest?.('form') ||
    doc.querySelector('#login, form[action*="login" i], form[action*="signin" i], form[action*="auth" i]') ||
    null
  );
}

// Moodle dựng nút bắt đầu bài trong .single_button. Nhãn đổi theo tình huống:
// "Attempt quiz" khi mới, "Continue your attempt" / "Tiếp tục làm bài" khi đang làm dở.
// Nút thật của PTTC1 là <button type="submit" id="single_button<hash>"> — không có
// thuộc tính name, nên cần bắt theo id để không phụ thuộc nhãn.
const QUIZ_START_SELECTORS = [
  'a[href*="/mod/quiz/attempt.php"]',
  'button[id^="single_button"]',
  'input[id^="single_button"]',
  '#startquizbutton',
  'button[name="startattempt"]',
  'input[name="startattempt"]',
  '.single_button button',
  '.single_button a[href]',
  '.single_button input[type="submit"]',
].join(', ');
// Nhãn tiếng Việt có thể đến dạng NFD (dấu tách rời) trong khi regex viết dạng NFC, nên
// phải chuẩn hóa chuỗi cần tìm trước khi so — nếu không sẽ khớp một cách âm thầm sai.
const QUIZ_START_TEXT = /attempt|continue|bắt đầu|làm bài|bài làm|tiếp tục|tiếp/i;
const matchesStartText = (value) =>
  QUIZ_START_TEXT.test(String(value || '').normalize('NFC'));

// Moodle có preview.php — xem thử không tính điểm nhưng giáo viên vẫn thấy trong danh
// sách lượt, nên tuyệt đối không được bấm nhầm vào nó.
const isPreviewLink = (element) => /\/mod\/quiz\/preview\.php/.test(element?.href || '');

function isUsableNextControl(element, doc) {
  if (element.disabled || element.hidden || element.classList?.contains('disabled') ||
    element.getAttribute('aria-disabled') === 'true' || element.getAttribute('aria-hidden') === 'true') return false;
  if (element.getClientRects && element.getClientRects().length === 0) return false;
  if (element.tagName === 'A') {
    const href = element.getAttribute('href')?.trim();
    if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return false;
    if (doc.location?.href) {
      const destination = new URL(href, doc.location.href);
      const current = new URL(doc.location.href);
      if (destination.origin === current.origin && destination.pathname === current.pathname &&
        destination.search === current.search) return false;
    }
  }
  return true;
}

export const pttc1Provider = {
  id: 'pttc1-moodle',
  matches(location) {
    return location.hostname === HOSTNAME;
  },
  getAccount() {
    // Moodle thường đưa tên/số user vào menu khi người dùng đã đăng nhập.
    const userNode = document.querySelector('#usermenu, .usermenu, [data-region="usermenu"], .user-menu');
    const profile = userNode?.querySelector?.('a[href*="/user/profile.php"], a[href*="/user/view.php"]');
    const profileId = profile?.href ? new URL(profile.href, location.href).searchParams.get('id') : null;
    const accountId =
      userNode?.dataset?.userid || profileId || text('.usermenu .usertext, .usermenu .username, #usermenu .usertext');
    const authenticated = Boolean(accountId || document.body?.classList?.contains('loggedin') ||
      document.querySelector('.usermenu a[href*="/login/logout.php"], #usermenu a[href*="/login/logout.php"]'));
    if (!authenticated) return { authenticated: false, hostname: HOSTNAME };
    return {
      authenticated: true,
      accountId,
      displayName: text('.usermenu .usertext, .usermenu .username') || accountId,
      hostname: HOSTNAME,
    };
  },
  isLoginPage(location) {
    return location.pathname === '/login/index.php';
  },
  findLoginLogoutButton(doc) {
    const message = (doc.body?.textContent || '').normalize('NFC');
    if (!/đã đăng nhập|already logged in/i.test(message) ||
      !/đăng xuất|log\s*out|logout/i.test(message)) return null;
    return [...doc.querySelectorAll('a, button, input[type="submit"]')].find((element) => {
      const label = (element.textContent || element.value || '').normalize('NFC').trim();
      return /^(thoát|đăng xuất|log\s*out|logout)$/i.test(label) &&
        !element.disabled && element.getAttribute('aria-disabled') !== 'true';
    }) || null;
  },
  login({ username, password }) {
    const usernameInput = findLoginInput(
      document,
      '#username, input[name="username"], input[name="email"], input[name="user"], input[name="userid"], input[type="email"], input[autocomplete="username"]',
      [/user/i, /username/i, /email/i, /account/i, /tài khoản/i, /mã sinh viên/i],
    );
    const passwordInput = findLoginInput(
      document,
      '#password, input[name="password"], input[type="password"], input[autocomplete="current-password"]',
      [/pass/i, /password/i, /mật khẩu/i],
    );
    const form = findLoginForm(document, usernameInput, passwordInput);
    if (!usernameInput || !passwordInput || !form)
      return { ok: false, reason: 'login-form-not-found' };
    if (document.querySelector('[data-sitekey], iframe[src*="recaptcha" i]'))
      return { ok: false, reason: 'captcha-required' };
    usernameInput.value = username;
    passwordInput.value = password;
    usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
    passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.submit();
    return { ok: true };
  },
  findVideo(doc) {
    const local = doc.querySelector('video');
    if (local) return local;
    // Moodle có thể bọc video trong iframe cùng origin — đọc được thì lấy luôn.
    for (const frame of doc.querySelectorAll('iframe')) {
      const embedded = frameVideoIn(frame);
      if (embedded) return embedded;
    }
    return null;
  },
  findVideoFrame(doc) {
    // Không lấy được <video> (iframe khác origin) nhưng vẫn là trang có video.
    if (doc.querySelector('video')) return null;
    return videoFrames(doc)[0] || null;
  },
  findNextButton(document) {
    const candidates = [
      ...document.querySelectorAll(
        '#next-activity-link, a[rel="next"], .activity-navigation a, [data-region="activity-navigation"] a, button[aria-label*="Next" i], button[aria-label*="Tiếp" i]',
      ),
    ].filter((element) => element.id !== 'prev-activity-link' && element.getAttribute('rel') !== 'prev' &&
      isUsableNextControl(element, document));
    return (
      candidates.find((element) =>
        /next|tiếp|kế tiếp/i.test(
          `${element.textContent} ${element.getAttribute('aria-label') || ''}`.normalize('NFC'),
        ),
      ) ||
      candidates.find((element) => element.id === 'next-activity-link' || element.getAttribute('rel') === 'next') ||
      [...document.querySelectorAll('a, button')].find((element) =>
        element.id !== 'prev-activity-link' && element.getAttribute('rel') !== 'prev' &&
        isUsableNextControl(element, document) &&
        [element.getAttribute('aria-label'), element.textContent].some(label =>
          /^(?:(?:hoạt động|phần) (?:tiếp theo|kế tiếp)|next activity)$/i.test(
            (label || '').normalize('NFC')
              .replace(/[\s\u2039\u203a\u00ab\u00bb]+/g, ' ').trim(),
          ),
        ),
      ) ||
      null
    );
  },
  findDiscussionInput(document) {
    return document.querySelector(
      'textarea[name*="message" i], textarea[name*="comment" i]',
    );
  },
  isQuizPage(location) {
    return location.pathname.startsWith('/mod/quiz/');
  },
  isQuizStartPage(location) {
    return location.pathname.startsWith('/mod/quiz/view.php');
  },
  isQuizAttemptPage(location) {
    return location.pathname.startsWith('/mod/quiz/attempt.php');
  },
  findQuizStartButton(doc) {
    const direct = [...doc.querySelectorAll(QUIZ_START_SELECTORS)].find(
      (element) => !isPreviewLink(element),
    );
    if (direct) return direct;
    return (
      [...doc.querySelectorAll('button, input[type="submit"], a')].find(
        (element) =>
          !isPreviewLink(element) &&
          matchesStartText(element.textContent || element.value),
      ) || null
    );
  },
  // Moodle bọc mỗi câu hỏi trong .que; .qtype là class định danh loại câu hỏi.
  findQuizQuestionNodes(doc) {
    return [...doc.querySelectorAll('.que, .question')];
  },
};
