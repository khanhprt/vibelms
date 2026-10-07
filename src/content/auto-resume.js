import { finishLearningSession } from '../shared/run-log.js';
import { logActivity } from './activity-log.js';

const FLOW_KEY = 'vernal:auto-resume-phase';
const COURSES_PATH = '/my/courses.php';
const COURSE_CHECK_KEY = 'vernal:auto-resume-course-check';
const CURRENT_COURSE_KEY = 'vernal:current-course-id';
let navigationTimer;
let navigationTarget;
const navigateAfterDelay = (url) => {
  if (navigationTarget === url) return;
  clearTimeout(navigationTimer);
  navigationTarget = url;
  navigationTimer = setTimeout(() => {
    navigationTimer = undefined;
    navigationTarget = undefined;
    logActivity('info', 'Đang chuyển trang', String(url).replace(location.origin, ''));
    location.assign(url);
  }, 500);
};

export function stopAutoResume() {
  clearTimeout(navigationTimer);
  navigationTimer = undefined;
  navigationTarget = undefined;
  sessionStorage.removeItem(FLOW_KEY);
  sessionStorage.removeItem(COURSE_CHECK_KEY);
}

function courseCards() {
  return [
    ...document.querySelectorAll(
      '.card.dashboard-card, .coursebox, [data-region="course-content"] .card',
    ),
  ];
}

function getProgress(card) {
  const progress = card.querySelector('[aria-valuenow], .progress-bar');
  const raw = progress?.getAttribute('aria-valuenow') || progress?.style.width || '';
  const text =
    card.querySelector('.progress-text, [data-region="progress-text"], .text-muted')
      ?.textContent || '';
  const match = text.match(/(\d+)\s*(?:trong|of)\s*(\d+)/i);
  const percent = Number.parseFloat(raw);
  if (Number.isFinite(percent)) return percent;
  if (match && Number(match[2]) > 0) return (Number(match[1]) / Number(match[2])) * 100;
  const percentText = text.match(/(\d+(?:\.\d+)?)\s*%/);
  return percentText ? Number(percentText[1]) : null;
}

export function markAutoResumeAfterLogin() {
  sessionStorage.removeItem(COURSE_CHECK_KEY);
  sessionStorage.setItem(FLOW_KEY, 'courses');
}

// Đánh dấu khóa vừa học xong để không chọn lại nó ở vòng sau. Cần course id
// chính xác, ngoài ra đọc thêm từ class "course-<id>" mà Moodle luôn gắn lên <body>
// khi ở trong một khóa — breadcrumb có thể vắng ở một số theme.
function completedCourseId() {
  const link = document.querySelector(
    '.breadcrumb a[href*="/course/view.php"], [aria-label="breadcrumb"] a[href*="/course/view.php"], #page-navbar a[href*="/course/view.php"]',
  );
  if (link?.href) {
    const url = new URL(link.href, location.href);
    const courseId = url.origin === location.origin ? url.searchParams.get('id') : null;
    if (courseId) return courseId;
  }
  return document.body?.className?.match(/(?:^|\s)course-(\d+)(?:\s|$)/)?.[1] ||
    sessionStorage.getItem(CURRENT_COURSE_KEY) || null;
}

export function finishCourseAndResume({ resume = true } = {}) {
  const courseId = completedCourseId();
  if (courseId) sessionStorage.setItem(`vernal_completed_course_${courseId}`, 'true');
  if (!resume) {
    stopAutoResume();
    return true;
  }
  sessionStorage.removeItem(COURSE_CHECK_KEY);
  sessionStorage.setItem(FLOW_KEY, 'return-courses');
  navigateAfterDelay(COURSES_PATH);
  return true;
}

function firstCourseActivity() {
  const usable = (link) => {
    if (!link?.href || link.getAttribute?.('aria-disabled') === 'true') return false;
    const url = new URL(link.href, location.href);
    return url.origin === location.origin && /^\/mod\/[^/]+\/(?:view|attempt|discuss)\.php$/.test(url.pathname);
  };
  const activities = [...document.querySelectorAll('li.activity, [data-for="cmitem"], .activity')];
  for (const activity of activities) {
    const link = activity.querySelector('a[href*="/mod/"]');
    if (!usable(link)) continue;
    return link;
  }
  // Themes can expose a plain list of links instead of Moodle activity wrappers.
  return [...document.querySelectorAll(
    '.activityinstance a[href*="/mod/"], .course-content a[href*="/mod/"], #region-main a[href*="/mod/"]',
  )].find(usable) || null;
}

export function resumeLowestProgressCourse({ startIfIdle = false } = {}) {
  if (location.pathname === '/course/view.php') {
    const courseId = new URL(location.href).searchParams.get('id');
    if (courseId) sessionStorage.setItem(CURRENT_COURSE_KEY, courseId);
  }
  let phase = sessionStorage.getItem(FLOW_KEY);
  if (startIfIdle && location.pathname === '/course/view.php' && (!phase || phase === 'courses')) {
    phase = 'activity';
    sessionStorage.setItem(FLOW_KEY, phase);
  }
  if (startIfIdle && location.pathname === COURSES_PATH &&
    (!phase || phase === 'activity' || phase === 'video')) {
    markAutoResumeAfterLogin();
    phase = 'courses';
  }
  // Resume a previously queued verification using the new end-of-course policy.
  if (phase === 'verify-course') phase = 'return-courses';
  if (location.pathname.startsWith('/mod/') && phase !== 'return-courses') {
    stopAutoResume();
    return false;
  }
  if (!phase) return false;

  if (phase === 'return-courses') {
    if (location.pathname !== COURSES_PATH) {
      navigateAfterDelay(COURSES_PATH);
      return true;
    }
    sessionStorage.removeItem(COURSE_CHECK_KEY);
    sessionStorage.setItem(FLOW_KEY, 'courses');
    phase = 'courses';
  }

  if (phase === 'courses') {
    if (location.pathname !== COURSES_PATH) {
      navigateAfterDelay(COURSES_PATH);
      return true;
    }
    const cards = courseCards();
    const available = cards
      .map((card) => ({
        card,
        link: card.querySelector('a[href*="/course/view.php"], .coursename a, a.coursename'),
        progress: getProgress(card),
      }))
      .filter(({ link }) => {
        if (!link?.href) return false;
        const url = new URL(link.href, location.href);
        if (url.origin !== location.origin || url.pathname !== '/course/view.php') return false;
        const courseId = url.searchParams.get('id');
        if (!courseId) return false;
        return sessionStorage.getItem(`vernal_completed_course_${courseId}`) !== 'true';
      });
    const courses = available.filter(({ progress }) => progress !== null && progress < 100);
    if (!courses.length) {
      const stillLoading = cards.some((card) =>
        !card.querySelector('a[href*="/course/view.php"], .coursename a, a.coursename')?.href,
      ) || available.some(({ progress }) => progress === null);
      if (cards.length && !stillLoading) {
        console.log('No remaining courses with incomplete LMS progress.');
        logActivity('success', 'Đã hoàn thành mọi khóa có tiến độ dở');
        finishLearningSession();
        stopAutoResume();
      }
      return false;
    }
    courses.sort((left, right) => left.progress - right.progress);
    sessionStorage.setItem(CURRENT_COURSE_KEY, new URL(courses[0].link.href, location.href).searchParams.get('id'));
    sessionStorage.setItem(FLOW_KEY, 'activity');
    logActivity(
      'info',
      'Chọn khóa có tiến độ thấp nhất để tiếp tục',
      `course ${new URL(courses[0].link.href, location.href).searchParams.get('id') || '?'} · ${courses[0].progress}%`,
    );
    navigateAfterDelay(courses[0].link.href);
    return true;
  }

  if ((phase === 'activity' || phase === 'video') && location.pathname === '/course/view.php') {
    const activity = firstCourseActivity();
    if (!activity?.href) return false;
    stopAutoResume();
    navigateAfterDelay(activity.href);
    return true;
  }
  return false;
}
