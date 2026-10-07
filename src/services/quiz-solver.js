import { settingsStore } from '../shared/settings-store.js';

const VILAO_CHAT_COMPLETIONS_URL = 'https://api.vilao.ai/v1/chat/completions';

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
  } catch {
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

function buildPrompt({ stem, type, quizName, options, assets = [] }) {
  const lines = options.map(
    (option, index) =>
      `Lựa chọn ${index + 1}${option.displayLabel ? ` (nhãn hiển thị: ${option.displayLabel})` : ''}: ${option.label} [value=${JSON.stringify(String(option.value))}]`,
  );

  const allowedValues = options.map((option) => String(option.value));

  const sentImageCount = getVisionImages(assets).length;
  const imageNote = assets.length
    ? sentImageCount
      ? `\nLưu ý: có ${sentImageCount} hình ảnh/công thức đính kèm trong nội dung này. Hãy dùng cả ảnh và phần chữ để chọn đáp án.`
      : `\nLưu ý: câu hỏi có ${assets.length} hình ảnh/công thức nhưng không tải được để gửi kèm. Nếu phần chữ không đủ để kết luận, hãy trả value là "UNKNOWN".`
    : '';

  const selectionNote = type === 'single' || type === 'truefalse'
    ? `\nLoại câu hỏi: CHỈ CHỌN MỘT đáp án (radio).
Đề yêu cầu một phương án phù hợp nhất, không yêu cầu liệt kê mọi phát biểu có thể đúng.
Nếu nhiều phương án đúng theo nghĩa rộng, đối chiếu phạm vi câu hỏi, thuật ngữ chuyên ngành và cách phân loại thường dùng trong môn học để chọn phương án trực tiếp, điển hình và sát ý đề nhất.
Không trả UNKNOWN chỉ vì "nhiều phương án đúng" hoặc "không có lựa chọn ghép". Khi thiếu tài liệu môn học nhưng vẫn có thể so sánh các phương án, chọn phương án có căn cứ mạnh nhất và giải thích ngắn gọn tiêu chí lựa chọn; không khẳng định chắc chắn nếu còn chưa chắc.
Chỉ trả UNKNOWN khi thiếu dữ liệu thiết yếu (ví dụ hình ảnh hoặc tham chiếu bị mất) khiến không thể đánh giá các phương án. Không tự tạo đáp án ghép hay trả nhiều value.`
    : '';

  return `${quizName ? `Bài/quiz: ${quizName}\n` : ''}Câu hỏi: ${stem}${imageNote}${selectionNote}

Các lựa chọn:
${lines.join('\n')}

Quy tắc đọc lựa chọn ghép và tham chiếu:
- Các số "Lựa chọn 1, 2, ..." chỉ dùng để liệt kê, không phải ký hiệu mệnh đề của đề bài.
- "a và b", "b và c", "cả a, b, c", "tất cả các phương án trên" là các lựa chọn ghép. Không kết luận thiếu dữ liệu chỉ vì lựa chọn dùng ký hiệu thay vì lặp lại nội dung.
- Trước tiên xác định các mệnh đề đơn trong câu hỏi và các lựa chọn, đánh giá từng mệnh đề bằng kiến thức môn học, rồi đối chiếu với lựa chọn ghép.
- Nếu đề định nghĩa a/b/c trong phần câu hỏi, dùng đúng định nghĩa đó. Nếu ký hiệu tham chiếu nhãn phương án, dùng nhãn gốc được hiển thị; phân biệt nhãn lựa chọn với ký hiệu mệnh đề khi đề sử dụng cả hai.
- Các phương án có thể bị xáo trộn. Không tự gán a/b/c cho các mệnh đề đơn theo thứ tự đang hiển thị, không suy ra thứ tự gốc chỉ từ vị trí, và không dùng tham chiếu vòng (một lựa chọn ghép tham chiếu chính nó).
- Chỉ chọn lựa chọn ghép khi xác định được nội dung các mệnh đề mà nó tham chiếu và tất cả các mệnh đề đó đều đúng. Nếu còn nhiều cách hiểu dẫn tới các đáp án khác nhau, trả UNKNOWN và nêu ngắn gọn tham chiếu nào mơ hồ.

Hãy chọn đáp án đúng và trả về CHÍNH XÁC value của lựa chọn đó.

Các value hợp lệ:
${allowedValues.map((value) => `"${value}"`).join(', ')}

Chỉ trả về JSON hợp lệ, không markdown, đúng cấu trúc:
{"value":"<value của đáp án đúng hoặc UNKNOWN>","why":"<một câu ngắn giải thích>"}`;
}

function getVisionImages(assets = []) {
  return assets
    .map((asset) => asset?.dataUrl || asset?.src || '')
    .filter((url) => /^data:image\//i.test(url));
}

function createUserContent(prompt, assets) {
  const images = getVisionImages(assets);
  if (!images.length) return prompt;
  return [
    { type: 'text', text: prompt },
    ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
  ];
}


export async function suggestAnswer({ stem, type, quizName, options, assets }, { signal } = {}) {
  const settings = await settingsStore.get();
  const { llmApiKey, llmModel, llmEndpoint, quizVisionModel } = settings;

  if (!llmApiKey) {
    throw new Error('Hãy nhập API Auth trong Cài đặt.');
  }

  if (!options?.length) {
    throw new Error('Câu hỏi không có lựa chọn để gợi ý.');
  }

  const prompt = buildPrompt({
    stem,
    type,
    quizName,
    options,
    assets,
  });
  const userContent = createUserContent(prompt, assets);
  const model = Array.isArray(userContent)
    ? (quizVisionModel || 'gemini-3.8-flash')
    : llmModel;

  console.group('===== LLM REQUEST =====');
  console.log('STEM:', stem);
  console.log('OPTIONS:', options);
  console.log('ASSETS:', assets);
  console.log('PROMPT:', prompt);
  console.groupEnd();

  const response = await fetch(llmEndpoint || VILAO_CHAT_COMPLETIONS_URL, {
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
      model,
      max_tokens: 800,

      messages: [
        {
          role: 'system',
          content:
            'Bạn là trợ lý giải trắc nghiệm theo ngữ cảnh môn học. ' +
            'Tuân thủ loại câu hỏi và quy tắc lựa chọn trong yêu cầu. ' +
            'Với câu chỉ chọn một đáp án, hãy chọn phương án phù hợp nhất dù có phương án khác đúng theo nghĩa rộng. ' +
            'Bắt buộc chỉ trả về đúng một JSON object. ' +
            'Không markdown, không code block, không nội dung ngoài JSON. ' +
            'JSON phải có đúng hai trường value và why. ' +
            'value phải là một value trong danh sách hoặc "UNKNOWN".',
        },

        {
          role: 'user',
          content: userContent,
        },
      ],
    }),
    signal,
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
