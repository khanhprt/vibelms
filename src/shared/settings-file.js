import { DEFAULT_SETTINGS } from './constants.js';

// File cấu hình có thể mang cả mật khẩu LMS và API key dạng chữ thường, nên chỉ nhận
// đúng key đã biết: file lạ không được ghi đè rác vào storage.local.
const IMPORTABLE_KEYS = Object.keys(DEFAULT_SETTINGS);

function pickImportable(settings) {
  const picked = {};
  for (const key of IMPORTABLE_KEYS) {
    if (settings[key] !== undefined) picked[key] = settings[key];
  }
  return picked;
}

// allowedDomains trong storage là mảng, nhưng người dùng hay tay sửa file thành
// chuỗi nhiều dòng — chuẩn hoá cả hai về mảng trước khi lưu.
function normalizeDomains(value) {
  if (Array.isArray(value))
    return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string')
    return value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  return DEFAULT_SETTINGS.allowedDomains;
}

// Chấp nhận cả hai dạng: bọc trong { settings: {...} } hoặc phẳng {...}.
export function parseSettingsJson(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('File không phải JSON hợp lệ.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('File không chứa cấu hình.');
  }
  const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : raw;
  const picked = pickImportable(settings);
  if (!Object.keys(picked).length) throw new Error('File không có trường cấu hình nào.');
  if ('allowedDomains' in picked)
    picked.allowedDomains = normalizeDomains(picked.allowedDomains);
  return picked;
}

export async function readSettingsFile(file) {
  if (!file) throw new Error('Chưa chọn file.');
  if (typeof file.text === 'function') return parseSettingsJson(await file.text());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(parseSettingsJson(String(reader.result || '')));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Không đọc được file.'));
    reader.readAsText(file);
  });
}

// Xuất kèm mật khẩu và API key để máy mới không phải nhập lại; đổi lại file này
// phải được coi là bí mật.
export function exportSettingsFile(settings) {
  const payload = {
    exportedAt: new Date().toISOString(),
    containsSecrets: true,
    settings: pickImportable(settings),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `vernal-settings-${Date.now()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
