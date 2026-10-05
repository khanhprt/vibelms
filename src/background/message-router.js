import { MESSAGE } from '../shared/constants.js';
import { generateDiscussionDraft, generateForumReply } from '../services/llm-client.js';
import { suggestAnswer } from '../services/quiz-solver.js';
import { bindLmsAccount } from '../services/account-binding.js';

export async function handleMessage(message) {
  if (message?.type === MESSAGE.GENERATE_DISCUSSION) {
    return generateDiscussionDraft(message.payload);
  }
  if (message?.type === MESSAGE.GENERATE_FORUM_REPLY) {
    return generateForumReply(message.payload);
  }
  if (message?.type === MESSAGE.SUGGEST_QUIZ_ANSWER) {
    return suggestAnswer(message.payload);
  }
  if (message?.type === MESSAGE.BIND_ACCOUNT) return bindLmsAccount(message.payload);
  return undefined;
}
