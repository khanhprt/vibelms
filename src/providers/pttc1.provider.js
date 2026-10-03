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
};
