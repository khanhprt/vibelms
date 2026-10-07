import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../src/content/quiz-extractor.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/export /g, '');

function setup({ response, readerResult = 'data:image/png;base64,AA==' }) {
  const logs = [];
  const context = createContext({
    console: { warn() {} },
    logActivity: (...entry) => logs.push(entry),
    fetch: async () => response,
    FileReader: class {
      readAsDataURL() {
        this.result = readerResult;
        this.onload();
      }
    },
  });
  runInContext(source, context);
  return { context, logs };
}

test('tải ảnh Moodle bằng credentials, chuyển thành data URL và ghi log rõ ràng', async () => {
  const response = {
    ok: true,
    blob: async () => ({ type: 'image/png', size: 1536 }),
  };
  const env = setup({ response });
  const [asset] = await env.context.prepareVisionAssets([
    { src: 'https://lms.example.test/pluginfile.php/42/chart.png', alt: 'Biểu đồ câu hỏi' },
  ]);

  assert.equal(asset.dataUrl, 'data:image/png;base64,AA==');
  assert.deepEqual(env.logs, [
    ['info', 'Đang tải ảnh quiz để gửi Gemini', 'Biểu đồ câu hỏi'],
    ['success', 'Đã chuẩn bị ảnh quiz cho Gemini', 'Biểu đồ câu hỏi · 2 KB · image/png'],
  ]);
});

test('ảnh tải lỗi được giữ nguyên để quiz text vẫn tiếp tục và có log cảnh báo', async () => {
  const env = setup({ response: { ok: false, status: 403 } });
  const [asset] = await env.context.prepareVisionAssets([{ src: 'https://lms.example.test/private.png' }]);

  assert.equal(asset.dataUrl, undefined);
  assert.equal(env.logs[0][0], 'info');
  assert.equal(env.logs[1][0], 'warn');
  assert.match(env.logs[1][1], /Không thể tải ảnh/);
  assert.match(env.logs[1][2], /HTTP 403/);
});
