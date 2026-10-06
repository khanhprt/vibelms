export const MESSAGE = Object.freeze({
  COURSE_STATUS: 'COURSE_STATUS',
  NEXT_LESSON: 'NEXT_LESSON',
  GENERATE_DISCUSSION: 'GENERATE_DISCUSSION',
  GENERATE_FORUM_REPLY: 'GENERATE_FORUM_REPLY',
  SUGGEST_QUIZ_ANSWER: 'SUGGEST_QUIZ_ANSWER',
  ACCOUNT_STATUS: 'ACCOUNT_STATUS',
  BIND_ACCOUNT: 'BIND_ACCOUNT',
  LOGIN_WITH_SAVED_CREDENTIALS: 'LOGIN_WITH_SAVED_CREDENTIALS',
  REFRESH_COURSE_PANEL: 'REFRESH_COURSE_PANEL',
  START_AUTO_RESUME: 'START_AUTO_RESUME',
});

export const QUIZ_PATHS = Object.freeze(['/mod/quiz/']);
// Bộ đệm câu hỏi nằm trong storage.local (theo extension, không theo tab) để sống sót qua
// các lần chuyển trang của Moodle. Popup/options đọc và xuất từ khoá này.
export const QUIZ_DUMP_KEY = 'vernalQuizDump';

export const DEFAULT_SETTINGS = Object.freeze({
  assistEnabled: false,
  extensionEnabled: true,
  allowedDomains: [],
  llmEndpoint: 'https://api.vilao.ai/v1/chat/completions',
  llmApiKey: '',
  llmModel: 'gpt-4o',
  accountVerifyEndpoint: '',
  boundAccount: null,
  pttc1Username: '',
  pttc1Password: '',
  pttc1AutoLogin: false,
  showCourseStatus: false,
  autoResumeCourse: true,
  autoNextLesson: true,
  forumHelperEnabled: true,
  nextLessonDelaySeconds: 5,
  clickDelaySeconds: 1,
  autoPlayVideo: false,
  autoStartQuiz: true,
  quizExportEnabled: false,
});
