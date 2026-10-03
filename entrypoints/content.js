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
      if (area !== 'local' || !('extensionEnabled' in changes)) return;
      controller.setEnabled(changes.extensionEnabled.newValue !== false);
    });
  },
});
