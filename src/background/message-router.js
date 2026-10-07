import { MESSAGE } from '../shared/constants.js';
import { generateDiscussionDraft, generateForumReply } from '../services/llm-client.js';
import { suggestAnswer } from '../services/quiz-solver.js';
import { handleRunLogMessage } from '../services/run-log.js';
import { settingsStore } from '../shared/settings-store.js';

const activeRequests = new Set();

// Background vẫn sống khi popup/content đã đóng, nên đây là chốt chặn cuối cùng.
// Tắt công tắc phải hủy cả request LLM/API đang bay, không chỉ ngăn request mới.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || changes.extensionEnabled?.newValue !== false) return;
  for (const controller of activeRequests) controller.abort();
});

async function runWhenEnabled(work) {
  const settings = await settingsStore.get();
  if (settings.extensionEnabled === false) {
    throw new Error('Vernal đang tắt. Bật công tắc nguồn để dùng tính năng này.');
  }
  const controller = new AbortController();
  activeRequests.add(controller);
  try {
    const result = await work(controller.signal);
    if (controller.signal.aborted || (await settingsStore.get()).extensionEnabled === false) {
      throw new Error('Vernal đang tắt. Bật công tắc nguồn để dùng tính năng này.');
    }
    return result;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error('Vernal đang tắt. Bật công tắc nguồn để dùng tính năng này.');
    throw error;
  } finally {
    activeRequests.delete(controller);
  }
}

export async function handleMessage(message) {
  const logResult = handleRunLogMessage(message);
  if (logResult) return logResult;
  if (message?.type === MESSAGE.GENERATE_DISCUSSION) {
    return runWhenEnabled((signal) => generateDiscussionDraft(message.payload, { signal }));
  }
  if (message?.type === MESSAGE.GENERATE_FORUM_REPLY) {
    return runWhenEnabled((signal) => generateForumReply(message.payload, { signal }));
  }
  if (message?.type === MESSAGE.SUGGEST_QUIZ_ANSWER) {
    return runWhenEnabled((signal) => suggestAnswer(message.payload, { signal }));
  }
  return undefined;
}
