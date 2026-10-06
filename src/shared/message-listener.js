export function createMessageListener(types, handleMessage) {
  return (message, sender, sendResponse) => {
    if (!types.includes(message?.type)) return false;
    // Keep the channel open on Chrome versions without Promise listener support.
    Promise.resolve().then(() => handleMessage(message, sender)).then(
      result => sendResponse(result),
      error => sendResponse({ ok: false, reason: 'handler-failed', error: error?.message || String(error) }),
    );
    return true;
  };
}
