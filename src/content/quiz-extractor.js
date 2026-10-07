import { QUIZ_DUMP_KEY } from '../shared/constants.js';
import { settingsStore } from '../shared/settings-store.js';
import { clickWithDelay } from '../shared/delays.js';
import { readQuizDump } from '../shared/quiz-export.js';
import { recordLessonFailure } from '../shared/run-log.js';
import { logActivity } from './activity-log.js';

const RESCAN_DEBOUNCE_MS = 400;

// Chỉ ghi nhật ký khi số câu trích xuất đổi, tránh spam log mỗi lần quét lại DOM.
let lastExtractSignature = null;

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
    displayLabel: clean(
      (input.closest('.option, .r0, .answer > div') || input.parentElement)
        ?.querySelector('.answernumber')?.textContent,
    ),
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
          type: question.type,
          quizName: readQuizMeta().quizName,
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

      // Lỗi thiết lập/quyền không thể được xử lý bằng cách gọi lại cùng request.
      // Dừng ngay để không tạo thêm log lỗi và không gửi request thừa.
      const message = error?.message || String(error);
      if (
        attempt >= maxRetries ||
        /liên kết tài khoản|nhập API Auth|không có lựa chọn|Vernal đang tắt/i.test(message)
      ) {
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

// Gọi AI rồi tự chọn đáp án. Không còn panel hiển thị nên chỉ trả kết quả và ghi log.
async function askSuggestion(question) {
  const label =
    question.qno || question.name || clean(question.stem).slice(0, 60);

  try {
    const answer = await requestSuggestionWithRetry(question, 3);

    // AI không đưa ra đáp án
    if (!answer?.value) {
      await recordLessonFailure(answer?.why || 'Quiz: no answer determined', {
        stage: 'quiz-answer', question: question.stem, questionKey: question.name,
      });

      logActivity(
        'warn',
        `Không chốt được đáp án quiz (${label})`,
        answer?.why || '',
      );

      return {
        success: false,
        reason: 'no-answer',
      };
    }

    // Tìm câu hỏi và click radio
    const clicked = await clickQuestionOptionByValue(
      question,
      answer.value
    );

    // Có đáp án nhưng click lỗi
    if (!clicked) {
      await recordLessonFailure('Quiz: could not select the answer', {
        stage: 'quiz-answer', question: question.stem, questionKey: question.name,
      });

      logActivity(
        'warn',
        `AI có đáp án nhưng không chọn được (${label})`,
        answer.label,
      );

      return {
        success: false,
        reason: 'click-failed',
        value: answer.value,
        label: answer.label,
      };
    }

    logActivity('success', `AI đã chọn đáp án quiz (${label})`, answer.label);

    return {
      success: true,
      value: answer.value,
      label: answer.label,
    };

  } catch (error) {
    // Gọi AI/API bị lỗi
    await recordLessonFailure(error.message || String(error), {
      stage: 'quiz-answer', question: question.stem, questionKey: question.name,
    });

    logActivity('error', `Gọi AI cho quiz thất bại (${label})`, error.message || String(error));

    return {
      success: false,
      reason: 'error',
      error: error.message || String(error),
    };
  }
}

// Tự trả lời mọi câu có lựa chọn rồi tự bấm Hoàn thành nếu tất cả đều thành công.
async function processQuizQuestions(questions) {
  const jobs = questions.filter((question) => question.options?.length);

  console.log(`Tìm thấy ${jobs.length} câu có lựa chọn`);

  let allQuestionsSuccessful = true;
  let successCount = 0;

  for (let i = 0; i < jobs.length; i++) {
    const question = jobs[i];

    const questionKey =
      question.name ||
      question.inputId ||
      question.qno ||
      question.stem;

    if (!questionKey) {
      console.warn('Không tạo được key cho câu hỏi:', question);
      continue;
    }

    // Câu này đã xử lý trong lần load / lần quét trước
    const previousResult = autoAnsweredQuestions.get(questionKey);

    if (previousResult) {
      if (previousResult.success) {
        successCount++;

        console.log(
          `AI câu ${i + 1}/${jobs.length} đã thành công trước đó:`,
          previousResult
        );

        continue;
      }

      // Map có kết quả thất bại thì coi như cả bài chưa xong
      allQuestionsSuccessful = false;
      continue;
    }

    logActivity(
      'info',
      `Đang nhờ AI trả lời câu ${i + 1}/${jobs.length}`,
      question.qno || questionKey,
    );

    const aiResult = await askSuggestion(question);

    // Thành công
    if (aiResult?.success) {
      successCount++;

      // Lưu trong RAM để tránh hỏi lại trong cùng lần load
      autoAnsweredQuestions.set(questionKey, aiResult);

      // Lưu vào sessionStorage để nếu Moodle reload thì vẫn nhớ câu đã xử lý
      saveAnsweredQuestion(currentAttemptId, questionKey, aiResult);

      console.log(`AI câu ${i + 1}/${jobs.length} thành công:`, aiResult);
      continue;
    }

    // Không có đáp án
    if (aiResult?.reason === 'no-answer') {
      allQuestionsSuccessful = false;

      console.warn(`AI không xác định được câu ${i + 1}:`, question);
      continue;
    }

    // AI trả đáp án nhưng click DOM thất bại
    if (aiResult?.reason === 'click-failed') {
      allQuestionsSuccessful = false;

      console.warn(`Click thất bại câu ${i + 1}:`, aiResult);
      continue;
    }

    // Lỗi API / JSON / LLM
    if (aiResult?.reason === 'error') {
      allQuestionsSuccessful = false;

      console.error(`AI lỗi câu ${i + 1}:`, aiResult);
      continue;
    }
  }

  if (jobs.length === 0) return;

  if (allQuestionsSuccessful && successCount === jobs.length) {
    // Đã từng bấm Hoàn thành trong lần load này rồi
    if (currentAttemptId !== null && wasFinishClicked(currentAttemptId)) {
      console.log('Attempt này đã bấm Hoàn thành trước đó, bỏ qua.');
      return;
    }

    const finishButton = findFinishButton();

    if (!finishButton) {
      console.warn('Đã trả lời hết nhưng không tìm thấy nút Hoàn thành.');
      logActivity('warn', 'Đã trả lời hết nhưng không thấy nút Hoàn thành');
      return;
    }

    // Lưu trạng thái TRƯỚC khi click để Moodle reload vẫn nhớ.
    if (currentAttemptId !== null) markFinishClicked(currentAttemptId);

    await clickWithDelay(finishButton);

    console.log('Đã bấm nút Hoàn thành.');

    logActivity('success', 'Đã bấm Hoàn thành quiz');
    return;
  }

  console.warn(
    `Không tự hoàn thành vì chỉ thành công ${successCount}/${jobs.length} câu.`
  );

  logActivity(
    'warn',
    `Chỉ trả lời được ${successCount}/${jobs.length} câu · không tự nộp bài`,
  );
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

function findFinalConfirmButton() {
  // Chỉ tìm modal/dialog đang hiển thị.
  const dialogs = [
    ...document.querySelectorAll(
      '.modal.show, [role="dialog"], .modal[aria-modal="true"]'
    ),
  ];

  for (const dialog of dialogs) {
    // Bỏ qua dialog đang ẩn.
    const style = window.getComputedStyle(dialog);

    if (
      style.display === 'none' ||
      style.visibility === 'hidden'
    ) {
      continue;
    }

    const dialogText = clean(
      dialog.textContent || ''
    ).toLowerCase();

    // Đảm bảo đây đúng là modal xác nhận nộp bài.
    const looksLikeSubmitConfirm =
      dialogText.includes(
        'submit all your answers and finish'
      ) ||
      dialogText.includes(
        'một khi nộp bài'
      );

    if (!looksLikeSubmitConfirm) {
      continue;
    }

    const buttons = [
      ...dialog.querySelectorAll(
        'button, input[type="button"], input[type="submit"], a'
      ),
    ];

    const confirmButton = buttons.find((element) => {
      const text = clean(
        element.textContent ||
        element.value ||
        ''
      ).toLowerCase();

      return (
        text === 'nộp bài và kết thúc' ||
        text === 'submit all and finish'
      );
    });

    if (confirmButton) {
      return confirmButton;
    }
  }

  return null;
}

const confirmedStartButtons = new WeakSet();
let startConfirmationPending = false;

function findQuizStartConfirmationButton() {
  const dialogs = document.querySelectorAll(
    '.modal, [role="dialog"], .moodle-dialogue',
  );
  for (const dialog of dialogs) {
    const style = window.getComputedStyle(dialog);
    if (dialog.hidden || dialog.getAttribute('aria-hidden') === 'true' ||
      style.display === 'none' || style.visibility === 'hidden' ||
      !dialog.getClientRects().length) continue;

    const text = clean(dialog.textContent).toLowerCase();
    if (!dialog.querySelector('form#mod_quiz_preflight_form, form[action*="startattempt.php"]') &&
      !/bắt đầu làm bài|start attempt|start quiz|giới hạn thời gian|time limit/.test(text)) continue;

    const button = [...dialog.querySelectorAll('button, input[type="submit"], input[type="button"]')]
      .find(element => {
        const label = clean(element.textContent || element.value).toLowerCase();
        return /^(bắt đầu làm bài|bắt đầu bài làm|start attempt|start quiz)$/.test(label) &&
          !element.disabled && element.getAttribute('aria-disabled') !== 'true' &&
          element.getClientRects().length;
      });
    if (button) return button;
  }
  return null;
}

async function confirmQuizStartIfNeeded() {
  // Preflight belongs to the entry page, never the attempt/summary/review flow.
  if (location.pathname !== '/mod/quiz/view.php' || startConfirmationPending) return false;
  const settings = await settingsStore.get();
  if (settings.extensionEnabled === false || !settings.quizExportEnabled || !settings.autoStartQuiz ||
    (settings.allowedDomains.length && !settings.allowedDomains.includes(location.hostname))) return false;
  const button = findQuizStartConfirmationButton();
  if (!button || confirmedStartButtons.has(button) || startConfirmationPending) return false;

  startConfirmationPending = true;
  confirmedStartButtons.add(button);
  try {
    const clicked = await clickWithDelay(button);
    if (!clicked) confirmedStartButtons.delete(button);
    return clicked;
  } catch (error) {
    confirmedStartButtons.delete(button);
    await recordLessonFailure(error.message || String(error), { stage: 'quiz-start' });
    return false;
  } finally {
    startConfirmationPending = false;
  }
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
  return `vernal_quiz_state_${attemptId || 'unknown'}`;
}

function clearAttemptState(attemptId) {
  if (!attemptId) return;

  try {
    sessionStorage.removeItem(getAttemptStateKey(attemptId));
  } catch (error) {
    console.warn('Cannot clear quiz attempt state:', error);
  }

  if (currentAttemptId === attemptId) {
    autoAnsweredQuestions.clear();
    currentAttemptId = null;
  }
}

function isQuizReviewPage() {
  return location.pathname.endsWith('/mod/quiz/review.php');
}

function clearCompletedAttemptStates() {
  if (isQuizReviewPage()) {
    clearAttemptState(readQuizMeta().attemptId);
    return;
  }

  if (!location.pathname.endsWith('/mod/quiz/view.php')) return;

  // Review links in the attempt history identify submitted attempts exactly.
  for (const link of document.querySelectorAll('.quizattemptsummary a[href]')) {
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !url.pathname.endsWith('/mod/quiz/review.php')) {
      continue;
    }
    clearAttemptState(Number(url.searchParams.get('attempt')) || null);
  }
}

function readAttemptState(attemptId) {
  try {
    const raw = sessionStorage.getItem(
      getAttemptStateKey(attemptId)
    );

    if (!raw) {
      return {
        finishClicked: false,
        submitClicked: false,
        confirmClicked: false,
        answeredQuestions: {},
      };
    }

    const parsed = JSON.parse(raw);

    return {
      finishClicked: Boolean(parsed.finishClicked),
      submitClicked: Boolean(parsed.submitClicked),
      confirmClicked: Boolean(parsed.confirmClicked),

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
      confirmClicked: false,
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

function markConfirmClicked(attemptId) {
  if (!attemptId) return;

  const state = readAttemptState(attemptId);

  state.confirmClicked = true;

  saveAttemptState(attemptId, state);
}

function wasConfirmClicked(attemptId) {
  if (!attemptId) return false;

  return readAttemptState(attemptId).confirmClicked;
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
  clearCompletedAttemptStates();
  if (isQuizReviewPage()) return;
  let observer;
  let timer;
  let stopped = false;
  // Tự trả lời quiz ngay khi bật công tắc, đồng thời tôn trọng giới hạn domain sẵn có.
  settingsStore.get().then(async (settings) => {
    if (stopped || settings.extensionEnabled === false || !settings.quizExportEnabled) return;
    const { allowedDomains } = settings;
    if (allowedDomains.length && !allowedDomains.includes(location.hostname)) return;

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

    // Người dùng đã chọn tự bấm: mỗi lần tải trang bắt đầu thì vào thẳng bài.
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

      logActivity('info', 'Đã bấm nút Bắt đầu quiz', location.pathname);
    }

    // Trang một-câu-một-trang thì Moodle nạp lại toàn trang; trang gom nhiều câu thì cần quan sát DOM.
    observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => rescan(), RESCAN_DEBOUNCE_MS);
    });
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'disabled', 'aria-disabled'],
    });

    await rescan();
  }).catch(error => recordLessonFailure(error.message || String(error), {stage: 'quiz'}));

  async function rescan(manual = false) {
    if (stopped || (await settingsStore.get()).extensionEnabled === false) return;
    clearCompletedAttemptStates();
    if (isQuizReviewPage()) return;

    if (await confirmQuizStartIfNeeded()) return;

    // =========================================
    // 0. MODAL XÁC NHẬN NỘP BÀI CUỐI
    //
    // PHẢI kiểm tra trước Summary.
    // Vì khi modal mở, trang phía sau vẫn là Summary.
    // =========================================
    const finalConfirmButton =
      findFinalConfirmButton();

    if (finalConfirmButton) {
      console.log(
        'Phát hiện modal xác nhận nộp bài:',
        finalConfirmButton
      );

      const meta = readQuizMeta();

      // Chặn click lặp do MutationObserver gọi rescan nhiều lần.
      if (
        meta.attemptId !== null &&
        wasConfirmClicked(meta.attemptId)
      ) {
        console.log(
          'Attempt này đã xác nhận nộp bài trước đó, bỏ qua.'
        );

        logActivity('info', 'Đã xác nhận nộp bài trước đó'
        );

        return;
      }

      // Quan trọng: lưu trạng thái TRƯỚC khi click.
      if (meta.attemptId !== null) {
        markConfirmClicked(meta.attemptId);
      }

      logActivity('info', 'Đang xác nhận nộp bài cuối cùng...'
      );

      console.log(
        'Đang bấm nút xác nhận cuối:',
        finalConfirmButton
      );

      const clicked =
        await clickWithDelay(finalConfirmButton);

      if (!clicked) {
        console.warn(
          'Nút xác nhận đã rời DOM trước khi click.'
        );
        await recordLessonFailure('Quiz: final submission confirmation could not be clicked', {stage: 'quiz-submit'});

        // Nếu click thật sự thất bại thì cho phép retry.
        if (meta.attemptId !== null) {
          const state =
            readAttemptState(meta.attemptId);

          state.confirmClicked = false;

          saveAttemptState(
            meta.attemptId,
            state
          );
        }

        logActivity('info', 'Click xác nhận cuối thất bại · sẽ thử lại'
        );

        return;
      }

      console.log(
        'Đã click xác nhận Nộp bài và kết thúc.'
      );

      logActivity('info', 'Đã xác nhận nộp bài'
      );

      return;
    }

    // =========================================
    // 1. TRANG SUMMARY
    // =========================================
    if (isQuizSummaryPage()) {
      console.log(
        'Phát hiện trang Summary của quiz.'
      );

      logActivity('info', 'Đã vào trang Summary · không gọi LLM lại'
      );

      const meta = readQuizMeta();

      const submitAllButton =
        findSubmitAllButton();

      if (!submitAllButton) {
        console.log(
          'Trang Summary nhưng chưa thấy nút Nộp bài và kết thúc.'
        );

        logActivity('info', 'Đã vào trang Summary · chưa thấy nút Nộp bài và kết thúc'
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

        logActivity('info', 'Đã bấm Nộp bài và kết thúc trước đó'
        );

        return;
      }

      // Đánh dấu TRƯỚC khi click
      if (meta.attemptId !== null) {
        markSubmitClicked(meta.attemptId);
      }

      logActivity('info', 'Đang bấm Nộp bài và kết thúc...'
      );

      console.log(
        'Đang bấm Nộp bài và kết thúc...'
      );

    const clicked = await clickWithDelay(submitAllButton);

    if (!clicked) {
      console.warn(
        'Click Nộp bài và kết thúc thất bại.'
      );
      await recordLessonFailure('Quiz: submit button could not be clicked', {stage: 'quiz-submit'});

      if (meta.attemptId !== null) {
        const state =
          readAttemptState(meta.attemptId);

        state.submitClicked = false;

        saveAttemptState(
          meta.attemptId,
          state
        );
      }

      return;
    }

    console.log(
      'Đã bấm Nộp bài và kết thúc.'
    );

    // Modal thường được tạo bằng JS sau click.
    // MutationObserver sẽ bắt nó.
    // Gọi thêm rescan sau một khoảng ngắn để dự phòng.
    setTimeout(() => {
      rescan();
    }, 600);

    return;
    }

    const { questions, deferredFrames } =
      extractQuizQuestions(provider);
    if (!questions.length) {
      // Trang chưa có câu hỏi (hoặc còn nằm trong iframe): chỉ ghi log, không tự nộp bài.
      if (deferredFrames) {
        logActivity(
          'warn',
          `Moodle đang tải câu hỏi trong iframe · ${deferredFrames} khung chưa đọc được`,
        );
      } else if (manual) {
        logActivity('info', 'Không tìm thấy câu hỏi nào trên trang này');
      }
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

    const signature = `${meta.attemptId ?? ''}:${dump.questions.length}`;

    // Chỉ xử lý khi bộ câu hỏi đổi (trang mới, attempt mới hoặc Moodle nạp thêm câu)
    // để rescan do MutationObserver không gọi lại AI và không lặp log.
    if (signature !== lastExtractSignature) {
      lastExtractSignature = signature;

      logActivity(
        'info',
        `Đã trích xuất ${dump.questions.length} câu hỏi quiz`,
        meta.quizName,
      );

      if (deferredFrames) {
        logActivity(
          'warn',
          `${deferredFrames} câu hỏi còn nằm trong iframe, chưa đọc được`,
        );
      }

      await processQuizQuestions(dump.questions);
    }
  }

  return () => {
    stopped = true;
    clearTimeout(timer);
    observer?.disconnect();
  };
}
