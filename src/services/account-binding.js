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
    throw new Error('Extension này đã liên kết với một tài khoản khác. Xóa liên kết trong Cài đặt trước.');
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
