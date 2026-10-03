const PANEL_ID = 'coursepilot-course-status';

function escapeHtml(value) {
  return value.replace(
    /[&<>'"]/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[char],
  );
}

function extractCourses() {
  const cards = document.querySelectorAll(
    '.card.dashboard-card, .coursebox, [data-region="course-content"] .card',
  );
  return [...cards].slice(0, 12).map((card, index) => {
    const courseLink = card.querySelector(
      'a[href*="/course/view.php?id="], .coursename a, a.coursename',
    );
    const title =
      courseLink?.textContent?.trim() ||
      card.querySelector('.coursename, .card-title, h3, h4')?.textContent?.trim() ||
      `Khóa học ${index + 1}`;
    const progress = card.querySelector('[aria-valuenow], .progress-bar');
    const raw = progress?.getAttribute('aria-valuenow') || progress?.style.width || '';
    const completionText =
      card.querySelector('.progress-text, [data-region="progress-text"], .text-muted')
        ?.textContent || '';
    const completion = completionText.match(/(\d+)\s*(?:trong|of)\s*(\d+)/i);
    const calculated = completion
      ? Math.round((Number(completion[1]) / Number(completion[2])) * 100)
      : 0;
    return {
      title,
      url: courseLink?.href || '',
      percent: Math.min(100, Math.max(0, Number.parseInt(raw, 10) || calculated)),
      completionText: completionText.trim(),
    };
  });
}
export function syncCourseStatusPanel(enabled) {
  document.querySelector(`#${PANEL_ID}`)?.remove();
  if (!enabled || !location.pathname.startsWith('/my/')) return;
  const courses = extractCourses();
  const host = document.createElement('aside');
  host.id = PANEL_ID;
  host.innerHTML = `<style>#${PANEL_ID}{position:fixed;z-index:2147483647;right:24px;bottom:24px;width:320px;color:#ecfff5;font:14px system-ui,sans-serif}#${PANEL_ID} .card{overflow:hidden;border:1px solid #86e8b855;border-radius:16px;background:linear-gradient(145deg,#19274b,#0e1732);box-shadow:0 18px 48px #06101ccc}#${PANEL_ID} header{display:flex;align-items:center;justify-content:space-between;padding:16px 17px 12px;background:linear-gradient(90deg,#1b805d33,transparent)}#${PANEL_ID} h2{margin:0;font-size:15px}#${PANEL_ID} small{color:#98b6ad}#${PANEL_ID} button{border:0;background:transparent;color:#8bf0bc;font-size:19px;cursor:pointer}#${PANEL_ID} .list{max-height:270px;overflow:auto;padding:0 17px 12px}#${PANEL_ID} .course{display:block;padding:11px 0;border-top:1px solid #ffffff12;color:inherit;text-decoration:none;cursor:pointer}#${PANEL_ID} .course:hover{background:#6be6ad0d}#${PANEL_ID} .line{display:flex;justify-content:space-between;gap:12px;font-size:12px;font-weight:650}#${PANEL_ID} .line span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#${PANEL_ID} .pct{color:#83edb7}#${PANEL_ID} .meta{margin-top:4px;font-size:10px;color:#99b7ae}#${PANEL_ID} .track{height:5px;margin-top:8px;border-radius:99px;background:#ffffff18;overflow:hidden}#${PANEL_ID} .bar{height:100%;border-radius:inherit;background:linear-gradient(90deg,#45bf8a,#a2ffd1);box-shadow:0 0 10px #66e6a9}</style><div class="card"><header><div><h2>Tiến độ khóa học</h2><small>${courses.length} khóa học đang hiển thị</small></div><button aria-label="Đóng">×</button></header><div class="list">${courses.length ? courses.map((course) => `<a class="course" href="${escapeHtml(course.url)}"><div class="line"><span>${escapeHtml(course.title)}</span><span class="pct">${course.percent}%</span></div><div class="meta">${escapeHtml(course.completionText || 'Bấm để vào học tiếp')}</div><div class="track"><div class="bar" style="width:${course.percent}%"></div></div></a>`).join('') : '<small>Không tìm thấy khóa học hoặc tiến độ trên trang này.</small>'}</div></div>`;
  host.querySelector('button').addEventListener('click', () => host.remove());
  document.body.append(host);
}
