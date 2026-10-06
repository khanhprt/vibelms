import { handleMessage } from '../src/background/message-router.js';
import { MESSAGE } from '../src/shared/constants.js';
import { createMessageListener } from '../src/shared/message-listener.js';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(createMessageListener([
    MESSAGE.GENERATE_DISCUSSION, MESSAGE.GENERATE_FORUM_REPLY,
    MESSAGE.SUGGEST_QUIZ_ANSWER, MESSAGE.BIND_ACCOUNT,
    'RUN_LOG_START', 'RUN_LOG_FAILURE', 'RUN_LOG_FINISH', 'RUN_LOG_EXPORT',
  ], handleMessage));
});
