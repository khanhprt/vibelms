const SELECTORS = {
  video: 'video',
  next: [
    '[data-testid="next-lesson"]',
    'a[rel="next"]',
    'button[aria-label*="Next" i]',
    'button[aria-label*="Tiếp" i]',
  ].join(', '),
  discussionInput: 'textarea[name*="discussion" i], textarea[name*="comment" i]',
};

const VIDEO_FRAME_PATTERN =
  /(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com|vimeo\.com|dailymotion\.com|jwplayer|flowplayer|brightcove|html5player|\.m3u8|\.mp4|\.webm)/i;

function videoFrames(doc) {
  return [...doc.querySelectorAll('iframe')].filter((frame) =>
    VIDEO_FRAME_PATTERN.test(frame.src || ''),
  );
}

function frameVideoIn(frame) {
  try {
    return frame.contentDocument?.querySelector('video') || null;
  } catch {
    return null;
  }
}

export const genericLmsProvider = {
  id: 'generic-lms',
  matches(location) {
    return /course|learn|lesson|lms|training/i.test(
      location.pathname + location.hostname,
    );
  },
  findVideo(doc) {
    const local = doc.querySelector(SELECTORS.video);
    if (local) return local;
    for (const frame of doc.querySelectorAll('iframe')) {
      const embedded = frameVideoIn(frame);
      if (embedded) return embedded;
    }
    return null;
  },
  findVideoFrame(doc) {
    if (doc.querySelector(SELECTORS.video)) return null;
    return videoFrames(doc)[0] || null;
  },
  findNextButton(document) {
    return document.querySelector(SELECTORS.next);
  },
  findDiscussionInput(document) {
    return document.querySelector(SELECTORS.discussionInput);
  },
  isQuizPage(location) {
    return location.pathname.startsWith('/mod/quiz/');
  },
  isQuizStartPage() {
    return false;
  },
  isQuizAttemptPage() {
    return false;
  },
  // LMS chung không có quy ước DOM của Moodle: để trống, trình trích xuất sẽ báo "không hỗ trợ".
  findQuizStartButton() {
    return null;
  },
  findQuizQuestionNodes() {
    return [];
  },
};
