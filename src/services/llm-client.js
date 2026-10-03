import { settingsStore } from '../shared/settings-store.js';

const VILAO_CHAT_COMPLETIONS_URL = 'https://api.vilao.ai/v1/chat/completions';

/**
 * Tạo bản nháp, không tự gửi bài thảo luận. Server gateway cần kiểm tra xác thực,
 * giới hạn tốc độ và không ghi log nội dung nhạy cảm.
 */
export async function generateDiscussionDraft({
  courseName,
  chapterName,
  topic,
  context,
}) {
  const settings = await settingsStore.get();
  const { llmApiKey, llmModel } = settings;
  if (!llmApiKey) throw new Error('Hãy nhập API Auth trong Cài đặt.');
  if (!settings.boundAccount)
    throw new Error('Hãy liên kết tài khoản PTTC1 trước khi dùng LLM.');

  const response = await fetch(VILAO_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(llmApiKey ? { Authorization: `Bearer ${llmApiKey}` } : {}),
    },
    body: JSON.stringify({
      model: llmModel,
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content:
            'Bạn hỗ trợ học tập. Chỉ trả về JSON hợp lệ, không markdown: {"title":"...","question":"...","answer":"..."}. title và question là một câu hỏi ngắn, rõ ràng, liên quan đúng nội dung học. answer là một câu trả lời ngắn, chính xác để người học tự kiểm tra. Không bịa thông tin khi ngữ cảnh không đủ.',
        },
        {
          role: 'user',
          content: `Môn học: ${courseName || 'Không rõ'}\nChương/Bài: ${chapterName || topic || 'Không rõ'}\nNgữ cảnh LMS: ${context}`,
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`LLM gateway trả về ${response.status}.`);
  return response.json();
}
