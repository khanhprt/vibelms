import { settingsStore } from '../shared/settings-store.js';

const VILAO_CHAT_COMPLETIONS_URL = 'https://api.vilao.ai/v1/chat/completions';
const LETTERS = 'ABCDEFGH';

function extractContent(response) {
  const content =
    response?.choices?.[0]?.message?.content ??
    response?.content ??
    response?.draft ??
    '';

  if (typeof content === 'string') {
    return content;
  }

  // Một số API có thể trả content dạng array
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        return item?.text || item?.content || '';
      })
      .join('');
  }

  return String(content || '');
}

// LLM hay bọc JSON trong ```json; bỏ hết rồi mới parse.
function parseSuggestion(response) {
  const content = extractContent(response);

  console.log('LLM raw response:', response);
  console.log('LLM content:', content);

  if (!content || !content.trim()) {
    throw new Error('LLM trả về content rỗng.');
  }

  const raw = content
    .replace(/^```json\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  if (!raw) {
    throw new Error('LLM trả về JSON rỗng.');
  }

  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error('Không parse được JSON từ LLM:', raw);
    throw new Error(`LLM trả về JSON không hợp lệ: ${raw}`);
  }

  if (!parsed.value || !parsed.why) {
    throw new Error(
      `LLM không trả về đủ value và why: ${raw}`
    );
  }

  return parsed;
}

function buildPrompt({ stem, options, assets }) {
  const lines = options.map(
    (option, index) =>
      `${LETTERS[index]}. ${option.label} [value="${option.value}"]`,
  );

  const allowedValues = options.map((option) => String(option.value));

  const imageNote = assets.length
    ? `\nLưu ý: câu hỏi có ${assets.length} hình ảnh/công thức đính kèm mà bạn không thấy được. Nếu phần chữ không đủ để kết luận, hãy trả value là "UNKNOWN".`
    : '';

  return `Câu hỏi: ${stem}${imageNote}

Các lựa chọn:
${lines.join('\n')}

Hãy chọn đáp án đúng và trả về CHÍNH XÁC value của lựa chọn đó.

Các value hợp lệ:
${allowedValues.map((value) => `"${value}"`).join(', ')}

Chỉ trả về JSON hợp lệ, không markdown, đúng cấu trúc:
{"value":"<value của đáp án đúng hoặc UNKNOWN>","why":"<một câu ngắn giải thích>"}`;
}


export async function suggestAnswer({ stem, options, assets }) {
  const settings = await settingsStore.get();
  const { llmApiKey, llmModel } = settings;

  if (!llmApiKey) {
    throw new Error('Hãy nhập API Auth trong Cài đặt.');
  }

  if (!settings.boundAccount) {
    throw new Error('Hãy liên kết tài khoản PTTC1 trước khi dùng LLM.');
  }

  if (!options?.length) {
    throw new Error('Câu hỏi không có lựa chọn để gợi ý.');
  }

  const prompt = buildPrompt({
    stem,
    options,
    assets,
  });

  console.group('===== LLM REQUEST =====');
  console.log('STEM:', stem);
  console.log('OPTIONS:', options);
  console.log('ASSETS:', assets);
  console.log('PROMPT:', prompt);
  console.groupEnd();

  const response = await fetch(VILAO_CHAT_COMPLETIONS_URL, {
    method: 'POST',

    headers: {
      'Content-Type': 'application/json',
      ...(llmApiKey
        ? {
            Authorization: `Bearer ${llmApiKey}`,
          }
        : {}),
    },

    body: JSON.stringify({
      model: llmModel,
      max_tokens: 800,

      messages: [
        {
          role: 'system',
          content:
            'Bạn là trợ lý học tập. ' +
            'Bắt buộc chỉ trả về đúng một JSON object. ' +
            'Không markdown, không code block, không nội dung ngoài JSON. ' +
            'JSON phải có đúng hai trường value và why. ' +
            'value phải là một value trong danh sách hoặc "UNKNOWN".',
        },

        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  console.log('HTTP STATUS:', response.status);

  const responseData = await response.json();

  console.group('===== LLM RESPONSE =====');
  console.log('STEM:', stem);
  console.log('FULL RESPONSE:', responseData);
  console.log(
    'CONTENT:',
    responseData?.choices?.[0]?.message?.content
  );
  console.log(
    'FINISH REASON:',
    responseData?.choices?.[0]?.finish_reason
  );
  console.log(
    'MESSAGE:',
    responseData?.choices?.[0]?.message
  );
  console.groupEnd();

  if (!response.ok) {
    throw new Error(
      `LLM gateway trả về ${response.status}.`
    );
  }

  const parsed = parseSuggestion(responseData);

  const value = String(parsed.value).trim();

  if (value.toUpperCase() === 'UNKNOWN') {
    return {
      value: null,
      label: null,
      why: parsed.why,
    };
  }

  const option = options.find(
    (option) =>
      String(option.value) === value,
  );

  if (!option) {
    throw new Error(
      `LLM trả về value không hợp lệ: ${value}`
    );
  }

  return {
    value,
    label: option.label,
    why: parsed.why,
  };
}
