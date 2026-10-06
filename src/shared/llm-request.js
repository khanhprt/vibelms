export async function requestLlmWithRetry(message, { parse, shouldContinue = () => true } = {}) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (!shouldContinue()) return null;
    try {
      const response = await browser.runtime.sendMessage(message);
      if (!shouldContinue()) return null;
      if (response?.error) throw new Error(response.error);
      if (response == null) throw new Error('LLM không trả phản hồi từ background.');
      return parse ? parse(response) : response;
    } catch (error) {
      console.warn(`LLM ${message.type}: lần ${attempt}/${maxAttempts} thất bại:`, error.message || String(error));
      if (attempt === maxAttempts)
        throw new Error(`LLM thất bại sau ${maxAttempts} lần thử: ${error.message || String(error)}`);
      await new Promise(resolve => setTimeout(resolve, 700 * attempt));
    }
  }
}
