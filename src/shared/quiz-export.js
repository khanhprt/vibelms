import { QUIZ_DUMP_KEY } from './constants.js';

export async function readQuizDump() {
  const { [QUIZ_DUMP_KEY]: dump } = await browser.storage.local.get(QUIZ_DUMP_KEY);
  return dump && Array.isArray(dump.questions) ? dump : null;
}

export async function clearQuizDump() {
  await browser.storage.local.remove(QUIZ_DUMP_KEY);
}

// Content script không ghi được file tùy ý, nên chỉ tải xuống khi người dùng bấm nút.
export function downloadQuizDump(dump) {
  if (!dump?.questions?.length) return false;
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `coursepilot-quiz-${dump.quizId || 'unknown'}-${Date.now()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
