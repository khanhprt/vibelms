import { resolveProvider } from '../providers/provider-registry.js';

export async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('Không tìm thấy tab đang mở.');
  return tab;
}

export async function sendToActiveTab(tabId, message) {
  if (!tabId) return null;
  try {
    return await browser.tabs.sendMessage(tabId, message);
  } catch (error) {
    let connectionError = error;
    if (/Receiving end does not exist/i.test(error?.message || '')) {
      try {
        const tab = await browser.tabs.get(tabId);
        const url = new URL(tab.url || 'about:blank');
        if (url.protocol !== 'https:' || !resolveProvider(url))
          return { ok: false, supported: false, reason: 'unsupported-page' };
        await browser.scripting.executeScript({
          target: { tabId }, files: ['content-scripts/content.js'],
        });
        return await browser.tabs.sendMessage(tabId, message);
      } catch (recoveryError) {
        connectionError = recoveryError;
      }
    }
    console.warn('LMS tab connection failed:', connectionError);
    return { ok: false, supported: false, reason: 'connection-failed', error: connectionError?.message || String(connectionError) };
  }
}

