import { settingsStore } from '../shared/settings-store.js';

/** Liên kết API với tài khoản LMS đã đăng nhập, không nhận hoặc lưu mật khẩu LMS. */
export async function bindLmsAccount(account) {
  if (!account?.authenticated || !account.accountId || !account.hostname) {
    throw new Error('Chưa xác minh được phiên đăng nhập LMS.');
  }
  const settings = await settingsStore.get();
  const payload = { accountId: account.accountId, hostname: account.hostname };

  if (
    settings.boundAccount &&
    (settings.boundAccount.accountId !== payload.accountId ||
      settings.boundAccount.hostname !== payload.hostname)
  ) {
    throw new Error(
      'Extension này đã liên kết với một tài khoản khác. Xóa liên kết trong Cài đặt trước.',
    );
  }

  if (settings.accountVerifyEndpoint) {
    const response = await fetch(settings.accountVerifyEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.llmApiKey ? { Authorization: `Bearer ${settings.llmApiKey}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error('API từ chối liên kết tài khoản này.');
    const result = await response.json();
    if (!result.authorized) throw new Error('Tài khoản LMS chưa được API cho phép.');
  }

  await settingsStore.patch({ boundAccount: payload });
  return { ok: true, boundAccount: payload };
}

/**
 * Tự gắn cờ liên kết khi ở chế độ cục bộ. Nếu accountVerifyEndpoint rỗng thì không có
 * API nào để xác thực, nên đăng nhập LMS thành công đã là đủ; cần chờ đây là hành
 * động tốn nhiều thao tác mà không thêm tính bảo mật nào. Khi đã cấu hình endpoint
 * thật thì vẫn phải liên kết tường minh để API chấp thuận tài khoản.
 */
export async function autoBindLocalAccount(account) {
  const settings = await settingsStore.get();
  if (settings.boundAccount) return settings.boundAccount;
  if (settings.accountVerifyEndpoint) return null;
  if (!account?.authenticated || !account.accountId || !account.hostname) return null;
  const boundAccount = { accountId: account.accountId, hostname: account.hostname };
  await settingsStore.patch({ boundAccount });
  return boundAccount;
}
