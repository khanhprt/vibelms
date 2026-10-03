const FLOW_KEY = 'coursepilot:auto-resume-phase';
const COURSES_PATH = '/my/courses.php';
const navigateAfterDelay = (url) => setTimeout(() => location.assign(url), 500);

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
  return (
    Number.parseInt(raw, 10) ||
    (match ? (Number(match[1]) / Number(match[2])) * 100 : 100)
  );
}

export function markAutoResumeAfterLogin() {
  sessionStorage.setItem(FLOW_KEY, 'courses');
}

export function resumeLowestProgressCourse() {
  const phase = sessionStorage.getItem(FLOW_KEY);
  if (!phase) return false;

  if (phase === 'courses') {
    if (location.pathname !== COURSES_PATH) {
      navigateAfterDelay(COURSES_PATH);
      return true;
    }
    const courses = courseCards()
      .map((card) => ({
        card,
        link: card.querySelector('a[href*="/course/view.php?id="]'),
      }))
      .filter(({ link }) => link?.href);
    if (!courses.length) return false; // Moodle chưa nạp course cards.
    courses.sort((left, right) => getProgress(left.card) - getProgress(right.card));
    sessionStorage.setItem(FLOW_KEY, 'video');
    navigateAfterDelay(courses[0].link.href);
    return true;
  }

  if (phase === 'video' && location.pathname === '/course/view.php') {
    const firstVideo = document.querySelector('a[href*="/mod/videotime/view.php?id="]');
    if (!firstVideo?.href) return false;
    sessionStorage.removeItem(FLOW_KEY);
    navigateAfterDelay(firstVideo.href);
    return true;
  }
  return false;
}
