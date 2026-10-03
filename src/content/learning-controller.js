import { MESSAGE } from '../shared/constants.js';
import { settingsStore } from '../shared/settings-store.js';
import { syncCourseStatusPanel } from './course-status-panel.js';
import { markAutoResumeAfterLogin, resumeLowestProgressCourse } from './auto-resume.js';
import { mountForumHelper } from './forum-helper.js';

const ACTION_DELAY_MS = 500;
const NEXT_LESSON_DELAY_MS = 2000;
const delay = () => new Promise((resolve) => setTimeout(resolve, ACTION_DELAY_MS));

// Activity phải có người dùng trực tiếp làm: không tự phát, không tự chuyển.
const MANUAL_PATHS = ['/mod/forum/', '/mod/quiz/'];
const needsManualAction = () =>
  MANUAL_PATHS.some((path) => location.pathname.startsWith(path));

export function createLearningController(provider) {
  let observer;
  let coursePanelTimer;
  let coursePanelSynced = false;
  let nextLessonTimer;
  let nextLessonSource;
  let enabled = true;

  async function allowedHere() {
    const { allowedDomains } = await settingsStore.get();
    return allowedDomains.length === 0 || allowedDomains.includes(location.hostname);
  }

  async function nextLesson() {
    if (!enabled) return { ok: false, reason: 'extension-disabled' };
    if (location.pathname.startsWith('/mod/forum/')) {
      mountForumHelper();
      return { ok: false, reason: 'forum-requires-user' };
    }
    // Bỏ lượt làm bài dở có thể bị Moodle tính là nộp hoặc chờ hết giờ.
    if (needsManualAction()) return { ok: false, reason: 'requires-user' };
    if (!(await allowedHere())) return { ok: false, reason: 'domain-not-allowed' };
    await delay();
    const button = provider.findNextButton(document);
    if (!button || button.disabled) return { ok: false };
    button.click();
    return { ok: true };
  }

  // Không đợi video kết thúc: cứ phát (nếu có), đợi NEXT_LESSON_DELAY_MS rồi bấm "Hoạt động Tiếp theo".
  // Moodle có thể thay thế <video> khi chuyển activity nên huỷ lịch cũ trước khi hẹn lại.
  function scheduleNextLesson(source) {
    if (nextLessonSource === source) return;
    clearTimeout(nextLessonTimer);
    nextLessonSource = source;
    nextLessonTimer = setTimeout(() => {
      nextLessonTimer = undefined;
      nextLessonSource = undefined;
      nextLesson();
    }, NEXT_LESSON_DELAY_MS);
  }

  function startAutoResume() {
    markAutoResumeAfterLogin();
    resumeLowestProgressCourse();
    return { ok: true };
  }

  // iframe cùng origin chưa nạp xong thì contentDocument rỗng — thử dò lại khi nó load.
  function watchFrameLoad(frame) {
    if (frame.dataset.coursepilotFrameWatch) return;
    frame.dataset.coursepilotFrameWatch = 'true';
    frame.addEventListener('load', () => watchCurrentVideo(), { once: true });
  }

  async function watchCurrentVideo() {
    if (!enabled || needsManualAction()) return;
    const { autoPlayVideo, autoNextLesson } = await settingsStore.get();
    if ((!autoPlayVideo && !autoNextLesson) || !(await allowedHere())) return;

    // Phát video nếu trang có: thẻ <video>, hoặc iframe cùng origin, hoặc player ngoài.
    const video = provider.findVideo(document);
    if (video) {
      video.muted = true;
      if (video.paused) video.play().catch(() => {});
    } else {
      const frame = provider.findVideoFrame?.(document);
      if (frame) watchFrameLoad(frame);
    }

    // Đếm 2s ở MỌI trang activity, kể cả trang tài liệu — #next-activity-link luôn có ở đó.
    if (autoNextLesson && provider.findNextButton(document))
      scheduleNextLesson(document.body);
  }

  async function loginWithSavedCredentials() {
    const settings = await settingsStore.get();
    if (
      !provider.isLoginPage?.(location) ||
      !settings.pttc1Username ||
      !settings.pttc1Password
    ) {
      return { ok: false, reason: 'credentials-or-login-page-missing' };
    }
    await delay();
    const result = provider.login({
      username: settings.pttc1Username,
      password: settings.pttc1Password,
    });
    if (result.ok && settings.autoResumeCourse) markAutoResumeAfterLogin();
    return result;
  }

  async function tryResumeCourse() {
    if (!enabled) return;
    const settings = await settingsStore.get();
    if (settings.autoResumeCourse) resumeLowestProgressCourse();
  }

  function observePage() {
    observer?.disconnect();
    observer = new MutationObserver(() => {
      if (!enabled) return;
      watchCurrentVideo();
      tryResumeCourse();
      if (
        location.pathname.startsWith('/my/') &&
        !coursePanelSynced &&
        document.querySelector(
          '.card.dashboard-card, .coursebox, [data-region="course-content"] .card',
        )
      ) {
        clearTimeout(coursePanelTimer);
        coursePanelTimer = setTimeout(async () => {
          const settings = await settingsStore.get();
          coursePanelSynced = true;
          syncCourseStatusPanel(settings.showCourseStatus);
        }, 350);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    watchCurrentVideo();
  }

  // Công tắc dừng chung: tắt là huỷ mọi lịch, ngắt observer và ẩn panel.
  function setEnabled(value) {
    if (value === enabled) return;
    enabled = value;
    clearTimeout(nextLessonTimer);
    clearTimeout(coursePanelTimer);
    nextLessonTimer = undefined;
    nextLessonSource = undefined;
    coursePanelSynced = false;

    if (!enabled) {
      observer?.disconnect();
      syncCourseStatusPanel(false);
      return;
    }
    observePage();
    mountForumHelper();
    tryResumeCourse();
    settingsStore
      .get()
      .then((settings) => syncCourseStatusPanel(settings.showCourseStatus));
  }

  // Chưa chạy gì cho tới khi biết công tắc đang bật hay tắt.
  settingsStore.get().then((settings) => {
    enabled = settings.extensionEnabled !== false;
    if (!enabled) {
      syncCourseStatusPanel(false);
      return;
    }
    observePage();
    mountForumHelper();
    tryResumeCourse();
    syncCourseStatusPanel(settings.showCourseStatus);
    if (settings.pttc1AutoLogin && !provider.getAccount?.().authenticated) {
      loginWithSavedCredentials();
    }
  });

  return {
    async handleMessage(message) {
      if (message?.type === MESSAGE.COURSE_STATUS) {
        return { supported: true, provider: provider.id, enabled };
      }
      if (message?.type === MESSAGE.ACCOUNT_STATUS) {
        return provider.getAccount?.() ?? { authenticated: false };
      }
      if (message?.type === MESSAGE.NEXT_LESSON) return nextLesson();
      if (message?.type === MESSAGE.LOGIN_WITH_SAVED_CREDENTIALS)
        return enabled
          ? loginWithSavedCredentials()
          : { ok: false, reason: 'extension-disabled' };
      if (message?.type === MESSAGE.REFRESH_COURSE_PANEL) {
        if (!enabled) return { ok: true, enabled: false };
        const settings = await settingsStore.get();
        syncCourseStatusPanel(settings.showCourseStatus);
        return { ok: true };
      }
      if (message?.type === MESSAGE.START_AUTO_RESUME) {
        return enabled ? startAutoResume() : { ok: false, reason: 'extension-disabled' };
      }
      return undefined;
    },
    setEnabled,
    destroy() {
      observer?.disconnect();
      clearTimeout(coursePanelTimer);
      clearTimeout(nextLessonTimer);
    },
  };
}
