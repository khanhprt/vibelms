import { QUIZ_DUMP_KEY } from '../shared/constants.js';
import { settingsStore } from '../shared/settings-store.js';
import { clickWithDelay } from '../shared/delays.js';
import { clearQuizDump, downloadQuizDump, readQuizDump } from '../shared/quiz-export.js';

const HELPER_ID = 'coursepilot-quiz-extractor';
const RESCAN_DEBOUNCE_MS = 400;

const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();

function readQuizMeta() {
  const params = new URLSearchParams(location.search);
  const crumbs = [
    ...document.querySelectorAll('.breadcrumb-item, [aria-label="breadcrumb"] li'),
  ]
    .map((item) => clean(item.textContent))
    .filter(Boolean);
  const quizId = Number(params.get('id')) || Number(params.get('cmid')) || null;
  const attemptId = Number(params.get('attempt')) || null;
  return {
    quizId,
    attemptId,
    quizName: crumbs.at(-1) || clean(document.title) || 'Quiz',
    courseId: Number(params.get('courseid')) || null,
  };
}

// Tên input của Moodle là q<questionid>_<số>, hoặc q<id>:<slot>_answer khi câu hỏi được
// lặp lại trong cùng quiz — phần :<slot> là số thứ tự hiển thị trên trang.
function readQuestionName(node) {
  const input = node.querySelector('.answer input');

  const name = input?.name || node.id || '';

  const match = name.match(/^q(\d+)(?::(\d+))?/);

  return {
    name,
    inputId: input?.id || null,

    questionId: match
      ? Number(match[1])
      : null,

    slot: match?.[2]
      ? Number(match[2])
      : null,
  };
}

function readQuestionNumber(node) {
  const qno = clean(node.querySelector('.info .qno, .qno')?.textContent);
  return qno || null;
}

// Moodle dùng chung class "multichoice" cho cả một lựa chọn lẫn nhiều lựa chọn,
// nên loại thật sự phải đọc từ thẻ input chứ không dựa vào class.
function readQuestionType(node) {
  const classes = node.className || '';
  if (/truefalse/.test(classes)) return 'truefalse';
  if (/shortanswer/.test(classes)) return 'shortanswer';
  if (/essay/.test(classes)) return 'essay';
  if (/numerical/.test(classes)) return 'numerical';
  if (node.querySelector('.answer input[type="checkbox"]')) return 'multi';
  if (node.querySelector('.answer input[type="radio"]')) return 'single';
  return 'unknown';
}

function readOptionText(input) {
  const wrap = input.closest('.option, .r0, .answer > div') || input.parentElement;
  if (input.id) {
    const byFor = wrap?.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (byFor) return clean(byFor.textContent);
  }
  const label = wrap?.querySelector('label');
  return clean(label ? label.textContent : wrap?.textContent);
}

function readOptions(node) {
  return [
    ...node.querySelectorAll(
      '.answer input[type="radio"], .answer input[type="checkbox"]',
    ),
  ].map((input) => ({
    value: input.value || '',
    label: readOptionText(input),
    selected: input.checked,
    
  }));
}


// Công thức toán và hình ảnh nằm trong .qtext dưới dạng <img> — giữ lại src để đọc lại offline.
function readAssets(node) {
  const qtext = node.querySelector('.qtext');
  return [...(qtext?.querySelectorAll('img') || [])]
    .map((img) => ({ src: img.currentSrc || img.src || '', alt: clean(img.alt) }))
    .filter((asset) => asset.src);
}

function readQuestion(node) {
  const {
    name,
    inputId,
    questionId,
    slot
  } = readQuestionName(node);

  const options = readOptions(node);

  return {
    name,
    inputId,
    questionId,
    slot,

    qno: readQuestionNumber(node),
    type: readQuestionType(node),
    stem: clean(
      node.querySelector('.qtext')?.textContent
    ),

    assets: readAssets(node),
    options,

    selectedIndexes: options
      .map((option, index) =>
        option.selected ? index : -1
      )
      .filter((index) => index >= 0),
  };
}

// Moodle có thể nạp câu hỏi trong iframe (lazy loading): không đọc được DOM bên trong.
function detectDeferredFrames(doc) {
  return [...doc.querySelectorAll('iframe')].filter((frame) =>
    /question|qview/i.test(`${frame.src || ''} ${frame.className || ''}`),
  ).length;
}

export function extractQuizQuestions(provider, doc = document) {
  const nodes = provider.findQuizQuestionNodes?.(doc) ?? [];
  const questions = nodes
    .map(readQuestion)
    .filter((question) => question.stem || question.name);
  return { questions, deferredFrames: detectDeferredFrames(doc) };
}

// Moodle render câu hỏi không theo thứ tự slot, nên sắp lại để JSON đọc đúng như trang.
function sortBySlot(questions) {
  return questions
    .map((question, index) => ({ question, index }))
    .sort((a, b) => {
      const left = a.question.slot ?? Number.POSITIVE_INFINITY;
      const right = b.question.slot ?? Number.POSITIVE_INFINITY;
      return left === right ? a.index - b.index : left - right;
    })
    .map((entry) => entry.question);
}

// Trang giới thiệu có ?id=, trang làm bài chỉ có ?attempt=/?cmid=. Giữ dữ liệu khi còn trùng quiz
// và trùng lượt; đổi quiz hoặc mở lượt mới thì bắt đầu lại để không trộn hai lượt.
async function mergeIntoDump(meta, questions) {
  const previous = await readQuizDump();
  const sameQuiz = Boolean(
    previous && (meta.quizId === null || meta.quizId === previous.quizId),
  );
  const sameAttempt = Boolean(
    sameQuiz && (meta.attemptId === null || meta.attemptId === previous.attemptId),
  );
  const byName = new Map(
    (sameQuiz && sameAttempt ? previous.questions : []).map((q) => [q.name, q]),
  );
  for (const question of questions) {
    if (question.name && !byName.has(question.name)) byName.set(question.name, question);
  }
  const dump = {
    quizId: meta.quizId ?? (sameQuiz ? previous.quizId : null),
    quizName: meta.quizName,
    courseId: meta.courseId,
    attemptId: meta.attemptId ?? (sameQuiz ? previous.attemptId : null),
    url: location.href,
    capturedAt: new Date().toISOString(),
    questions: sortBySlot([...byName.values()]),
  };
  await browser.storage.local.set({ [QUIZ_DUMP_KEY]: dump });
  return dump;
}

async function render(helper, dump, note) {
  helper.querySelector('#coursepilot-quiz-count').textContent =
    dump?.questions?.length
      ? `Đã trích xuất ${dump.questions.length} câu hỏi.`
      : 'Chưa có câu hỏi.';

  helper.querySelector('#coursepilot-quiz-note').textContent =
    note || '';

  const download = helper.querySelector(
    '#coursepilot-quiz-download'
  );

  if (download) {
    download.disabled = !dump?.questions?.length;
  }

  await renderQuestionList(helper, dump);
}

function mountPanel() {
  const helper = document.createElement('aside');
  helper.id = HELPER_ID;
  helper.innerHTML = `<style>#${HELPER_ID}{position:fixed;z-index:2147483647;right:24px;bottom:24px;width:320px;max-height:78vh;display:flex;flex-direction:column;padding:16px;border:1px solid #8be8ba66;border-radius:16px;background:#111a38;color:#effff6;box-shadow:0 16px 44px #020714b8;font:13px system-ui,sans-serif}#${HELPER_ID} h3{margin:0 0 8px;font-size:15px}#${HELPER_ID} p{margin:0;color:#b6c9c0;line-height:1.5}#${HELPER_ID} button{margin-top:10px;width:100%;padding:9px;border:0;border-radius:9px;background:#55cf91;color:#062216;font-weight:800;cursor:pointer}#${HELPER_ID} button[disabled]{opacity:.45;cursor:not-allowed}#${HELPER_ID} small{display:block;margin-top:9px;color:#90a9a0}#${HELPER_ID} .cpq-list{display:none;margin-top:10px;overflow-y:auto;border-top:1px solid #8be8ba33}#${HELPER_ID} .cpq-list.is-open{display:block}#${HELPER_ID} .cpq-item{padding:9px 0;border-bottom:1px solid #8be8ba22}#${HELPER_ID} .cpq-item button{margin-top:6px;padding:6px;font-size:12px}#${HELPER_ID} .cpq-stem{color:#effff6;font-weight:600}#${HELPER_ID} .cpq-result{margin-top:6px;padding:7px;border-left:3px solid #55cf91;background:#55cf9114;border-radius:0 6px 6px 0;color:#c9f5dc}#${HELPER_ID} .cpq-result.is-error{border-left-color:#e07b7b;background:#e07b7b14;color:#ffd4d4}#${HELPER_ID} .cpq-diag{margin:10px 0 0;padding:6px 8px;border-radius:8px;background:#ffd24a1f;color:#ffe08a;font:600 11px/1.45 ui-monospace,Consolas,monospace;word-break:break-word}.coursepilot-quiz-highlight{outline:4px solid #ffd24a!important;outline-offset:3px;box-shadow:0 0 0 6px #ffd24a55,0 0 26px 6px #ffd24a99!important;animation:coursepilot-quiz-pulse 1s ease-in-out 3}@keyframes coursepilot-quiz-pulse{0%,100%{outline-color:#ffd24a}50%{outline-color:#ff7b4a}}</style><h3>Trích xuất câu hỏi</h3><p id="coursepilot-quiz-count">Chưa có câu hỏi.</p><p>Bạn tự chọn đáp án. Gợi ý AI chỉ hiện trong panel — extension không bấm chọn, không nộp bài.</p><p class="cpq-diag" id="coursepilot-quiz-diag"></p><button id="coursepilot-quiz-start" hidden>Đưa tôi đến nút Bắt đầu</button><button id="coursepilot-quiz-rescan" hidden>Quét lại trang này</button><button id="coursepilot-quiz-askall" hidden>Xem gợi ý AI</button><button id="coursepilot-quiz-download">Xuất JSON</button><button id="coursepilot-quiz-clear">Xoá dữ liệu</button><div class="cpq-list" id="coursepilot-quiz-list"></div><small id="coursepilot-quiz-note"></small>`;
  const theme = document.createElement('style');
  theme.textContent = `#${HELPER_ID}{border-color:#b2ffda42!important;border-radius:0!important;background:linear-gradient(160deg,#182448 0%,#10152f 56%,#0b1025 100%)!important;box-shadow:0 12px 30px #00000061,inset 0 1px #ffffff14!important}#${HELPER_ID} button,#${HELPER_ID} .cpq-result,#${HELPER_ID} .cpq-diag{border-radius:0!important}`;
  helper.append(theme);
  document.body.append(helper);
  return helper;
}


async function requestSuggestionWithRetry(question, maxRetries = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `Gọi LLM lần ${attempt}/${maxRetries}:`,
        question.name || question.qno || question.stem
      );

      const answer = await browser.runtime.sendMessage({
        type: 'SUGGEST_QUIZ_ANSWER',

        payload: {
          stem: question.stem,
          options: question.options,
          assets: question.assets,
        },
      });

      // Có response hợp lệ thì trả ngay
      if (answer?.value) {
        return answer;
      }

      // Nếu background trả về object lỗi
      if (answer?.error) {
        throw new Error(answer.error);
      }

      // Response tồn tại nhưng không có đáp án
      // Không coi đây là lỗi kỹ thuật để retry vô hạn.
      return answer;

    } catch (error) {
      lastError = error;

      console.warn(
        `LLM lỗi lần ${attempt}/${maxRetries}:`,
        error
      );

      // Đã thử đủ số lần
      if (attempt >= maxRetries) {
        break;
      }

      // Nghỉ một chút trước khi thử lại
      const delayMs = 700 * attempt;

      console.log(
        `Chờ ${delayMs}ms rồi retry...`
      );

      await new Promise((resolve) =>
        setTimeout(resolve, delayMs)
      );
    }
  }

  throw lastError || new Error(
    'Không gọi được LLM sau nhiều lần thử.'
  );
}

async function askSuggestion(item, question, button, result) {
  button.disabled = true;

  result.className = 'cpq-result';
  result.textContent = 'Đang hỏi…';

  try {
    const answer = await requestSuggestionWithRetry(
      question,
      3
    );

    // =========================
    // AI không đưa ra đáp án
    // =========================

    if (!answer?.value) {
      result.textContent =
        `Không chốt được đáp án. ${answer?.why || ''}`.trim();

      return {
        success: false,
        reason: 'no-answer',
      };
    }

    // =========================
    // AI đã đưa ra đáp án
    // =========================

    result.textContent =
      `→ ${answer.label} — ${answer.why}`;

    // Tìm câu hỏi và click radio
    const clicked = await clickQuestionOptionByValue(
      question,
      answer.value
    );

    // =========================
    // Có đáp án nhưng click lỗi
    // =========================

    if (!clicked) {
      console.warn(
        'AI có đáp án nhưng không click được:',
        answer
      );

      return {
        success: false,
        reason: 'click-failed',
        value: answer.value,
        label: answer.label,
      };
    }

    // =========================
    // Thành công hoàn toàn
    // =========================

    console.log(
      'Đã chọn đáp án theo AI:',
      answer
    );

    return {
      success: true,
      value: answer.value,
      label: answer.label,
    };

  } catch (error) {

    // =========================
    // Gọi AI/API bị lỗi
    // =========================

    result.className = 'cpq-result is-error';

    result.textContent =
      error.message || 'Không gọi được LLM.';

    console.error(
      'askSuggestion lỗi:',
      error
    );

    return {
      success: false,
      reason: 'error',
      error: error.message || String(error),
    };

  } finally {

    // Dù thành công hay lỗi đều chạy
    button.disabled = false;
    item.dataset.done = 'true';
  }
}

async function renderQuestionList(helper, dump) {
  const list = helper.querySelector('#coursepilot-quiz-list');
  const toggle = helper.querySelector('#coursepilot-quiz-askall');

  toggle.hidden = !dump?.questions?.length;

  if (!dump?.questions?.length) {
    list.replaceChildren();
    return;
  }

  // Nếu panel đã render đủ số câu thì không cần render lại
  if (list.childElementCount === dump.questions.length) {
    return;
  }

  const jobs = [];

  const elements = dump.questions.map((question, index) => {
    const item = document.createElement('div');
    item.className = 'cpq-item';

    const stem = document.createElement('p');
    stem.className = 'cpq-stem';

    stem.textContent =
      `${question.qno || `Câu ${index + 1}`} — ${question.stem.slice(0, 90)}`;

    const button = document.createElement('button');
    button.textContent = 'Gợi ý AI';

    const result = document.createElement('p');
    result.className = 'cpq-result';

    if (!question.options?.length) {
      button.disabled = true;
      button.textContent = 'Không có lựa chọn';
    } else {
      // Vẫn giữ khả năng click thủ công
      button.addEventListener('click', () =>
        askSuggestion(
          item,
          question,
          button,
          result
        ),
      );

      // Tạo danh sách để tự động hỏi AI
      jobs.push({
        item,
        question,
        button,
        result,
      });
    }

    item.append(
      stem,
      button,
      result
    );

    return item;
  });

  list.replaceChildren(...elements);

  console.log(
    `Tìm thấy ${jobs.length} câu có lựa chọn`
  );

  // Tự động xử lý từng câu
  let allQuestionsSuccessful = true;
  let successCount = 0;

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];

    const questionKey =
      job.question.name ||
      job.question.inputId ||
      job.question.qno ||
      job.question.stem;

    if (!questionKey) {
      console.warn(
        'Không tạo được key cho câu hỏi:',
        job.question
      );

      continue;
    }

    // Kiểm tra xem câu này đã được xử lý trước đó chưa
    const previousResult = autoAnsweredQuestions.get(questionKey);

    if (previousResult) {

      // Câu này trước đó đã trả lời thành công
      if (previousResult.success) {
        successCount++;

        updateAiStatus(
          helper,
          `AI: câu ${i + 1}/${jobs.length} · đã trả lời trước đó`
        );

        console.log(
          `AI câu ${i + 1}/${jobs.length} đã thành công trước đó:`,
          previousResult
        );

        continue;
      }

      // Nếu vì lý do nào đó Map chứa kết quả thất bại
      // thì coi như toàn bộ chưa thành công
      allQuestionsSuccessful = false;

      updateAiStatus(
        helper,
        `AI: câu ${i + 1}/${jobs.length} · lần trước xử lý thất bại`
      );

      continue;
    }

    updateAiStatus(
      helper,
      `AI: câu ${i + 1}/${jobs.length} · đang hỏi LLM...`
    );

    const aiResult = await askSuggestion(
      job.item,
      job.question,
      job.button,
      job.result
    );

    // Thành công
    if (aiResult?.success) {
      successCount++;

      // Lưu trong RAM để tránh hỏi lại trong cùng lần load
      autoAnsweredQuestions.set(
        questionKey,
        aiResult
      );

      // Lưu vào sessionStorage để nếu Moodle reload
      // thì vẫn nhớ câu này đã xử lý thành công
      saveAnsweredQuestion(
        currentAttemptId,
        questionKey,
        aiResult
      );

      updateAiStatus(
        helper,
        `AI: câu ${i + 1}/${jobs.length} · đã chọn ${aiResult.label}`
      );

      console.log(
        `AI câu ${i + 1}/${jobs.length} thành công:`,
        aiResult
      );

      continue;
    }

    // Không có đáp án
    if (aiResult?.reason === 'no-answer') {
      allQuestionsSuccessful = false;
      updateAiStatus(
        helper,
        `AI: câu ${i + 1}/${jobs.length} · không xác định được đáp án`
      );

      console.warn(
        `AI không xác định được câu ${i + 1}:`,
        job.question
      );

      continue;
    }

    // AI trả đáp án nhưng click DOM thất bại
    if (aiResult?.reason === 'click-failed') {
      allQuestionsSuccessful = false;
      updateAiStatus(
        helper,
        `AI: câu ${i + 1}/${jobs.length} · có đáp án nhưng click thất bại`
      );

      console.warn(
        `Click thất bại câu ${i + 1}:`,
        aiResult
      );

      continue;
    }

    // Lỗi API / JSON / LLM
    if (aiResult?.reason === 'error') {
      allQuestionsSuccessful = false;
      updateAiStatus(
        helper,
        `AI: câu ${i + 1}/${jobs.length} · lỗi: ${aiResult.error || 'không rõ'}`
      );

      console.error(
        `AI lỗi câu ${i + 1}:`,
        aiResult
      );

      continue;
    }
  };

  updateAiStatus(
    helper,
    `AI: đã xử lý xong ${jobs.length} câu`
  );

  if (
    allQuestionsSuccessful &&
    successCount === jobs.length &&
    jobs.length > 0
  ) {
    // Đã từng bấm Hoàn thành trong lần load này rồi
    if (
      currentAttemptId !== null &&
      wasFinishClicked(currentAttemptId)
    ) {
      console.log(
        'Attempt này đã bấm Hoàn thành trước đó, bỏ qua.'
      );

      updateAiStatus(
        helper,
        `AI: hoàn thành ${successCount}/${jobs.length} · đã bấm Hoàn thành trước đó`
      );

      return;
    }

    updateAiStatus(
      helper,
      `AI: hoàn thành ${successCount}/${jobs.length} · đang tìm nút Hoàn thành...`
    );

    const finishButton = findFinishButton();

    if (!finishButton) {
      console.warn(
        'Đã trả lời hết nhưng không tìm thấy nút Hoàn thành.'
      );

      updateAiStatus(
        helper,
        `AI: hoàn thành ${successCount}/${jobs.length} · không thấy nút Hoàn thành`
      );

      return;
    }

    console.log(
      'Tìm thấy nút Hoàn thành:',
      finishButton
    );

    // QUAN TRỌNG:
    // Lưu trạng thái TRƯỚC khi click.
    // Nếu click làm Moodle reload ngay thì sessionStorage vẫn đã được ghi.
    if (currentAttemptId !== null) {
      markFinishClicked(currentAttemptId);
    }

    updateAiStatus(
      helper,
      `AI: hoàn thành ${successCount}/${jobs.length} · đang bấm Hoàn thành...`
    );

    await clickWithDelay(finishButton);

    console.log(
      'Đã bấm nút Hoàn thành.'
    );

  } else {
    console.warn(
      `Không tự hoàn thành vì chỉ thành công ${successCount}/${jobs.length} câu.`
    );

    updateAiStatus(
      helper,
      `AI: ${successCount}/${jobs.length} câu thành công · KHÔNG tự hoàn thành`
    );
  }
}

function findSubmitAllButton() {
  const elements = [
    ...document.querySelectorAll(
      'button, input[type="button"], input[type="submit"], a'
    ),
  ];

  return elements.find((element) => {
    const text = clean(
      element.textContent ||
      element.value ||
      ''
    ).toLowerCase();

    return (
      text.includes('nộp bài và kết thúc') ||
      text.includes('submit all and finish')
    );
  }) || null;
}

function isQuizSummaryPage() {
  const bodyText = clean(
    document.body?.textContent
  ).toLowerCase();

  const hasSubmitButton = [
    ...document.querySelectorAll(
      'button, input[type="submit"], input[type="button"], a'
    ),
  ].some((element) => {
    const text = clean(
      element.textContent ||
      element.value ||
      ''
    ).toLowerCase();

    return (
      text.includes('nộp bài và kết thúc') ||
      text.includes('submit all and finish')
    );
  });

  const looksLikeSummary =
    bodyText.includes('tóm tắt lần làm bài') ||
    bodyText.includes('summary of attempt');

  return hasSubmitButton || looksLikeSummary;
}

function findFinishButton() {
  const elements = [
    ...document.querySelectorAll(
      'button, input[type="button"], input[type="submit"], a'
    ),
  ];

  return elements.find((element) => {
    const text = (
      element.textContent ||
      element.value ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();

    return text.toLowerCase().startsWith('hoàn thành');
  }) || null;
}

function findQuestionNode(question) {
  if (!question?.name) return null;

  const input = [
    ...document.querySelectorAll(
      '.answer input[type="radio"], .answer input[type="checkbox"]'
    ),
  ].find((input) => input.name === question.name);

  if (!input) return null;

  // Moodle thường bọc toàn bộ câu hỏi trong .que
  return input.closest('.que') || input.closest('.question') || input.parentElement;
}

function updateAiStatus(helper, text) {
  const diagEl = helper?.querySelector('#coursepilot-quiz-diag');

  if (!diagEl) return;

  const baseStatus = diagEl.dataset.baseStatus || '';

  diagEl.textContent = [
    baseStatus,
    text
  ]
    .filter(Boolean)
    .join(' · ');
}

async function clickQuestionOptionByValue(question, value) {
  const node = findQuestionNode(question);

  if (!node) {
    console.warn('Không tìm thấy node câu hỏi:', question.name);
    return false;
  }

  const input = [
    ...node.querySelectorAll(
      '.answer input[type="radio"], .answer input[type="checkbox"]'
    ),
  ].find((input) => String(input.value) === String(value));

  if (!input) {
    console.warn(
      'Không tìm thấy option:',
      'question =', question.name,
      'value =', value
    );
    return false;
  }

  const clicked = await clickWithDelay(input);

  if (!clicked) {
    console.warn(
      'Option đã rời DOM trước lúc bấm:',
      'question =', question.name,
      'value =', value
    );

    return false;
  }

  console.log(
    'Đã click:',
    question.name,
    'value =',
    value
  );

  return true;
}

// Đã bấm nút Bắt đầu trong lần tải trang này chưa. Guard nằm ở module scope vì
// mountQuizExtractor có thể chạy cả hai đường init; bấm hai lần là tốn hai lượt.
let currentAttemptId = null;
let startClicked = false;

const autoAnsweredQuestions = new Map();

function getAttemptStateKey(attemptId) {
  return `coursepilot_quiz_state_${attemptId || 'unknown'}`;
}

function readAttemptState(attemptId) {
  try {
    const raw = sessionStorage.getItem(
      getAttemptStateKey(attemptId)
    );

    if (!raw) {
      return {
        finishClicked: false,
        answeredQuestions: {},
      };
    }

    const parsed = JSON.parse(raw);

    return {
      finishClicked: Boolean(parsed.finishClicked),
      submitClicked: Boolean(parsed.submitClicked),

      answeredQuestions:
        parsed.answeredQuestions &&
        typeof parsed.answeredQuestions === 'object'
          ? parsed.answeredQuestions
          : {},
    };
  } catch (error) {
    console.warn(
      'Không đọc được trạng thái attempt:',
      error
    );

    return {
      finishClicked: false,
      submitClicked: false,
      answeredQuestions: {},
    };
  }
}

function saveAttemptState(attemptId, state) {
  if (!attemptId) return;

  try {
    sessionStorage.setItem(
      getAttemptStateKey(attemptId),
      JSON.stringify(state)
    );
  } catch (error) {
    console.warn(
      'Không lưu được trạng thái attempt:',
      error
    );
  }
}

function markFinishClicked(attemptId) {
  if (!attemptId) return;

  const state = readAttemptState(attemptId);

  state.finishClicked = true;

  saveAttemptState(attemptId, state);
}

function wasFinishClicked(attemptId) {
  if (!attemptId) return false;

  return readAttemptState(attemptId).finishClicked;
}

function markSubmitClicked(attemptId) {
  if (!attemptId) return;

  const state = readAttemptState(attemptId);

  state.submitClicked = true;

  saveAttemptState(attemptId, state);
}

function wasSubmitClicked(attemptId) {
  if (!attemptId) return false;

  return readAttemptState(attemptId).submitClicked;
}

function saveAnsweredQuestion(
  attemptId,
  questionKey,
  result
) {
  if (!attemptId || !questionKey) return;

  const state = readAttemptState(attemptId);

  state.answeredQuestions[questionKey] = result;

  saveAttemptState(attemptId, state);
}

function restoreAnsweredQuestions(attemptId) {
  if (!attemptId) {
    return;
  }

  const state = readAttemptState(attemptId);

  for (
    const [questionKey, result]
    of Object.entries(state.answeredQuestions)
  ) {
    if (!autoAnsweredQuestions.has(questionKey)) {
      autoAnsweredQuestions.set(
        questionKey,
        result
      );
    }
  }
}

export function mountQuizExtractor(provider) {
  if (!provider.isQuizPage?.(location)) return;
  let observer;
  let timer;
  let helper;

  // Tự trích xuất ngay khi bật công tắc, đồng thời tôn trọng giới hạn domain sẵn có.
  settingsStore.get().then(async (settings) => {
    if (!settings.quizExportEnabled) return;
    const { allowedDomains } = settings;
    if (allowedDomains.length && !allowedDomains.includes(location.hostname)) return;

    if (!helper) helper = mountPanel();

    const isAttempt =
      provider.isQuizAttemptPage?.(location);

    // QUAN TRỌNG:
    // Summary không được phép chạy autoStart,
    // nếu không có thể click nút quay lại attempt.
    const isSummary =
      isQuizSummaryPage();

    const startButton =
      (isAttempt || isSummary)
        ? null
        : provider.findQuizStartButton?.(document);

    const startEl = helper.querySelector('#coursepilot-quiz-start');
    const diagEl = helper.querySelector('#coursepilot-quiz-diag');
    startEl.hidden = !startButton;

    console.log(`Value: ${startClicked}`)

    // Người dùng đã chọn tự bấm: mỗi lần tải trang bắt đầu thì vào thẳng bài.
    let autoClicked = false;
    if (
      !isSummary &&
      startButton &&
      settings.autoStartQuiz &&
      !startClicked
    ) {
      startClicked = true;

      console.log(
        'AutoStart: đang bấm nút bắt đầu quiz.',
        startButton
      );

      await clickWithDelay(startButton);

      autoClicked = true;
    }

    // Báo đúng trạng thái thật đang chạy: công tắc bật chưa, có thấy nút không, đã bấm
    // chưa. Nhờ dòng này người dùng thấy nguyên nhân tự bấm không chạy thay vì phải đoán.
    const baseDiag = [
      `Tự bấm: ${settings.autoStartQuiz ? 'BẬT' : 'TẮT'}`,

      isSummary
        ? 'Trang Summary · KHÔNG autoStart'
        : isAttempt
          ? 'Trang đang làm bài · không autoStart'
          : `Nút bắt đầu: ${startButton ? 'thấy' : 'KHÔNG thấy'}`,

      autoClicked
        ? 'đã bấm 1 lần'
        : startClicked
          ? 'đã bấm ở lần trước'
          : 'chưa bấm',

      settings.autoStartQuiz ? '' : '→ bật ở Options › 04',
    ]
      .filter(Boolean)
      .join(' · ');

    diagEl.dataset.baseStatus = baseDiag;
    diagEl.textContent = baseDiag;

    if (startButton) {
      startEl.onclick = () => {
        startButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
        startButton.classList.add('coursepilot-quiz-highlight');
      };
    }

    const rescanEl = helper.querySelector('#coursepilot-quiz-rescan');
    rescanEl.hidden = !isAttempt;
    rescanEl.onclick = () => rescan(true);
    helper.querySelector('#coursepilot-quiz-askall').onclick = () =>
      helper.querySelector('#coursepilot-quiz-list').classList.toggle('is-open');
    helper.querySelector('#coursepilot-quiz-download').onclick = () => {
      readQuizDump().then((dump) => downloadQuizDump(dump));
    };

    helper.querySelector('#coursepilot-quiz-clear').onclick = async () => {
      await clearQuizDump();

      autoAnsweredQuestions.clear();autoAnsweredQuestions.clear();

      if (currentAttemptId !== null) {
        sessionStorage.removeItem(
          getAttemptStateKey(currentAttemptId)
        );
      }
      await render(
        helper,
        null,
        'Đã xoá dữ liệu trích xuất.'
      );
    };

    // Trang một-câu-một-trang thì Moodle nạp lại toàn trang; trang gom nhiều câu thì cần quan sát DOM.
    // Bỏ qua thay đổi do chính panel sinh ra, nếu không sẽ thành vòng lặp rescan → render → rescan.
    observer = new MutationObserver((mutations) => {
      if (helper && mutations.every((mutation) => helper.contains(mutation.target)))
        return;
      clearTimeout(timer);
      timer = setTimeout(() => rescan(), RESCAN_DEBOUNCE_MS);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    await rescan();
  });

  function updateQuizDiag(helper, text) {
    const diagEl = helper?.querySelector('#coursepilot-quiz-diag');

    if (!diagEl) return;

    diagEl.textContent = text;
  }

  function updateAiStatus(helper, text) {
    const diagEl = helper?.querySelector('#coursepilot-quiz-diag');

    if (!diagEl) return;

    const baseStatus =
      diagEl.dataset.baseStatus || '';

    diagEl.textContent = [
      baseStatus,
      text,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  async function rescan(manual = false) {
    if (!helper) return;

    // =========================================
    // TRANG SUMMARY / XÁC NHẬN SAU KHI HOÀN THÀNH
    // =========================================
    if (isQuizSummaryPage()) {
      console.log(
        'Phát hiện trang Summary của quiz.'
      );

      updateAiStatus(
        helper,
        'Đã vào trang Summary · không gọi LLM lại'
      );

      const meta = readQuizMeta();

      const submitAllButton =
        findSubmitAllButton();

      if (!submitAllButton) {
        console.log(
          'Trang Summary nhưng chưa thấy nút Nộp bài và kết thúc.'
        );

        updateAiStatus(
          helper,
          'Đã vào trang Summary · chưa thấy nút Nộp bài và kết thúc'
        );

        return;
      }

      console.log(
        'Tìm thấy nút Nộp bài và kết thúc:',
        submitAllButton
      );

      // Nếu đã click submit trước đó thì không click lại
      if (
        meta.attemptId !== null &&
        wasSubmitClicked(meta.attemptId)
      ) {
        console.log(
          'Attempt này đã bấm Nộp bài và kết thúc trước đó, bỏ qua.'
        );

        updateAiStatus(
          helper,
          'Đã bấm Nộp bài và kết thúc trước đó'
        );

        return;
      }

      // Đánh dấu TRƯỚC khi click
      if (meta.attemptId !== null) {
        markSubmitClicked(meta.attemptId);
      }

      updateAiStatus(
        helper,
        'Đang bấm Nộp bài và kết thúc...'
      );

      console.log(
        'Đang bấm Nộp bài và kết thúc...'
      );

      await clickWithDelay(submitAllButton);

      console.log(
        'Đã bấm Nộp bài và kết thúc.'
      );

      return;
    }

    const { questions, deferredFrames } =
      extractQuizQuestions(provider);
    if (deferredFrames && !questions.length) {
      await render(
        helper,
        await readQuizDump(),
        'Moodle đang tải câu hỏi trong iframe — không đọc được.',
      );
      return;
    }
    if (!questions.length) {
      await render(
        helper,
        await readQuizDump(),
        manual ? 'Không tìm thấy câu hỏi nào trên trang này.' : '',
      );
      return;
    }
    const meta = readQuizMeta();

    // =========================================
    // 1. NẾU ĐỔI SANG ATTEMPT MỚI
    //    → XÓA DỮ LIỆU RAM CỦA ATTEMPT CŨ TRƯỚC
    // =========================================
    if (
      currentAttemptId !== null &&
      meta.attemptId !== null &&
      meta.attemptId !== currentAttemptId
    ) {
      console.log(
        'Phát hiện attempt mới:',
        currentAttemptId,
        '->',
        meta.attemptId,
        'Reset trạng thái RAM.'
      );

      autoAnsweredQuestions.clear();

      if (currentAttemptId !== null) {
        sessionStorage.removeItem(
          getAttemptStateKey(currentAttemptId)
        );
      }
    }

    // =========================================
    // 2. RESTORE DỮ LIỆU CỦA ATTEMPT HIỆN TẠI
    // =========================================
    if (meta.attemptId !== null) {
      restoreAnsweredQuestions(meta.attemptId);

      console.log(
        'Đã restore trạng thái câu hỏi của attempt:',
        meta.attemptId,
        'Số câu đã nhớ:',
        autoAnsweredQuestions.size
      );

      // =======================================
      // 3. GHI NHỚ ATTEMPT HIỆN TẠI
      // =======================================
      currentAttemptId = meta.attemptId;
    }

    const dump = await mergeIntoDump(
      meta,
      questions
    );

    await render(
      helper,
      dump,
      deferredFrames
        ? `${deferredFrames} câu hỏi còn nằm trong iframe, chưa đọc được.`
        : '',
    );
  }

  return () => {
    clearTimeout(timer);
    observer?.disconnect();
    helper?.remove();
  };
}
