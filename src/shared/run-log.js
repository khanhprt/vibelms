const SESSION_KEY = 'vernal:run-log-session';
let pendingSession;

export async function ensureLearningSession() {
  if (!pendingSession) {
    pendingSession = browser.runtime.sendMessage({type: 'RUN_LOG_START', payload: {
      sessionId: sessionStorage.getItem(SESSION_KEY),
    }}).then(result => {
      if (!result?.ok) throw new Error('Cannot create learning log');
      sessionStorage.setItem(SESSION_KEY, result.sessionId);
      return result.sessionId;
    }).catch(error => { pendingSession = undefined; throw error; });
  }
  return pendingSession;
}

export async function recordLessonFailure(reason, details = {}) {
  const entry = {url: location.href, title: document.title, reason: String(reason),
    stage: details.stage, question: details.question, questionKey: details.questionKey};
  try {
    const sessionId = await ensureLearningSession();
    await browser.runtime.sendMessage({type: 'RUN_LOG_FAILURE', payload: {...entry, sessionId}});
  } catch (error) { console.warn('Cannot save activity error log:', error); }
}

export async function finishLearningSession() {
  try {
    const sessionId = sessionStorage.getItem(SESSION_KEY);
    if (!sessionId) return;
    sessionStorage.removeItem(SESSION_KEY);
    pendingSession = undefined;
    await browser.runtime.sendMessage({type: 'RUN_LOG_FINISH', payload: {sessionId}});
  } catch (error) { console.warn('Log remains in extension storage; automatic export failed:', error); }
}
