import { createLearningController } from '../src/content/learning-controller.js';
import { resolveProvider } from '../src/providers/provider-registry.js';

export default defineContentScript({
  matches: ['https://*/*'],
  runAt: 'document_idle',
  main() {
    const provider = resolveProvider(window.location);
    if (!provider) return;

    const controller = createLearningController(provider);
    browser.runtime.onMessage.addListener((message) => controller.handleMessage(message));
    // Công tắc nguồn ở popup bật/tắt: nội dung script phải phản ứng ngay, không cần reload trang.
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if ('extensionEnabled' in changes)
        controller.setEnabled(changes.extensionEnabled.newValue !== false);
      if ('forumHelperEnabled' in changes) controller.refreshForumHelper();
    });
  },
});
