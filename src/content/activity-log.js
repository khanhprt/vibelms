// Nhật ký hoạt động hiện ngay trên trang: extension đang làm gì, đang bật hay đã
// dừng. Panel nằm trong Shadow DOM để tách style khỏi CSS của LMS, và để
// MutationObserver của learning-controller không nhìn thấy thay đổi bên trong
// (tránh vòng lặp quan sát do panel tự cập nhật mỗi giây).
import { settingsStore } from '../shared/settings-store.js';

const HOST_ID = 'vernal-activity-log';
// sessionStorage theo tab: log sống sót qua các lần chuyển trang cùng LMS mà không
// trộn log của tab khác. Dữ liệu chỉ là URL/tiêu đề mà chính trang đã có.
const STORE_KEY = 'vernal:activity-log';
const MAX_ENTRIES = 120;

const styles = `
  :host {
    position: fixed;
    z-index: 2147483647;
    left: 16px;
    bottom: 16px;
    width: 340px;
    color: #ecfff5;
    font: 12px/1.4 system-ui, sans-serif;
  }
  .card {
    display: flex;
    flex-direction: column;
    max-height: min(40vh, 320px);
    overflow: hidden;
    border: 1px solid rgba(178, 255, 218, 0.26);
    border-radius: 0;
    background: linear-gradient(160deg, #182448 0%, #10152f 56%, #0b1025 100%);
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.38), inset 0 1px rgba(255, 255, 255, 0.08);
  }
  .card.min { max-height: none; }
  .card.min .meta, .card.min .list { display: none; }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px;
    background: linear-gradient(90deg, rgba(27, 128, 93, 0.28), transparent);
    border-bottom: 1px solid rgba(210, 255, 232, 0.12);
  }
  .card.min .head { border-bottom: none; }
  .dot {
    width: 8px;
    height: 8px;
    flex: 0 0 auto;
    border-radius: 100%;
    background: #35f2d2;
    box-shadow: 0 0 0 0 rgba(53, 242, 210, 0.6);
    animation: pl 2s infinite;
  }
  .title {
    flex: 1;
    min-width: 0;
    color: #d9fbe9;
    font-size: 12px;
    font-weight: 800;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge {
    flex: 0 0 auto;
    padding: 2px 6px;
    border: 1px solid rgba(124, 245, 223, 0.4);
    border-radius: 999px;
    background: rgba(8, 16, 35, 0.54);
    color: #81f6b9;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .act {
    flex: 0 0 auto;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: #8bf0bc;
    font-size: 15px;
    line-height: 1;
    padding: 2px 4px;
    cursor: pointer;
  }
  .act:hover { background: rgba(124, 245, 223, 0.14); }
  .meta {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 10px;
    border-bottom: 1px solid rgba(210, 255, 232, 0.08);
    color: #99b7ae;
    font-size: 10px;
  }
  .path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .counter { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow: auto;
    padding: 6px 8px;
    scrollbar-width: thin;
    scrollbar-color: rgba(124, 245, 223, 0.45) rgba(8, 16, 35, 0.65);
  }
  .list::-webkit-scrollbar { width: 8px; height: 8px; }
  .list::-webkit-scrollbar-track { background: rgba(8, 16, 35, 0.65); }
  .list::-webkit-scrollbar-thumb { background: rgba(124, 245, 223, 0.45); border-radius: 0; }
  .list::-webkit-scrollbar-thumb:hover { background: rgba(124, 245, 223, 0.7); }
  .list::-webkit-scrollbar-corner { background: rgba(8, 16, 35, 0.65); }
  .row {
    display: flex;
    gap: 6px;
    padding: 4px 6px;
    border-left: 2px solid rgba(124, 245, 223, 0.5);
    border-radius: 4px;
    background: rgba(8, 16, 35, 0.45);
  }
  .row.warn { border-left-color: #fbbf24; background: rgba(251, 191, 36, 0.08); }
  .row.error { border-left-color: #f87171; background: rgba(248, 113, 113, 0.1); }
  .row.success { border-left-color: #81f6b9; }
  .time {
    flex: 0 0 auto;
    padding-top: 1px;
    color: #7cf5df;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .msg { flex: 1; min-width: 0; overflow-wrap: anywhere; color: #f4f8ff; }
  .detail { display: block; margin-top: 2px; color: #a9bbdd; font-size: 10px; }
  .empty { padding: 8px 4px; color: #99b7ae; font-size: 11px; text-align: center; }
  .card[data-state='stopped'] .dot { background: #f87171; box-shadow: none; animation: none; }
  .card[data-state='stopped'] .badge { color: #fecaca; border-color: rgba(248, 113, 113, 0.5); }
  .card[data-state='idle'] .dot { background: #fbbf24; box-shadow: none; animation: none; }
  .card[data-state='idle'] .badge { color: #fde68a; border-color: rgba(251, 191, 36, 0.5); }
  @keyframes pl { 70% { box-shadow: 0 0 0 6px rgba(53, 242, 210, 0); } }
`;

const markup = `
  <div class="card" data-state="running">
    <div class="head">
      <span class="dot" aria-hidden="true"></span>
      <span class="title">Nhật ký Vernal</span>
      <span class="badge">ĐANG HOẠT ĐỘNG</span>
      <button class="act act-clear" type="button" title="Xoá nhật ký" aria-label="Xoá nhật ký">⟳</button>
      <button class="act act-min" type="button" title="Thu gọn" aria-label="Thu gọn nhật ký">–</button>
      <button class="act act-close" type="button" title="Đóng nhật ký" aria-label="Đóng nhật ký">×</button>
    </div>
    <div class="meta">
      <span class="path"></span>
      <span class="counter"><span class="count">0</span> dòng · <span class="hb">--:--:--</span></span>
    </div>
    <div class="list"></div>
  </div>
`;

let entries = [];
let storeReady = false;
let host = null;
let refs = null;
let renderedCount = 0;
let pinned = true;
let heartbeatTimer = null;
let status = { enabled: true, supported: true, provider: '', path: '' };

function readStore() {
  if (storeReady) return;
  storeReady = true;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
    if (Array.isArray(parsed?.entries)) entries = parsed.entries.slice(-MAX_ENTRIES);
  } catch {
    entries = [];
  }
}

function writeStore() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ entries }));
  } catch {
    // sessionStorage bị chặn thì nhật ký vẫn chạy trong RAM.
  }
}

const formatTime = (ts) => new Date(ts).toLocaleTimeString('vi-VN', { hour12: false });

function makeRow(entry) {
  const row = document.createElement('div');
  row.className = `row ${entry.level}`;
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = formatTime(entry.ts);
  const msg = document.createElement('span');
  msg.className = 'msg';
  msg.textContent = entry.message;
  if (entry.detail) {
    const detail = document.createElement('span');
    detail.className = 'detail';
    detail.textContent = entry.detail;
    msg.append(detail);
  }
  row.append(time, msg);
  return row;
}

function autoScroll() {
  if (!pinned) return;
  refs.list.scrollTop = refs.list.scrollHeight;
}

function renderLog() {
  if (!refs) return;
  const all = entries;
  // Số dòng giảm = vừa xoá. Đạt giới hạn = mảng đã bị cắt phần tử cũ nên phải dựng lại
  // toàn bộ, nếu không dòng mới sẽ không bao giờ hiện thêm.
  if (renderedCount > all.length || all.length >= MAX_ENTRIES) {
    refs.list.replaceChildren();
    renderedCount = 0;
  }
  if (!all.length) {
    refs.list.replaceChildren();
    renderedCount = 0;
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Chưa có hoạt động nào.';
    refs.list.append(empty);
  } else {
    refs.list.querySelector('.empty')?.remove();
    const fragment = document.createDocumentFragment();
    for (let index = renderedCount; index < all.length; index += 1) {
      fragment.append(makeRow(all[index]));
    }
    refs.list.append(fragment);
    renderedCount = all.length;
    autoScroll();
  }
  refs.count.textContent = String(all.length);
}

function applyStatus() {
  if (!refs) return;
  const state = !status.enabled ? 'stopped' : status.supported ? 'running' : 'idle';
  refs.card.dataset.state = state;
  refs.badge.textContent =
    state === 'stopped' ? 'ĐÃ DỪNG' : state === 'idle' ? 'CHỜ TRANG LMS' : 'ĐANG HOẠT ĐỘNG';
  refs.path.textContent = status.path || `${location.hostname}${location.pathname}`;
}

function startHeartbeat() {
  clearInterval(heartbeatTimer);
  const tick = () => {
    if (refs) refs.hb.textContent = formatTime(Date.now());
  };
  tick();
  heartbeatTimer = setInterval(tick, 1000);
}

function closePanel() {
  // Đóng đồng nghĩa tắt nhật ký, giữ đúng trạng thái với công tắc trong popup.
  settingsStore.patch({ showActivityLog: false }).catch(() => {});
  removeActivityLogPanel();
}

function ensurePanel() {
  if (refs && host?.isConnected) return;
  clearInterval(heartbeatTimer);
  document.getElementById(HOST_ID)?.remove();
  host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${styles}</style>${markup}`;
  document.body.append(host);
  refs = {
    card: root.querySelector('.card'),
    badge: root.querySelector('.badge'),
    path: root.querySelector('.path'),
    count: root.querySelector('.count'),
    hb: root.querySelector('.hb'),
    list: root.querySelector('.list'),
  };
  renderedCount = 0;
  pinned = true;
  refs.list.addEventListener('scroll', () => {
    pinned = refs.list.scrollTop + refs.list.clientHeight >= refs.list.scrollHeight - 8;
  });
  root.querySelector('.act-clear').addEventListener('click', clearActivityLog);
  root.querySelector('.act-min').addEventListener('click', () => refs.card.classList.toggle('min'));
  root.querySelector('.act-close').addEventListener('click', closePanel);
  startHeartbeat();
  renderLog();
}

export function logActivity(level, message, detail) {
  readStore();
  entries.push({
    ts: Date.now(),
    level: ['info', 'success', 'warn', 'error'].includes(level) ? level : 'info',
    message: String(message ?? '').slice(0, 300),
    detail: detail ? String(detail).slice(0, 300) : '',
  });
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  writeStore();
  if (refs) renderLog();
}

export function clearActivityLog() {
  readStore();
  entries = [];
  writeStore();
  if (refs) renderLog();
}

export function mountActivityLogPanel() {
  ensurePanel();
  applyStatus();
}

export function setActivityLogStatus(next) {
  status = { ...status, ...next };
  applyStatus();
}

export function removeActivityLogPanel() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  refs = null;
  renderedCount = 0;
  host?.remove();
  host = null;
}
