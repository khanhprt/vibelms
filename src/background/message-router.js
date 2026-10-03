import { MESSAGE } from '../shared/constants.js';
import { generateDiscussionDraft } from '../services/llm-client.js';
import { bindLmsAccount } from '../services/account-binding.js';

export async function handleMessage(message) {
  if (message?.type === MESSAGE.GENERATE_DISCUSSION) {
    return generateDiscussionDraft(message.payload);
  }
  if (message?.type === MESSAGE.BIND_ACCOUNT) return bindLmsAccount(message.payload);
  return undefined;
}

