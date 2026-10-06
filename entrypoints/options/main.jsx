import { Button, ChakraProvider, defaultSystem } from '@chakra-ui/react';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import '../../src/ui/globals.css';
import '../../src/ui/settings-theme.css';
import { DEFAULT_SETTINGS } from '../../src/shared/constants.js';
import { settingsStore } from '../../src/shared/settings-store.js';
import { clearQuizDump, readQuizDump } from '../../src/shared/quiz-export.js';

function Options() {
  const [form, setForm] = useState(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [dump, setDump] = useState(null);
  useEffect(() => {
    settingsStore
      .get()
      .then((settings) => setForm({ ...settings, pttc1Password: '', llmApiKey: '' }));
    readQuizDump().then(setDump);
  }, []);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event) {
    event.preventDefault();
    const { pttc1Password, llmApiKey, ...rest } = form;
    await settingsStore.patch({
      ...rest,
      ...(pttc1Password ? { pttc1Password } : {}),
      ...(llmApiKey ? { llmApiKey } : {}),
      allowedDomains:
        typeof form.allowedDomains === 'string'
          ? form.allowedDomains
              .split('\n')
              .map((v) => v.trim())
              .filter(Boolean)
          : form.allowedDomains,
    });
    setForm((c) => ({ ...c, pttc1Password: '', llmApiKey: '' }));
    setSaved(true);
  }
  const domains = Array.isArray(form.allowedDomains)
    ? form.allowedDomains.join('\n')
    : form.allowedDomains;
  async function resetDump() {
    await clearQuizDump();
    setDump(null);
  }
  return (
    <main className="settings-page">
      <div className="settings-panel">
        <header className="flex items-center gap-3">
          <div className="brand-orb">
            <img src="/icon.png" alt="Vernal" />
          </div>
          <div>
            <p className="eyebrow">Configuration studio</p>
            <h1 className="m-0 text-2xl font-black text-white">Vernal AI</h1>
          </div>
        </header>
        <p className="settings-intro">
          Thiết lập trải nghiệm học tập tự động, riêng tư và có kiểm soát.
        </p>
        <form onSubmit={submit} className="settings-form">
          <section className="section-card">
            <p className="eyebrow">01 · PTTC1 identity</p>
            <h2 className="mt-1 text-base font-bold text-white">Đăng nhập thông minh</h2>
            <div className="mt-4 grid gap-3">
              <div>
                <label className="field-label">Tài khoản PTTC1</label>
                <input
                  className="ai-input"
                  placeholder="Mã sinh viên / tài khoản"
                  value={form.pttc1Username}
                  onChange={(e) => update('pttc1Username', e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">Mật khẩu</label>
                <input
                  className="ai-input"
                  placeholder="Để trống để giữ mật khẩu cũ"
                  type="password"
                  value={form.pttc1Password}
                  onChange={(e) => update('pttc1Password', e.target.value)}
                />
              </div>
              <label className="flex cursor-pointer items-center justify-between rounded-xl bg-white/4 p-3 text-sm text-slate-200">
                <span>Tự đăng nhập khi mở PTTC1</span>
                <input
                  className="switch"
                  type="checkbox"
                  checked={form.pttc1AutoLogin}
                  onChange={(e) => update('pttc1AutoLogin', e.target.checked)}
                />
              </label>
              <label className="flex cursor-pointer items-center justify-between rounded-xl bg-white/4 p-3 text-sm text-slate-200">
                <span>Trích xuất câu hỏi trên trang quiz</span>
                <input
                  className="switch"
                  type="checkbox"
                  checked={Boolean(form.quizExportEnabled)}
                  onChange={(e) => update('quizExportEnabled', e.target.checked)}
                />
              </label>
              <p className="text-xs text-slate-400">
                Chỉ đọc câu hỏi và các lựa chọn để bạn xem lại. Extension không chọn đáp
                án và không nộp bài.
              </p>
              <label className="mt-3 flex cursor-pointer items-center justify-between rounded-xl bg-white/4 p-3 text-sm text-slate-200">
                <span>Tự bấm nút Bắt đầu khi mở trang quiz</span>
                <input
                  className="switch"
                  type="checkbox"
                  checked={Boolean(form.autoStartQuiz)}
                  onChange={(e) => update('autoStartQuiz', e.target.checked)}
                />
              </label>
              <p className="text-xs text-amber-300/80">
                Mỗi lần tải trang bắt đầu, extension bấm giúp một lần — tức là tiêu một
                lượt làm bài có chấm điểm. Nút xem thử (Preview) không bao giờ bị bấm.
              </p>
              <div className="mt-3">
                <label className="field-label">Nghỉ trước mỗi lần bấm (giây)</label>
                <input
                  className="ai-input"
                  type="number"
                  min="0"
                  max="10"
                  step="0.5"
                  value={form.clickDelaySeconds}
                  onChange={(e) =>
                    update('clickDelaySeconds', Math.min(10, Math.max(0, Number(e.target.value) || 0)))
                  }
                />
                <p className="mt-2 text-xs text-slate-400">
                  Khoảng nghỉ chung trước mọi cú bấm tự động: chuyển bài, chọn đáp án,
                  nộp bài. Moodle cần thời gian để ghi trạng thái giữa các thao tác —
                  tăng lên nếu thấy thao tác bị bỏ sót, đặt 0 để bấm ngay.
                </p>
              </div>
              <div className="mt-3">
                <label className="field-label">Chờ trước khi chuyển bài (giây)</label>
                <input
                  className="ai-input"
                  type="number"
                  min="1"
                  max="60"
                  step="1"
                  value={form.nextLessonDelaySeconds}
                  onChange={(e) =>
                    update(
                      'nextLessonDelaySeconds',
                      Math.min(60, Math.max(1, Number(e.target.value) || 1)),
                    )
                  }
                />
                <p className="mt-2 text-xs text-slate-400">
                  Thời gian chờ trên trang activity trước khi bấm “Hoạt động tiếp theo”.
                </p>
              </div>
            </div>
          </section>
          <section className="section-card">
            <p className="eyebrow">02 · AI gateway</p>
            <h2 className="mt-1 text-base font-bold text-white">
              Kết nối trí tuệ nhân tạo
            </h2>
            <div className="mt-4 grid gap-3">
              <input
                className="ai-input"
                placeholder="Model (ví dụ: gpt-4o)"
                value={form.llmModel}
                onChange={(e) => update('llmModel', e.target.value)}
              />
              <input
                className="ai-input"
                placeholder="API Auth (sk-...) — để trống để giữ key cũ"
                type="password"
                value={form.llmApiKey}
                onChange={(e) => update('llmApiKey', e.target.value)}
              />
            </div>
          </section>
          <section className="section-card">
            <p className="eyebrow">03 · Access boundary</p>
            <textarea
              className="ai-input mt-3 min-h-24 resize-y"
              placeholder="Domain LMS, mỗi dòng một domain"
              value={domains}
              onChange={(e) => update('allowedDomains', e.target.value)}
            />
          </section>
          <section className="section-card">
            <p className="eyebrow">04 · Dữ liệu câu hỏi</p>
            <h2 className="mt-1 text-base font-bold text-white">
              Kho câu hỏi đã trích xuất
            </h2>
            <div className="mt-4 grid gap-3">
              <p className="text-sm text-slate-300">
                {dump?.questions?.length
                  ? `${dump.questions.length} câu hỏi · ${dump.quizName || 'Không rõ tên quiz'} · lưu lúc ${new Date(dump.capturedAt).toLocaleString('vi-VN')}`
                  : 'Chưa có dữ liệu. Bật công tắc ở mục 01 rồi mở trang làm bài quiz.'}
              </p>
              <Button
                className="ai-button w-full"
                variant="outline"
                colorPalette="red"
                isDisabled={!dump?.questions?.length}
                onClick={resetDump}
              >
                Xoá dữ liệu đã lưu
              </Button>
            </div>
          </section>
          <Button className="ai-button w-full" type="submit" colorPalette="teal">
            ✦ Lưu cấu hình AI
          </Button>
          {saved && (
            <p className="text-center text-sm font-medium text-emerald-300">
              ✓ Đã đồng bộ cấu hình.
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
createRoot(document.querySelector('#root')).render(
  <ChakraProvider value={defaultSystem}>
    <Options />
  </ChakraProvider>,
);
