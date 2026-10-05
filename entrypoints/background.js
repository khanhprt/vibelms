import { handleMessage } from '../src/background/message-router.js';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message) => {
    const result = handleMessage(message);
    // Người gọi tự bắt lỗi qua sendMessage, nên rejection ở đây không phải lỗi chưa xử lý.
    // Gắn catch rỗng để service worker không ghi "Uncaught Error" ra console.
    if (result?.catch) result.catch(() => {});
    return result;
  });
});
