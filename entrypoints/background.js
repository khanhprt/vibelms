import { handleMessage } from '../src/background/message-router.js';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(handleMessage);
});

