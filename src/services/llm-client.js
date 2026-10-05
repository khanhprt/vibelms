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
      // Qwen3.8 thinks by default. With a short cap it can spend every token on
      // reasoning and return an empty `message.content`, which is fatal for this
      // small structured drafting task.
      max_tokens: 1_000,
      enable_thinking: false,
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content:
            'Bạn hỗ trợ học tập. Chỉ trả về JSON hợp lệ, không markdown: {"title":"...","content":"..."}. Tạo một chủ đề thảo luận bằng tiếng Việt dựa trước hết vào tên Chương/Bài. title ngắn, cụ thể. content chỉ có duy nhất 1 câu hỏi gợi mở liên quan trực tiếp đến chương; không tự nhận là câu trả lời đúng, không bịa chi tiết khi ngữ cảnh không đủ.',
        },
        {
          role: 'user',
          content: `Môn học: ${courseName || 'Không rõ'}\nChương/Bài: ${chapterName || topic || 'Không rõ'}\nNgữ cảnh LMS: ${context}`,
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`LLM gateway trả về ${response.status}.`);
  const payload = await response.json();
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;
  if (
    !content ||
    (typeof content === 'string' && !content.trim()) ||
    (Array.isArray(content) && content.length === 0)
  ) {
    throw new Error(
      `LLM không trả nội dung${choice?.finish_reason ? ` (${choice.finish_reason})` : ''}.`,
    );
  }
  return payload;
}

export async function generateForumReply({
  courseName,
  chapterName,
  question,
}) {
  const settings = await settingsStore.get();
  const { llmApiKey, llmModel } = settings;

  if (!llmApiKey) {
    throw new Error('Hãy nhập API Auth trong Cài đặt.');
  }

  if (!settings.boundAccount) {
    throw new Error(
      'Hãy liên kết tài khoản PTTC1 trước khi dùng LLM.'
    );
  }

  const response = await fetch(
    VILAO_CHAT_COMPLETIONS_URL,
    {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llmApiKey}`,
      },

      body: JSON.stringify({
        model: llmModel,

        // Reply chỉ cần 1-2 câu.
        // Không cho model sinh quá dài.
        max_tokens: 800,

        // Tắt thinking của Qwen.
        enable_thinking: false,

        // Giảm temperature để câu trả lời ổn định,
        // ít lan man hơn.
        temperature: 0.3,

        messages: [
          {
            role: 'system',

            content: `
Bạn đang viết một phản hồi ngắn cho diễn đàn học tập.

YÊU CẦU BẮT BUỘC:
- Không suy luận dài dòng.
- Không trình bày quá trình suy nghĩ.
- Chỉ viết 1 hoặc 2 câu ngắn.
- Tổng nội dung tối đa khoảng 60 từ.
- Trả lời trực tiếp vào nội dung discussion.
- Không mở bài dài.
- Không kết luận dài.
- Không dùng Markdown.
- Không dùng code block.
- Không bịa nguồn hoặc thông tin.
- Nếu thông tin không đủ, trả lời thận trọng và ngắn gọn.

CHỈ trả về đúng một JSON hợp lệ theo định dạng:
{"title":"Phúc đáp","content":"Nội dung phản hồi"}

Không được viết bất kỳ nội dung nào bên ngoài JSON.
            `.trim(),
          },

          {
            role: 'user',

            content: `
Môn học: ${courseName || 'Không rõ'}
Chương/Bài: ${chapterName || 'Không rõ'}

Nội dung discussion cần phúc đáp:
${question}

Hãy trả lời discussion trên bằng 1-2 câu ngắn.
            `.trim(),
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `LLM gateway trả về ${response.status}.`
    );
  }

  const payload = await response.json();

  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;

  if (
    !content ||
    (typeof content === 'string' && !content.trim()) ||
    (Array.isArray(content) && content.length === 0)
  ) {
    throw new Error(
      `LLM không trả nội dung${
        choice?.finish_reason
          ? ` (${choice.finish_reason})`
          : ''
      }.`
    );
  }

  return payload;
}
