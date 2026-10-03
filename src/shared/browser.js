export async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('Không tìm thấy tab đang mở.');
  return tab;
}

export async function sendToActiveTab(tabId, message) {
  if (!tabId) return null;
  try {
    return await browser.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}

