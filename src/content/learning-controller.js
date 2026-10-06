import { MESSAGE } from '../shared/constants.js';
import { settingsStore } from '../shared/settings-store.js';
import { nextLessonDelayMs, waitClickDelay } from '../shared/delays.js';
import { syncCourseStatusPanel } from './course-status-panel.js';
import { markAutoResumeAfterLogin, resumeLowestProgressCourse, finishCourseAndResume, stopAutoResume } from './auto-resume.js';
import { forumRequiresTask, isCurrentForumCompleted, mountForumHelper } from './forum-helper.js';
import { mountQuizExtractor } from './quiz-extractor.js';
import { autoBindLocalAccount } from '../services/account-binding.js';
import { ensureLearningSession, finishLearningSession, recordLessonFailure } from '../shared/run-log.js';

// Forum and quiz completion comes from their task state, not a video timer.
const needsManualAction = () =>
  location.pathname.startsWith('/mod/quiz/') ||
  (location.pathname.startsWith('/mod/forum/') && forumRequiresTask());

// Nút "Hoạt động tiếp theo" chỉ dùng được khi còn trong DOM và không bị khóa.
// Trả về chính phần tử đó, hoặc undefined khi không còn gì để bấm.
function usableNextButton(provider) {
  const button = provider.findNextButton(document);
  if (!button || button.disabled || button.isConnected === false) return undefined;
  if (button.getAttribute?.('aria-disabled') === 'true') return undefined;
  return button;
}

export function createLearningController(provider) {
  const loginFlowKey = 'vernal:login-flow';
  let loginInProgress = false;
  let loginSubmitted = false;
  let loginRedirected = false;
  let observer;
  let coursePanelTimer;
  let coursePanelSynced = false;
  let nextLessonTimer;
  let nextLessonSource;
  let nextLessonStartedAt;
  let nextLessonWaitMs;
  let completionTimer;
  let checkingCompletion = false;
  let advancing = false;
  let activityState = { url: location.href, completed: false, advanced: false };
  let quizCleanup;
  let quizMounted = false;
  let enabled = true;

  function startLearningLog() {
    // Logging failures must not stop course selection or activity navigation.
    return ensureLearningSession().catch(error => {
      console.warn('Cannot start learning log:', error.message || String(error));
    });
  }

  async function allowedHere() {
    const { allowedDomains } = await settingsStore.get();
    return allowedDomains.length === 0 || allowedDomains.includes(location.hostname);
  }

  async function refreshActivityState() {
    if (activityState.url !== location.href) {
      clearTimeout(nextLessonTimer);
      nextLessonSource = undefined;
      activityState = { url: location.href, completed: false, advanced: false };
    }
    const state = activityState;
    if (location.pathname.startsWith('/mod/forum/') && forumRequiresTask()) {
      state.completed = await isCurrentForumCompleted();
    } else if (location.pathname.startsWith('/mod/quiz/')) {
      // Finish/submit/confirm clicks only indicate progress, not successful submission.
      state.completed = location.pathname.endsWith('/review.php') &&
        Boolean(new URLSearchParams(location.search).get('attempt'));
    }
    return state;
  }

  async function nextLesson(automatic = false) {
    if (!enabled) return { ok: false, reason: 'extension-disabled' };
    if (advancing) return { ok: false, reason: 'navigation-in-progress' };
    advancing = true;
    try {
      const state = await refreshActivityState();
      if (!automatic && !needsManualAction()) state.completed = true;
      if (!state.completed || state.advanced) return { ok: false, reason: 'activity-incomplete' };
      if (!(await allowedHere())) return { ok: false, reason: 'domain-not-allowed' };
      await waitClickDelay(automatic ? state.waitedMs || 0 : 0);
      await refreshActivityState();
      const settings = await settingsStore.get();
      if (!enabled || state !== activityState || state.url !== location.href || !state.completed)
        return { ok: false, reason: 'activity-changed' };
      if (automatic && !settings.autoNextLesson) return { ok: false, reason: 'auto-next-disabled' };
      if (!(await allowedHere())) return { ok: false, reason: 'domain-not-allowed' };
      if (!enabled || state !== activityState || state.url !== location.href || !state.completed)
        return { ok: false, reason: 'activity-changed' };
      // Trên trang /mod/ không còn "Hoạt động tiếp theo" nghĩa là đã ở cuối khóa.
      // Dò lại sau nhịp chờ để tránh kết luận khi Moodle chưa dựng xong khối điều hướng.
      let button = usableNextButton(provider);
      if (!button && location.pathname.startsWith('/mod/')) {
        await waitClickDelay();
        if (!enabled || state !== activityState || state.url !== location.href || !state.completed)
          return { ok: false, reason: 'activity-changed' };
        button = usableNextButton(provider);
        if (!button) {
          const started = finishCourseAndResume({ resume: settings.autoResumeCourse });
          if (started) {
            state.advanced = true;
            state.courseFinished = true;
            state.returningToCourses = settings.autoResumeCourse;
          }
          return { ok: started, reason: settings.autoResumeCourse ? 'returning-to-courses' : 'course-finished' };
        }
      }
      if (!button) {
        if (!state.navigationErrorLogged) {
          state.navigationErrorLogged = true;
          await recordLessonFailure('Next activity link is missing or unavailable', {stage: 'activity-navigation'});
        }
        return { ok: false };
      }
      state.advanced = true;
      button.click();
      return { ok: true };
    } catch (error) {
      await recordLessonFailure(error.message || String(error), {stage: 'activity-navigation'});
      return {ok: false, reason: 'navigation-failed'};
    } finally {
      advancing = false;
    }
  }

  async function checkActivityCompletion() {
    if (!enabled || checkingCompletion) return;
    checkingCompletion = true;
    try {
      const state = await refreshActivityState();
      const settings = await settingsStore.get();
      if (enabled && state === activityState && state.completed && settings.autoNextLesson)
        await nextLesson(true);
    } finally {
      checkingCompletion = false;
    }
  }

  // Không đợi video kết thúc: cứ phát (nếu có), đợi theo cài đặt rồi bấm "Hoạt động Tiếp theo".
  // Moodle có thể thay thế <video> khi chuyển activity nên huỷ lịch cũ trước khi hẹn lại.
  async function scheduleNextLesson(source) {
    const settings = await settingsStore.get();
    if (!enabled || needsManualAction()) return;
    if (!settings.autoNextLesson) {
      clearTimeout(nextLessonTimer);
      nextLessonSource = undefined;
      return;
    }
    const state = activityState;
    if (state.completed || state.advanced) return;
    const waitMs = nextLessonDelayMs(settings.nextLessonDelaySeconds);
    if (nextLessonSource === source && nextLessonWaitMs === waitMs) return;
    clearTimeout(nextLessonTimer);
    if (nextLessonSource !== source) nextLessonStartedAt = Date.now();
    nextLessonSource = source;
    nextLessonWaitMs = waitMs;
    nextLessonTimer = setTimeout(() => {
      nextLessonTimer = undefined;
      if (!enabled || state !== activityState || state.url !== location.href) return;
      state.completed = true;
      state.waitedMs = waitMs;
      checkActivityCompletion();
    }, Math.max(0, waitMs - (Date.now() - nextLessonStartedAt)));
  }

  async function startAutoResume() {
    if (!(await allowedHere())) return { ok: false, reason: 'domain-not-allowed' };
    startLearningLog();
    if (activityState.courseFinished) {
      if (!activityState.returningToCourses)
        activityState.returningToCourses = finishCourseAndResume({ resume: true });
      return { ok: activityState.returningToCourses, returningToCourses: true };
    }
    if (location.pathname.startsWith('/mod/')) {
      stopAutoResume();
      await autoBindLocalAccount(provider.getAccount?.());
      if (!enabled) return { ok: false, reason: 'extension-disabled' };
      mountActivityHelpers();
      await watchCurrentVideo();
      await checkActivityCompletion();
      return { ok: true, resumedCurrentActivity: true };
    }
    if (location.pathname === '/course/view.php') {
      const started = resumeLowestProgressCourse({ startIfIdle: true });
      return { ok: true, resumedCurrentCourse: true, waitingForActivities: !started };
    }
    markAutoResumeAfterLogin();
    resumeLowestProgressCourse();
    return { ok: true };
  }

  // iframe cùng origin chưa nạp xong thì contentDocument rỗng — thử dò lại khi nó load.
  function watchFrameLoad(frame) {
    if (frame.dataset.vernalFrameWatch) return;
    frame.dataset.vernalFrameWatch = 'true';
    frame.addEventListener('load', () => watchCurrentVideo(), { once: true });
  }

  async function watchCurrentVideo() {
    if (!enabled) return;
    if (needsManualAction()) {
      clearTimeout(nextLessonTimer);
      nextLessonSource = undefined;
      return;
    }
    const { autoPlayVideo } = await settingsStore.get();
    if (!(await allowedHere())) return;

    // Document activities must schedule navigation even without a working player.
    await refreshActivityState();
    if (location.pathname.startsWith('/mod/')) await scheduleNextLesson(document.body);
    if (!autoPlayVideo) return;

    // Phát video nếu trang có: thẻ <video>, hoặc iframe cùng origin, hoặc player ngoài.
    const video = provider.findVideo(document);
    if (video) {
      video.muted = true;
      if (video.paused) video.play().catch(error => {
        if (!activityState.videoErrorLogged) {
          activityState.videoErrorLogged = true;
          recordLessonFailure(error.message || String(error), {stage: 'video-playback'});
        }
      });
    } else {
      const frame = provider.findVideoFrame?.(document);
      if (frame) watchFrameLoad(frame);
    }
  }

  async function loginWithSavedCredentials() {
    if (loginInProgress || loginSubmitted) return { ok: false, reason: 'login-in-progress' };
    loginInProgress = true;
    try {
      const settings = await settingsStore.get();
      const canUseLoginPage =
        provider.isLoginPage?.(location) ||
        (location.pathname === '/login/logout.php' && sessionStorage.getItem(loginFlowKey));
      if (!canUseLoginPage) return { ok: false, reason: 'login-page-missing' };
      if (!settings.pttc1Username) return { ok: false, reason: 'username-missing' };
      if (!settings.pttc1Password) return { ok: false, reason: 'password-missing' };
      if (!(await allowedHere())) return { ok: false, reason: 'domain-not-allowed' };
      const sourceUrl = location.href;
      await waitClickDelay();
      if (!enabled || sourceUrl !== location.href) return { ok: false, reason: 'login-page-changed' };
      const logout = provider.findLoginLogoutButton?.(document);
      if (logout) {
        if (!logout.isConnected) return { ok: false, reason: 'logout-button-missing' };
        stopAutoResume();
        sessionStorage.setItem(loginFlowKey, 'login');
        loginSubmitted = true;
        logout.click();
        return { ok: true, loggingOut: true };
      }
      sessionStorage.setItem(loginFlowKey, 'submitted');
      const result = provider.login({ username: settings.pttc1Username, password: settings.pttc1Password });
      loginSubmitted = Boolean(result.ok);
      if (!result.ok) sessionStorage.removeItem(loginFlowKey);
      if (result.ok && settings.autoResumeCourse) markAutoResumeAfterLogin();
      return result;
    } catch (error) {
      loginSubmitted = false;
      sessionStorage.removeItem(loginFlowKey);
      throw error;
    } finally {
      loginInProgress = false;
    }
  }

  async function continueLoginFlow() {
    if (!enabled) return;
    const phase = sessionStorage.getItem(loginFlowKey);
    if (provider.isLoginPage?.(location) ||
      (location.pathname === '/login/logout.php' && phase)) {
      const settings = await settingsStore.get();
      if (phase === 'login' || (settings.pttc1AutoLogin && phase !== 'submitted'))
        await loginWithSavedCredentials();
      return;
    }
    if (phase === 'login' && !loginRedirected && await allowedHere()) {
      if (!enabled) return;
      loginRedirected = true;
      location.assign('/login/index.php');
    } else if (phase === 'submitted' && provider.getAccount?.().authenticated) {
      sessionStorage.removeItem(loginFlowKey);
    }
  }

  async function tryResumeCourse(startIfIdle = false) {
    if (!enabled) return;
    if (provider.isLoginPage?.(location) || location.pathname === '/login/logout.php' ||
      sessionStorage.getItem(loginFlowKey) === 'login') return;
    const settings = await settingsStore.get();
    if (enabled && settings.autoResumeCourse && await allowedHere())
      resumeLowestProgressCourse({ startIfIdle });
  }

  function mountActivityHelpers() {
    Promise.resolve(mountForumHelper()).catch(error =>
      recordLessonFailure(error.message || String(error), {stage: 'forum'}),
    );
    if (!quizMounted) {
      quizMounted = true;
      quizCleanup = mountQuizExtractor(provider);
    }
  }

  function observePage() {
    observer?.disconnect();
    observer = new MutationObserver(() => {
      if (!enabled) return;
      watchCurrentVideo();
      checkActivityCompletion();
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
    checkActivityCompletion();
    clearInterval(completionTimer);
    completionTimer = setInterval(() => {
      watchCurrentVideo();
      checkActivityCompletion();
      tryResumeCourse();
    }, 1_000);
  }

  // Công tắc dừng chung: tắt là huỷ mọi lịch, ngắt observer và ẩn panel.
  function setEnabled(value) {
    if (value === enabled) return;
    enabled = value;
    clearTimeout(nextLessonTimer);
    clearInterval(completionTimer);
    clearTimeout(coursePanelTimer);
    nextLessonTimer = undefined;
    nextLessonSource = undefined;
    coursePanelSynced = false;

    if (!enabled) {
      activityState.returningToCourses = false;
      observer?.disconnect();
      quizCleanup?.();
      quizCleanup = undefined;
      quizMounted = false;
      stopAutoResume();
      sessionStorage.removeItem(loginFlowKey);
      finishLearningSession();
      syncCourseStatusPanel(false);
      return;
    }
    startLearningLog();
    observePage();
    mountActivityHelpers();
    continueLoginFlow();
    tryResumeCourse(true);
    settingsStore.get().then(settings => syncCourseStatusPanel(settings.showCourseStatus));
  }

  // Chưa chạy gì cho tới khi biết công tắc đang bật hay tắt.
  settingsStore.get().then(async (settings) => {
    enabled = settings.extensionEnabled !== false;
    if (!enabled) {
      syncCourseStatusPanel(false);
      return;
    }
    observePage();
    await continueLoginFlow();
    if (provider.isLoginPage?.(location) || sessionStorage.getItem(loginFlowKey) === 'login') return;
    // Gắn cờ liên kết trước, để các nút gợi ý LLM dùng được ngay khi bấm.
    await autoBindLocalAccount(provider.getAccount?.());
    if (!enabled) return;
    startLearningLog();
    mountActivityHelpers();
    tryResumeCourse(true);
    syncCourseStatusPanel(settings.showCourseStatus);
  });

  return {
    async handleMessage(message) {
      if (message?.type === MESSAGE.COURSE_STATUS) {
        const settings = await settingsStore.get();
        return { supported: true, provider: provider.id, enabled,
          courseFinished: Boolean(activityState.courseFinished),
          returningToCourses: Boolean(activityState.returningToCourses),
          autoNextLesson: settings.autoNextLesson, autoResumeCourse: settings.autoResumeCourse };
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
    async refreshSettings() {
      await watchCurrentVideo();
    },
    async refreshForumHelper() {
      if (enabled) await mountForumHelper();
    },
    destroy() {
      enabled = false;
      observer?.disconnect();
      quizCleanup?.();
      clearTimeout(coursePanelTimer);
      clearTimeout(nextLessonTimer);
      clearInterval(completionTimer);
      stopAutoResume();
    },
  };
}
