import { createLearningController } from '../src/content/learning-controller.js';
import { resolveProvider } from '../src/providers/provider-registry.js';
import { MESSAGE } from '../src/shared/constants.js';
import { createMessageListener } from '../src/shared/message-listener.js';

export default defineContentScript({
  matches: ['https://*/*'],
  runAt: 'document_idle',
  main(ctx) {
    const provider = resolveProvider(window.location);
    if (!provider) return;

    const controller = createLearningController(provider);
    const onMessage = createMessageListener([
      MESSAGE.COURSE_STATUS, MESSAGE.ACCOUNT_STATUS, MESSAGE.NEXT_LESSON,
      MESSAGE.LOGIN_WITH_SAVED_CREDENTIALS, MESSAGE.REFRESH_COURSE_PANEL,
      MESSAGE.START_AUTO_RESUME,
    ], message => controller.handleMessage(message));
    browser.runtime.onMessage.addListener(onMessage);
    // Công tắc nguồn ở popup bật/tắt: nội dung script phải phản ứng ngay, không cần reload trang.
    const onChanged = (changes, area) => {
      if (area !== 'local') return;
      if ('extensionEnabled' in changes)
        controller.setEnabled(changes.extensionEnabled.newValue !== false);
      if ('forumHelperEnabled' in changes) controller.refreshForumHelper();
      if (['nextLessonDelaySeconds', 'autoNextLesson', 'autoPlayVideo'].some(key => key in changes))
        controller.refreshSettings();
    };
    browser.storage.onChanged.addListener(onChanged);
    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(onMessage);
      browser.storage.onChanged.removeListener(onChanged);
      controller.destroy();
    });
  },
});
