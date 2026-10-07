import { createLearningController } from '../src/content/learning-controller.js';
import { resolveProvider } from '../src/providers/provider-registry.js';
import { MESSAGE } from '../src/shared/constants.js';
import { createMessageListener } from '../src/shared/message-listener.js';
import { settingsStore } from '../src/shared/settings-store.js';
import {
  logActivity,
  mountActivityLogPanel,
  removeActivityLogPanel,
  setActivityLogStatus,
} from '../src/content/activity-log.js';

export default defineContentScript({
  matches: ['https://*/*'],
  runAt: 'document_idle',
  main(ctx) {
    const provider = resolveProvider(window.location);
    if (!provider) return;

    const controller = createLearningController(provider);

    // Panel nhật ký chỉ gắn trên trang LMS được hỗ trợ. Người dùng bấm đóng là tắt hẳn
    // (ghi vào showActivityLog) và mở lại từ popup, nên không hiện lại ở trang mới.
    async function syncActivityLogPanel() {
      const settings = await settingsStore.get();
      if (settings.showActivityLog === false) {
        removeActivityLogPanel();
        return;
      }
      mountActivityLogPanel();
      setActivityLogStatus({
        enabled: settings.extensionEnabled !== false,
        supported: true,
        provider: provider.id,
        path: `${location.hostname}${location.pathname}`,
      });
    }

    // Ghi nhật ký trước để panel dựng lên là thấy ngay extension đã bám trang.
    logActivity('info', 'Extension đã bám vào trang', `adapter: ${provider.id}`);
    settingsStore.get().then((settings) => {
      const on = settings.extensionEnabled !== false;
      logActivity(
        on ? 'success' : 'warn',
        on ? 'Công tắc nguồn đang bật' : 'Công tắc nguồn đang tắt — không chạy tự động',
        `${location.hostname}${location.pathname}`,
      );
    });
    syncActivityLogPanel();

    const onMessage = createMessageListener([
      MESSAGE.COURSE_STATUS, MESSAGE.ACCOUNT_STATUS, MESSAGE.NEXT_LESSON,
      MESSAGE.LOGIN_WITH_SAVED_CREDENTIALS, MESSAGE.REFRESH_COURSE_PANEL,
      MESSAGE.START_AUTO_RESUME,
    ], message => controller.handleMessage(message));
    browser.runtime.onMessage.addListener(onMessage);
    // Công tắc nguồn ở popup bật/tắt: nội dung script phải phản ứng ngay, không cần reload trang.
    const onChanged = (changes, area) => {
      if (area !== 'local') return;
      if ('showActivityLog' in changes) syncActivityLogPanel();
      if ('extensionEnabled' in changes) {
        const on = changes.extensionEnabled.newValue !== false;
        setActivityLogStatus({ enabled: on });
        logActivity(
          on ? 'info' : 'warn',
          on ? 'Đã bật công tắc nguồn' : 'Đã tắt công tắc nguồn — dừng mọi thao tác tự động',
        );
        controller.setEnabled(on);
        if (on) {
          // Tự động bật lại nhật ký hoạt động khi bật công tắc nguồn
          settingsStore.patch({ showActivityLog: true }).catch(() => {});
        }
      }
      if ('forumHelperEnabled' in changes) controller.refreshForumHelper();
      if (['nextLessonDelaySeconds', 'autoNextLesson', 'autoPlayVideo'].some(key => key in changes))
        controller.refreshSettings();
    };
    browser.storage.onChanged.addListener(onChanged);
    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(onMessage);
      browser.storage.onChanged.removeListener(onChanged);
      controller.destroy();
      removeActivityLogPanel();
    });
  },
});
