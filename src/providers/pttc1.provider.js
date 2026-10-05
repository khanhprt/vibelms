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

export const pttc1Provider = {
  id: 'pttc1-moodle',
  matches(location) {
    return location.hostname === HOSTNAME;
  },
  getAccount() {
    // Moodle thường đưa tên/số user vào menu khi người dùng đã đăng nhập.
    const userNode = document.querySelector('[data-userid], #usermenu, .usermenu');
    const accountId =
      userNode?.dataset.userid || text('.usermenu .usertext, .usermenu .username');
    if (!accountId) return { authenticated: false, hostname: HOSTNAME };
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
  login({ username, password }) {
    const usernameInput = document.querySelector('#username, input[name="username"]');
    const passwordInput = document.querySelector('#password, input[name="password"]');
    const form = document.querySelector('#login, form[action*="login"]');
    if (!usernameInput || !passwordInput || !form)
      return { ok: false, reason: 'login-form-not-found' };
    if (document.querySelector('[data-sitekey], iframe[src*="recaptcha" i]'))
      return { ok: false, reason: 'captcha-required' };
    usernameInput.value = username;
    passwordInput.value = password;
    usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
    passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit();
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
    ];
    return (
      candidates.find((element) =>
        /next|tiếp|kế tiếp/i.test(
          `${element.textContent} ${element.getAttribute('aria-label') || ''}`,
        ),
      ) ||
      candidates.at(-1) ||
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
