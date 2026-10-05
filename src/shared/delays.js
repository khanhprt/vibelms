import { DEFAULT_SETTINGS } from './constants.js';
import { settingsStore } from './settings-store.js';

// Nhịp chờ trước mọi thao tác tự động. Moodle cần khoảng 1s để ghi trạng thái
// sau khi bấm; các cú bấm liền nhau quá nhanh thường bị bỏ sót hoặc chồng lên
// nhau. Nhịp lấy từ cài đặt nên đặt ở shared để mọi nơi bấm trên trang LMS
// dùng chung một nhịp, thay vì mỗi module tự chế ra hằng số riêng.
const MIN_CLICK_DELAY_SECONDS = 0;
const MAX_CLICK_DELAY_SECONDS = 10;
const MIN_NEXT_LESSON_DELAY_SECONDS = 1;
const MAX_NEXT_LESSON_DELAY_SECONDS = 60;

function clampSeconds(value, { fallback, min, max }) {
  const seconds = Number(value);
  const safe = Number.isFinite(seconds) ? seconds : fallback;
  return Math.min(Math.max(safe, min), max);
}

export function clickDelayMs(value) {
  return (
    clampSeconds(value, {
      fallback: DEFAULT_SETTINGS.clickDelaySeconds,
      min: MIN_CLICK_DELAY_SECONDS,
      max: MAX_CLICK_DELAY_SECONDS,
    }) * 1000
  );
}

export function nextLessonDelayMs(value) {
  return (
    clampSeconds(value, {
      fallback: DEFAULT_SETTINGS.nextLessonDelaySeconds,
      min: MIN_NEXT_LESSON_DELAY_SECONDS,
      max: MAX_NEXT_LESSON_DELAY_SECONDS,
    }) * 1000
  );
}

// Chờ đúng nhịp đã cấu hình, dùng cho thao tác không đi qua click (ví dụ nộp form
// đăng nhập) để nhịp giữa các thao tác là đồng nhất.
export async function waitClickDelay() {
  const { clickDelaySeconds } = await settingsStore.get();
  await new Promise((resolve) => setTimeout(resolve, clickDelayMs(clickDelaySeconds)));
}

// Bấm sau khi chờ đúng nhịp đã cấu hình.
// Moodle hay thay cả khối giữa hai lần render, nên phần tử đã rời DOM thì bỏ qua
// và trả false — nơi gọi cần biết để không tưởng rằng đã bấm thành công.
export async function clickWithDelay(element) {
  if (!element) return false;
  await waitClickDelay();
  if (!element.isConnected) return false;
  element.click();
  return true;
}