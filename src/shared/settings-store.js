import { DEFAULT_SETTINGS } from './constants.js';

// autoStartQuiz trước đây nằm trong DEFAULT_SETTINGS nhưng không hiện trong UI, và form
// Options ghi đè toàn bộ mặc định xuống storage mỗi lần bấm "Lưu". Nên mọi giá trị
// false đã lưu đều là bản ghi máy của form chứ không phải lựa chọn có chủ đích của
// người dùng — đổi mặc định sang true vì vậy không tự có tác dụng. Cần một lần nâng cấp.
// Gắn cờ theo phiên bản để sau này người dùng tắt công tắc thì không bị bật lại.
const SETTINGS_VERSION = 5;

const MIGRATIONS = {
  2: (settings) => ({ ...settings, autoStartQuiz: true }),
  3: (settings) => ({ ...settings, nextLessonDelaySeconds: 5 }),
  4: (settings) => ({ ...settings, clickDelaySeconds: 1 }),
  5: (settings) => ({ ...settings, quizVisionModel: 'gemini-3.8-flash' }),
};

async function upgrade(stored) {
  const from = Number(stored.settingsVersion) || 1;
  if (from >= SETTINGS_VERSION) return stored;
  let next = { ...stored };
  for (let version = from + 1; version <= SETTINGS_VERSION; version += 1) {
    next = MIGRATIONS[version]?.(next) || next;
  }
  next.settingsVersion = SETTINGS_VERSION;
  await browser.storage.local.set(next);
  return next;
}

export const settingsStore = {
  async get() {
    const value = await browser.storage.local.get({
      ...DEFAULT_SETTINGS,
      settingsVersion: 1,
    });
    return { ...DEFAULT_SETTINGS, ...(await upgrade(value)) };
  },
  async patch(changes) {
    await browser.storage.local.set(changes);
  },
};
