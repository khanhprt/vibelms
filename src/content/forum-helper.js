const HELPER_ID = 'coursepilot-forum-helper';

function extractDraft(response) {
  return (
    response?.choices?.[0]?.message?.content || response?.content || response?.draft || ''
  );
}

function parseDraft(response) {
  const raw = extractDraft(response)
    .replace(/^```json\s*|```$/g, '')
    .trim();
  const draft = JSON.parse(raw);
  if (!draft.title || !draft.question || !draft.answer)
    throw new Error('LLM không trả về đủ title, question và answer.');
  return draft;
}

function getLearningContext() {
  const crumbs = [
    ...document.querySelectorAll('.breadcrumb-item, [aria-label="breadcrumb"] li'),
  ]
    .map((item) => item.textContent.trim())
    .filter(Boolean);
  return {
    courseName:
      crumbs.length > 1
        ? crumbs[crumbs.length - 2]
        : document.querySelector('.course-title, #page-header h1')?.textContent?.trim(),
    chapterName:
      crumbs.at(-1) || document.querySelector('#page-header h1, h1')?.textContent?.trim(),
  };
}

async function applyPendingForumDraft() {
  if (!location.pathname.startsWith('/mod/forum/post.php')) return false;
  const { coursepilotForumDraft: draft } = await browser.storage.local.get(
    'coursepilotForumDraft',
  );
  if (!draft) return false;
  const subject = document.querySelector('#id_subject, input[name="subject"]');
  const message = document.querySelector(
    'textarea[name="message"], textarea[name*="message" i], textarea',
  );
  if (!subject || !message) return false;
  subject.value = draft.title;
  message.value = draft.question;
  subject.dispatchEvent(new Event('input', { bubbles: true }));
  message.dispatchEvent(new Event('input', { bubbles: true }));
  await browser.storage.local.remove('coursepilotForumDraft');
  const note = document.createElement('p');
  note.textContent = `Gợi ý trả lời để bạn kiểm tra: ${draft.answer}`;
  note.style.cssText =
    'margin:12px 0;padding:10px;border-left:3px solid #55cf91;background:#effff6;color:#173526;font:14px system-ui';
  message.closest('.form-group, .mb-3, div')?.before(note);
  return true;
}

export function mountForumHelper() {
  if (!location.pathname.startsWith('/mod/forum/')) return;
  applyPendingForumDraft();
  if (
    document.querySelector(`#${HELPER_ID}`) ||
    location.pathname.startsWith('/mod/forum/post.php')
  )
    return;
  const helper = document.createElement('aside');
  helper.id = HELPER_ID;
  helper.innerHTML = `<style>#${HELPER_ID}{position:fixed;z-index:2147483647;right:24px;bottom:24px;width:300px;padding:16px;border:1px solid #8be8ba66;border-radius:16px;background:#111a38;color:#effff6;box-shadow:0 16px 44px #020714b8;font:13px system-ui,sans-serif}#${HELPER_ID} h3{margin:0 0 8px;font-size:15px}#${HELPER_ID} p{margin:0;color:#b6c9c0;line-height:1.5}#${HELPER_ID} button{width:100%;margin-top:13px;padding:9px;border:0;border-radius:9px;background:#55cf91;color:#062216;font-weight:800;cursor:pointer}#${HELPER_ID} small{display:block;margin-top:9px;color:#90a9a0}</style><h3>Forum cần phản hồi</h3><p>Tạo một câu hỏi ngắn theo môn và chương hiện tại. Bạn sẽ tự xem lại trước khi đăng.</p><button>Tạo câu hỏi & mở form</button><small>Extension không tự gửi bài.</small>`;
  helper.querySelector('button').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Đang tạo bản nháp…';
    try {
      const context =
        document.querySelector('#region-main')?.innerText?.slice(0, 5000) ||
        document.body.innerText.slice(0, 5000);
      const { courseName, chapterName } = getLearningContext();
      const response = await browser.runtime.sendMessage({
        type: 'GENERATE_DISCUSSION',
        payload: { courseName, chapterName, topic: document.title, context },
      });
      const draft = parseDraft(response);
      await browser.storage.local.set({ coursepilotForumDraft: draft });
      const newTopic = document.querySelector(
        'a[href*="/mod/forum/post.php?forum="], a[href*="discuss.php?"]',
      );
      if (!newTopic?.href)
        throw new Error('Không tìm thấy nút Thêm chủ đề thảo luận mới.');
      location.assign(newTopic.href);
    } catch (error) {
      button.disabled = false;
      button.textContent = error.message || 'Không thể tạo bản nháp';
    }
  });
  document.body.append(helper);
}
