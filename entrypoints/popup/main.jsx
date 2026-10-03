import { Button, ChakraProvider, defaultSystem } from '@chakra-ui/react';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import '../../src/ui/globals.css';
import { getActiveTab, sendToActiveTab } from '../../src/shared/browser.js';
import { settingsStore } from '../../src/shared/settings-store.js';

function Popup() {
  const [status, setStatus] = useState('Đang kiểm tra trang học...');
  const [powerOn, setPowerOn] = useState(true);
  const [autoPlayVideo, setAutoPlayVideo] = useState(false);
  const [showCourseStatus, setShowCourseStatus] = useState(false);
  const [autoNextLesson, setAutoNextLesson] = useState(true);
  const [autoLogin, setAutoLogin] = useState(false);
  const [screen, setScreen] = useState('home');
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
    setAutoLogin(settings.pttc1AutoLogin);
    const tab = await getActiveTab();
    const course = await sendToActiveTab(tab.id, { type: 'COURSE_STATUS' });
    if (!course?.supported) return setStatus('Mở trang LMS PTTC1 để bắt đầu.');
    const account = await sendToActiveTab(tab.id, { type: 'ACCOUNT_STATUS' });
    setStatus(
      account?.authenticated
        ? `Đã đăng nhập: ${account.displayName || account.accountId}`
        : `Đã nhận diện: ${course.provider}. Hãy đăng nhập trên LMS.`,
    );
  }
  async function login() {
    const tab = await getActiveTab();
    const account = await sendToActiveTab(tab.id, { type: 'ACCOUNT_STATUS' });
    if (account?.authenticated) {
      await sendToActiveTab(tab.id, { type: 'START_AUTO_RESUME' });
      setStatus('Đang tìm khóa có tiến độ thấp nhất...');
      return;
    }
    if (!tab.url?.includes('lms.pttc1.edu.vn/login/index.php')) {
      await browser.tabs.create({ url: 'https://lms.pttc1.edu.vn/login/index.php' });
      return setStatus('Đã mở trang đăng nhập. Bấm lại để đăng nhập tự động.');
    }
    const r = await sendToActiveTab(tab.id, { type: 'LOGIN_WITH_SAVED_CREDENTIALS' });
    setStatus(
      r?.ok
        ? 'Đang gửi biểu mẫu đăng nhập...'
        : r?.reason === 'captcha-required'
          ? 'LMS yêu cầu CAPTCHA; hãy tự hoàn tất.'
          : 'Chưa lưu tài khoản/mật khẩu hoặc không nhận diện được biểu mẫu.',
    );
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
  if (screen === 'settings') return <InlineSettings onBack={() => setScreen('home')} />;
  return (
    <main className="reference-popup w-90">
      <div className="reference-panel">
        <header className="flex items-center justify-between">
          <div className="reference-logo">
            <span className="reference-mark" />
            <span>CoursePilot</span>
          </div>
          <button
            className={`reference-power ${powerOn ? 'is-on' : 'is-off'}`}
            onClick={togglePower}
            aria-pressed={powerOn}
            aria-label={powerOn ? 'Tắt CoursePilot' : 'Bật CoursePilot'}
            title={powerOn ? 'Tắt CoursePilot' : 'Bật CoursePilot'}
          >
            ⏻
          </button>
        </header>
        <section className="mt-5">
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
        <section className="status-panel rounded-xl p-3">
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
          <span className="reference-title">Chuyển bài sau 2s</span>
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
        <div className="mt-5 grid gap-3">
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
            onClick={() => setScreen('settings')}
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
    llmModel: 'gpt-4o',
    llmApiKey: '',
  });
  const [saved, setSaved] = useState(false);
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
  return (
    <main className="reference-popup w-90">
      <div className="reference-panel">
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
          <div className="reference-rule" />
          <p className="eyebrow">Vilao AI</p>
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
