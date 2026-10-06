import { Button, ChakraProvider, defaultSystem } from '@chakra-ui/react';
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import '../../src/ui/globals.css';
import { getActiveTab, sendToActiveTab } from '../../src/shared/browser.js';
import { settingsStore } from '../../src/shared/settings-store.js';
import { exportSettingsFile, readSettingsFile } from '../../src/shared/settings-file.js';

function connectionStatusText(result) {
  const detail = result?.error ? ` (${result.error})` : '';
  return `Không kết nối được với tab LMS. Kiểm tra quyền truy cập trang web của extension, rồi tải lại tab.${detail}`;
}

function loginStatusText(result) {
  if (!result || result.reason === 'connection-failed') return connectionStatusText(result);
  if (result.error) return `Lỗi đăng nhập: ${result.error}`;
  if (result?.ok) {
    return result.loggingOut
      ? 'Đang đăng xuất để đăng nhập bằng tài khoản đã lưu...'
      : 'Đang gửi biểu mẫu đăng nhập...';
  }

  const messages = {
    'captcha-required': 'LMS yêu cầu CAPTCHA; hãy tự hoàn tất.',
    'username-missing': 'Chưa lưu tài khoản PTTC1. Mở cài đặt AI để nhập tài khoản.',
    'password-missing': 'Chưa lưu mật khẩu PTTC1. Mở cài đặt AI và nhập lại mật khẩu.',
    'login-form-not-found': 'Không nhận diện được biểu mẫu đăng nhập trên trang này. Hãy tải lại trang đăng nhập rồi thử lại.',
    'login-page-missing': 'Hãy mở đúng trang đăng nhập PTTC1 rồi bấm lại.',
    'domain-not-allowed': 'Domain LMS này chưa nằm trong danh sách được phép.',
    'extension-disabled': 'Hãy bật công tắc nguồn để đăng nhập tự động.',
  };

  return messages[result?.reason] || 'Chưa thể đăng nhập tự động. Hãy kiểm tra tài khoản, mật khẩu và trang đăng nhập.';
}

function Popup() {
  const [status, setStatus] = useState('Đang kiểm tra trang học...');
  const [powerOn, setPowerOn] = useState(true);
  const [autoPlayVideo, setAutoPlayVideo] = useState(false);
  const [showCourseStatus, setShowCourseStatus] = useState(false);
  const [autoNextLesson, setAutoNextLesson] = useState(true);
  const [nextLessonDelaySeconds, setNextLessonDelaySeconds] = useState(5);
  const [forumHelperEnabled, setForumHelperEnabled] = useState(true);
  const [autoLogin, setAutoLogin] = useState(false);
  const [quizExport, setQuizExport] = useState(false);
  const [screen] = useState(() =>
    new URLSearchParams(window.location.search).get('screen') === 'settings' ? 'settings' : 'home',
  );
  useEffect(() => {
    refresh();
  }, []);
  // Giữ trạng thái nút nguồn đồng bộ nếu người dùng đổi từ cửa sổ popup khác.
  useEffect(() => {
    const onChanged = (changes, area) => {
      if (area === 'local' && 'extensionEnabled' in changes) {
        setPowerOn(changes.extensionEnabled.newValue !== false);
      }
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, []);
  async function refresh() {
    const settings = await settingsStore.get();
    setPowerOn(settings.extensionEnabled !== false);
    setAutoPlayVideo(settings.autoPlayVideo);
    setShowCourseStatus(settings.showCourseStatus);
    setAutoNextLesson(settings.autoNextLesson);
    setNextLessonDelaySeconds(settings.nextLessonDelaySeconds);
    setForumHelperEnabled(settings.forumHelperEnabled !== false);
    setAutoLogin(settings.pttc1AutoLogin);
    setQuizExport(Boolean(settings.quizExportEnabled));
    const tab = await getActiveTab();
    const course = await sendToActiveTab(tab.id, { type: 'COURSE_STATUS' });
    if (!course || course.error || course.reason === 'connection-failed') return setStatus(connectionStatusText(course));
    if (!course?.supported) return setStatus('Mở trang LMS PTTC1 để bắt đầu.');
    if (!course.enabled) return setStatus('Extension đang tắt.');
    if (course.courseFinished) return setStatus(course.returningToCourses
      ? 'Đã kết thúc khóa. Đang quay về danh sách khóa học...'
      : 'Đã kết thúc khóa. Bấm học tiếp để chuyển sang khóa khác.');
    if (!course.autoNextLesson && tab.url?.includes('/mod/'))
      return setStatus('Tự chuyển bài đang tắt; trang hiện tại sẽ không tự chuyển tiếp.');
    const account = await sendToActiveTab(tab.id, { type: 'ACCOUNT_STATUS' });
    if (!account || account.error) return setStatus(connectionStatusText(account));
    setStatus(
      account?.authenticated
        ? `Đã đăng nhập: ${account.displayName || account.accountId || 'LMS'}`
        : tab.url?.includes('/login/index.php')
          ? 'Hãy đăng nhập trên LMS.'
          : 'Đã kết nối LMS. Chưa đọc được thông tin tài khoản trên trang này.',
    );
  }
  async function login() {
    let tab = await getActiveTab();
    if (new URL(tab.url || 'about:blank').hostname !== 'lms.pttc1.edu.vn') {
      const tabs = await browser.tabs.query({ url: 'https://lms.pttc1.edu.vn/*' });
      tab = tabs.find((item) => /\/mod\//.test(new URL(item.url).pathname)) || tabs[0] || tab;
      if (tabs.length) await browser.tabs.update(tab.id, { active: true });
    }
    const course = await sendToActiveTab(tab.id, { type: 'COURSE_STATUS' });
    if (course?.supported && !tab.url?.includes('/login/index.php')) {
      const result = await sendToActiveTab(tab.id, { type: 'START_AUTO_RESUME' });
      setStatus(result?.ok
        ? result.returningToCourses
          ? 'Đã kết thúc khóa. Đang quay về danh sách khóa học...'
          : result.resumedCurrentCourse
            ? result.waitingForActivities
              ? 'Đang chờ danh sách nội dung của chương tải xong...'
              : 'Đang mở nội dung trong khóa học hiện tại...'
          : result.resumedCurrentActivity
          ? 'Đang tiếp tục hoạt động hiện tại.'
          : 'Đang tìm khóa có tiến độ thấp nhất...'
        : result?.reason === 'extension-disabled'
          ? 'Hãy bật công tắc nguồn để tiếp tục học.'
          : 'Chưa thể tiếp tục trên tab LMS này.');
      return;
    }
    if (new URL(tab.url || 'about:blank').hostname === 'lms.pttc1.edu.vn' &&
      !tab.url?.includes('/login/index.php')) {
      return setStatus(connectionStatusText(course));
    }
    if (!tab.url?.includes('lms.pttc1.edu.vn/login/index.php')) {
      await browser.tabs.create({ url: 'https://lms.pttc1.edu.vn/login/index.php' });
      return setStatus('Đã mở trang đăng nhập. Bấm lại để đăng nhập tự động.');
    }
    const r = await sendToActiveTab(tab.id, { type: 'LOGIN_WITH_SAVED_CREDENTIALS' });
    setStatus(loginStatusText(r));
  }
  async function togglePower() {
    const value = !powerOn;
    await settingsStore.patch({ extensionEnabled: value });
    setPowerOn(value);
    setStatus(
      value
        ? 'Đã bật. Đang tiếp tục luồng học.'
        : 'Đã tắt. Mọi thao tác tự động đang dừng.',
    );
  }
  async function toggleAutoPlay() {
    const value = !autoPlayVideo;
    await settingsStore.patch({ autoPlayVideo: value });
    setAutoPlayVideo(value);
    setStatus(value ? 'Tự phát video đã bật.' : 'Tự phát video đã tắt.');
  }
  async function toggleCourseStatus() {
    const value = !showCourseStatus;
    await settingsStore.patch({ showCourseStatus: value });
    setShowCourseStatus(value);
    const tab = await getActiveTab();
    await sendToActiveTab(tab.id, { type: 'REFRESH_COURSE_PANEL' });
  }
  async function toggleAutoNext() {
    const value = !autoNextLesson;
    await settingsStore.patch({ autoNextLesson: value });
    setAutoNextLesson(value);
  }
  async function toggleAutoLogin() {
    const value = !autoLogin;
    await settingsStore.patch({ pttc1AutoLogin: value });
    setAutoLogin(value);
  }
  async function toggleForumHelper() {
    const value = !forumHelperEnabled;
    await settingsStore.patch({ forumHelperEnabled: value });
    setForumHelperEnabled(value);
    setStatus(value ? 'Đã bật hỗ trợ Forum.' : 'Đã tắt hỗ trợ Forum.');
  }
  // Đọc câu hỏi diễn ra trong content script, nên bật công tắc rồi tải lại trang quiz.
  async function toggleQuizExport() {
    const value = !quizExport;
    await settingsStore.patch({ quizExportEnabled: value });
    setQuizExport(value);
    setStatus(
      value
        ? 'Đã bật trích xuất câu hỏi. Tải lại trang quiz để áp dụng.'
        : 'Đã tắt trích xuất câu hỏi.',
    );
  }
  // Reloading the popup document lets the browser measure the shorter settings screen,
  // rather than retain the height required by the home screen.
  if (screen === 'settings')
    return <InlineSettings onBack={() => window.location.assign(window.location.pathname)} />;
  return (
    <main className="reference-popup">
      <div className="reference-panel home-panel">
        <header className="flex items-center justify-between">
          <div className="reference-logo">
            <span className="reference-mark" />
            <span>Vernal</span>
          </div>
          <button
            className={`reference-power ${powerOn ? 'is-on' : 'is-off'}`}
            onClick={togglePower}
            aria-pressed={powerOn}
            aria-label={powerOn ? 'Tắt Vernal' : 'Bật Vernal'}
            title={powerOn ? 'Tắt Vernal' : 'Bật Vernal'}
          >
            ⏻
          </button>
        </header>
        <section className="home-summary mt-5">
          <div className="reference-stat">
            <span>Trạng thái</span>
            <span className={`reference-value ${powerOn ? '' : 'is-off'}`}>
              {powerOn ? 'ONLINE' : 'TẮT'}
            </span>
          </div>
          <div className="reference-stat">
            <span>AI Learning Assist</span>
            <span className="reference-value">
              {!powerOn ? 'OFF' : autoPlayVideo ? 'ACTIVE' : 'PAUSED'}
            </span>
          </div>
          <div className="reference-stat">
            <span>Tiến trình phiên</span>
            <span className="reference-value">—</span>
          </div>
        </section>
        <div className="reference-rule" />
        <section className="home-account status-panel rounded-xl p-3">
          <p className="eyebrow">Trạng thái tài khoản</p>
          <p className="mt-1 text-xs text-slate-200">{status}</p>
        </section>
        <div className="reference-rule mt-2" />
        <p className="mb-2 text-[13px] font-extrabold text-emerald-50">
          Bảng điều khiển học tập
        </p>
        <div className="reference-row">
          <span className="reference-icon">%</span>
          <span className="reference-title">Popup tiến độ khóa học</span>
          <input
            className="reference-switch"
            type="checkbox"
            checked={showCourseStatus}
            onChange={toggleCourseStatus}
          />
          <span className="reference-chevron">›</span>
        </div>
        <div className="reference-row">
          <span className="reference-icon">AI</span>
          <span className="reference-title">Tự phát video</span>
          <input
            className="reference-switch"
            type="checkbox"
            checked={autoPlayVideo}
            onChange={toggleAutoPlay}
          />
          <span className="reference-chevron">›</span>
        </div>
        <div className="reference-row">
          <span className="reference-icon">→</span>
          <span className="reference-title">Chuyển bài sau {nextLessonDelaySeconds}s</span>
          <input
            className="reference-switch"
            type="checkbox"
            checked={autoNextLesson}
            onChange={toggleAutoNext}
          />
          <span className="reference-chevron">›</span>
        </div>
        <div className="reference-row">
          <span className="reference-icon">✦</span>
          <span className="reference-title">Đăng nhập tự động</span>
          <input
            className="reference-switch"
            type="checkbox"
            checked={autoLogin}
            onChange={toggleAutoLogin}
          />
          <span className="reference-chevron">›</span>
        </div>
        <div className="reference-row">
          <span className="reference-icon">?</span>
          <span className="reference-title">Trích xuất câu hỏi quiz</span>
          <input
            className="reference-switch"
            type="checkbox"
            checked={quizExport}
            onChange={toggleQuizExport}
          />
          <span className="reference-chevron">›</span>
        </div>
        <div className="reference-row">
          <span className="reference-icon">F</span>
          <span className="reference-title">Hỗ trợ Forum</span>
          <input
            className="reference-switch"
            type="checkbox"
            checked={forumHelperEnabled}
            onChange={toggleForumHelper}
          />
          <span className="reference-chevron">›</span>
        </div>
        <div className="home-actions mt-5 grid gap-3">
          <Button className="ai-button w-full" variant="outline" colorPalette="green" onClick={async () => {
            try {
              const result = await browser.runtime.sendMessage({type: 'RUN_LOG_EXPORT'});
              setStatus(result?.ok ? `Đã lưu log: ${result.filename}` : 'Chưa có nhật ký phiên học.');
            } catch {
              setStatus('Không tải được log. Nhật ký vẫn được lưu trong extension.');
            }
          }}>Tải log phiên học</Button>
          <Button
            className="ai-button w-full"
            onClick={login}
            isDisabled={!powerOn}
            colorPalette="green"
          >
            ▶ Bắt đầu học tiếp
          </Button>
          <Button
            className="ai-button w-full"
            onClick={() => window.location.assign(`${window.location.pathname}?screen=settings`)}
            variant="outline"
            colorPalette="green"
          >
            Mở cài đặt AI
          </Button>
        </div>
      </div>
    </main>
  );
}

function InlineSettings({ onBack }) {
  const [settings, setSettings] = useState({
    pttc1Username: '',
    pttc1Password: '',
    pttc1AutoLogin: false,
    nextLessonDelaySeconds: 5,
    clickDelaySeconds: 1,
    llmModel: 'gpt-4o',
    llmApiKey: '',
  });
  const [saved, setSaved] = useState(false);
  const [backup, setBackup] = useState('');
  const fileInput = useRef(null);
  useEffect(() => {
    settingsStore.get().then((value) =>
      setSettings((current) => ({
        ...current,
        ...value,
        pttc1Password: '',
        llmApiKey: '',
      })),
    );
  }, []);
  const update = (key, value) => setSettings((current) => ({ ...current, [key]: value }));
  async function save(event) {
    event.preventDefault();
    const { pttc1Password, llmApiKey, ...rest } = settings;
    await settingsStore.patch({
      ...rest,
      ...(pttc1Password ? { pttc1Password } : {}),
      ...(llmApiKey ? { llmApiKey } : {}),
    });
    setSettings((current) => ({ ...current, pttc1Password: '', llmApiKey: '' }));
    setSaved(true);
  }
  // Nạp cấu hình từ file: giữ nguyên mật khẩu/API key đang lưu nếu file không có.
  async function importSettings(file) {
    try {
      const incoming = await readSettingsFile(file);
      const current = await settingsStore.get();
      await settingsStore.patch({
        ...incoming,
        pttc1Password: incoming.pttc1Password || current.pttc1Password,
        llmApiKey: incoming.llmApiKey || current.llmApiKey,
      });
      const merged = await settingsStore.get();
      setSettings((current) => ({
        ...current,
        ...merged,
        pttc1Password: '',
        llmApiKey: '',
      }));
      setSaved(false);
      setBackup(`Đã nạp ${Object.keys(incoming).length} trường từ ${file.name}.`);
    } catch (error) {
      setBackup(error.message || 'Không nạp được file cấu hình.');
    }
  }
  async function exportSettings() {
    exportSettingsFile(await settingsStore.get());
    setBackup('Đã tải cấu hình. File chứa mật khẩu và API key dạng chữ thường.');
  }
  return (
    <main className="reference-popup">
      <div className="reference-panel inline-settings-panel">
        <header className="flex items-center justify-between">
          <button className="reference-power" onClick={onBack} aria-label="Quay lại">
            ←
          </button>
          <div className="reference-logo">
            <span className="reference-mark" />
            <span>Cài đặt</span>
          </div>
          <span className="text-xs text-emerald-200">AI</span>
        </header>
        <form onSubmit={save} className="mt-4">
          <p className="eyebrow">Tài khoản PTTC1</p>
          <input
            className="reference-key mt-2"
            placeholder="Tài khoản"
            value={settings.pttc1Username}
            onChange={(e) => update('pttc1Username', e.target.value)}
          />
          <input
            className="reference-key mt-2"
            type="password"
            placeholder="Mật khẩu — để trống để giữ cũ"
            value={settings.pttc1Password}
            onChange={(e) => update('pttc1Password', e.target.value)}
          />
          <label className="reference-row">
            <span className="reference-title">Tự đăng nhập PTTC1</span>
            <input
              className="reference-switch"
              type="checkbox"
              checked={settings.pttc1AutoLogin}
              onChange={(e) => update('pttc1AutoLogin', e.target.checked)}
            />
          </label>
          <label className="reference-row">
            <span className="reference-title">Chờ trước khi chuyển bài (giây)</span>
            <input
              className="reference-key py-2 text-center"
              style={{ width: '5rem' }}
              type="number"
              min="1"
              max="60"
              step="1"
              value={settings.nextLessonDelaySeconds}
              onChange={(e) =>
                update(
                  'nextLessonDelaySeconds',
                  Math.min(60, Math.max(1, Number(e.target.value) || 1)),
                )
              }
              aria-label="Số giây chờ trước khi chuyển bài"
            />
          </label>
          <label className="reference-row">
            <span className="reference-title">Nghỉ trước mỗi lần bấm (giây)</span>
            <input
              className="reference-key py-2 text-center"
              style={{ width: '5rem' }}
              type="number"
              min="0"
              max="10"
              step="0.5"
              value={settings.clickDelaySeconds}
              onChange={(e) =>
                update('clickDelaySeconds', Math.min(10, Math.max(0, Number(e.target.value) || 0)))
              }
              aria-label="Số giây nghỉ trước mỗi lần bấm tự động"
            />
          </label>
          <p className="mt-1 text-[11px] leading-5 text-slate-300/80">
            Khoảng nghỉ chung trước mọi cú bấm tự động (chuyển bài, trả lời quiz, nộp bài).
            Tăng lên nếu thấy LMS bỏ sót thao tác. Đặt 0 để bấm ngay.
          </p>
          <div className="reference-rule" />
          <p className="eyebrow">AI Config</p>
          <input
            className="reference-key mt-2"
            placeholder="Model"
            value={settings.llmModel}
            onChange={(e) => update('llmModel', e.target.value)}
          />
          <input
            className="reference-key mt-2"
            type="password"
            placeholder="API Auth (sk-...)"
            value={settings.llmApiKey}
            onChange={(e) => update('llmApiKey', e.target.value)}
          />
          <Button className="ai-button mt-4 w-full" type="submit" colorPalette="green">
            Lưu cài đặt
          </Button>
          {saved && (
            <p className="mt-2 text-center text-xs text-emerald-200">Đã lưu cấu hình.</p>
          )}
          <div className="reference-rule" />
          <p className="eyebrow">Sao lưu cấu hình</p>
          <p className="mt-2 text-[11px] leading-5 text-amber-200/70">
            File cấu hình chứa mật khẩu LMS và API key ở dạng chữ thường. Chỉ nạp từ file
            do chính bạn xuất ra.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const [file] = event.target.files || [];
              // reset value để chọn lại cùng một file vẫn kích hoạt onChange
              event.target.value = '';
              if (file) importSettings(file);
            }}
          />
          <div className="backup-actions mt-2 grid grid-cols-2 gap-2">
            <Button
              className="ai-button w-full"
              variant="outline"
              colorPalette="green"
              onClick={() => fileInput.current?.click()}
            >
              Nạp từ file .json
            </Button>
            <Button
              className="ai-button w-full"
              variant="outline"
              colorPalette="green"
              onClick={exportSettings}
            >
              Xuất cấu hình
            </Button>
          </div>
          {backup && (
            <p className="mt-2 text-center text-[11px] leading-5 text-emerald-200">
              {backup}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
createRoot(document.querySelector('#root')).render(
  <ChakraProvider value={defaultSystem}>
    <Popup />
  </ChakraProvider>,
);
