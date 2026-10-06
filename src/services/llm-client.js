import { settingsStore } from '../shared/settings-store.js';

const VILAO_CHAT_COMPLETIONS_URL = 'https://api.vilao.ai/v1/chat/completions';
const FORUM_JSON_RESPONSE_FORMAT = { type: 'json_object' };

function withNoThinkingPrompt(messages) {
  return messages.map((message, index) => {
    if (index !== 0 || message.role !== 'system') return message;

    return {
      ...message,
      content: `/no_think\n${message.content}`,
    };
  });
}

function createForumJsonRequest({ model, maxTokens, temperature, messages }) {
  return {
    model,
    max_tokens: maxTokens,
    temperature,
    response_format: FORUM_JSON_RESPONSE_FORMAT,
    reasoning_effort: 'none',
    enable_thinking: false,
    chat_template_kwargs: { enable_thinking: false },
    messages: withNoThinkingPrompt(messages),
  };
}

function createFallbackRequest(body) {
  const fallbackBody = { ...body };
  delete fallbackBody.response_format;
  delete fallbackBody.reasoning_effort;
  delete fallbackBody.chat_template_kwargs;
  delete fallbackBody.enable_thinking;

  return fallbackBody;
}

async function postChatCompletion({ apiKey, body }) {
  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  const post = (requestBody) =>
    fetch(VILAO_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

  let response = await post(body);

  if (response.status === 400 || response.status === 422) {
    response = await post(createFallbackRequest(body));
  }

  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json();
      const message = payload?.error?.message || (typeof payload?.error === 'string' ? payload.error : payload?.message);
      if (typeof message === 'string') detail = ` ${message}`;
    } catch {
      // Gateways may return an HTML error page instead of JSON.
    }
    throw new Error(`LLM gateway trả về ${response.status}.${detail}`);
  }

  return response;
}

function assertHasContent(payload) {
  if (payload?.error) {
    const message = typeof payload.error === 'string' ? payload.error : payload.error.message;
    throw new Error(`LLM gateway: ${message || 'Phản hồi chứa lỗi.'}`);
  }
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content ?? payload?.content ?? payload?.draft;
  const text = typeof content === 'string' ? content : Array.isArray(content)
    ? content.map(part => typeof part === 'string' ? part : part?.text || part?.content || '').join('') : '';

  if (
    !text.trim()
  ) {
    const finishReason = choice?.finish_reason
      ? ` (${choice.finish_reason})`
      : '';
    const reasoningTokens =
      payload?.usage?.completion_tokens_details?.reasoning_tokens;
    const reasoningNote =
      typeof reasoningTokens === 'number'
        ? ` Reasoning tokens: ${reasoningTokens}.`
        : '';

    throw new Error(
      `LLM không trả nội dung${finishReason}.${reasoningNote}`,
    );
  }
}

async function getAuthedSettings() {
  const settings = await settingsStore.get();
  const { llmApiKey, llmModel } = settings;

  if (!llmApiKey) {
    throw new Error('Hãy nhập API Auth trong Cài đặt.');
  }

  if (!settings.boundAccount) {
    throw new Error(
      'Hãy liên kết tài khoản PTTC1 trước khi dùng LLM.',
    );
  }

  return { llmApiKey, llmModel };
}

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
  const { llmApiKey, llmModel } = await getAuthedSettings();

  const response = await postChatCompletion({
    apiKey: llmApiKey,
    body: createForumJsonRequest({
      model: llmModel,
      maxTokens: 800,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'Bạn hỗ trợ học tập. Chỉ trả về một JSON object hợp lệ, không markdown, không code block, không thêm chữ ngoài JSON. Định dạng bắt buộc: {"title":"...","content":"..."}. Tạo một chủ đề thảo luận bằng tiếng Việt dựa trước hết vào tên Chương/Bài. title ngắn, cụ thể, tối đa 12 từ. content chỉ có đúng 1 câu hỏi gợi mở liên quan trực tiếp đến chương, tối đa 35 từ. Không tự nhận là câu trả lời đúng, không bịa chi tiết khi ngữ cảnh không đủ.',
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
  assertHasContent(payload);
  return payload;
}

export async function generateForumReply({
  courseName,
  chapterName,
  question,
}) {
  const { llmApiKey, llmModel } = await getAuthedSettings();

  const response = await postChatCompletion({
    apiKey: llmApiKey,
    body: createForumJsonRequest({
      model: llmModel,
      maxTokens: 800,
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
  });

  if (!response.ok) {
    throw new Error(`LLM gateway trả về ${response.status}.`);
  }

  const payload = await response.json();
  assertHasContent(payload);
  return payload;
}
