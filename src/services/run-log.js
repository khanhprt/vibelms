const LOG_KEY = 'vernalRunLogs';
const TYPES = ['RUN_LOG_START', 'RUN_LOG_FAILURE', 'RUN_LOG_EXPORT', 'RUN_LOG_FINISH'];
let queue = Promise.resolve();

async function downloadLog(session) {
  const lines = ['Vernal - Learning session log', `Session: ${session.id}`,
    `Started: ${session.startedAt}`, `Finished: ${session.finishedAt || 'Running'}`,
    `Activities with errors: ${new Set(session.errors.map(entry => entry.url)).size}`, '',
    ...session.errors.flatMap(entry => [
      `[${entry.lastSeenAt}] ${entry.title}`, `URL: ${entry.url}`, `Stage: ${entry.stage}`,
      `Reason: ${entry.reason}`, ...(entry.question ? [`Question: ${entry.question}`] : []),
      `Occurrences: ${entry.count}`, '',
    ])];
  if (!session.errors.length) lines.push('No activity errors recorded.');
  const filename = `Vernal/logs/session-${session.startedAt.replace(/[:.]/g, '-')}-${session.id.slice(0, 8)}.log`;
  await browser.downloads.download({url: `data:text/plain;charset=utf-8,${encodeURIComponent(lines.join('\n'))}`,
    filename, conflictAction: 'overwrite', saveAs: false});
  return filename;
}

async function processMessage(message) {
  const stored = await browser.storage.local.get(LOG_KEY);
  const logs = stored[LOG_KEY] || {sessions: {}, latestId: null};
  const payload = message.payload || {};
  if (message.type === 'RUN_LOG_START') {
    const existing = logs.sessions[payload.sessionId];
    if (existing && !existing.finishedAt) return {ok: true, sessionId: existing.id};
    const id = crypto.randomUUID();
    logs.sessions[id] = {id, startedAt: new Date().toISOString(), finishedAt: null, errors: []};
    logs.latestId = id;
    await browser.storage.local.set({[LOG_KEY]: logs});
    return {ok: true, sessionId: id};
  }
  const session = logs.sessions[payload.sessionId || logs.latestId];
  if (!session) return {ok: false, reason: 'no-session-log'};
  if (message.type === 'RUN_LOG_FAILURE') {
    const url = new URL(payload.url);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid activity log URL');
    url.hash = '';
    const stage = String(payload.stage || 'activity').slice(0, 100);
    const reason = String(payload.reason || 'Unknown error').slice(0, 2000);
    const questionKey = String(payload.questionKey || '').slice(0, 200);
    const entry = session.errors.find(item => item.url === url.href && item.stage === stage &&
      item.reason === reason && item.questionKey === questionKey);
    const now = new Date().toISOString();
    if (entry) { entry.count++; entry.lastSeenAt = now; }
    else session.errors.push({url: url.href, title: String(payload.title || '').slice(0, 500),
      stage, reason, questionKey, question: String(payload.question || '').slice(0, 2000),
      firstSeenAt: now, lastSeenAt: now, count: 1});
    await browser.storage.local.set({[LOG_KEY]: logs});
    if (session.finishedAt) await downloadLog(session);
    return {ok: true};
  }
  if (message.type === 'RUN_LOG_FINISH') {
    if (session.finishedAt && session.exportedAt) return {ok: true};
    session.finishedAt = new Date().toISOString();
    await browser.storage.local.set({[LOG_KEY]: logs});
  }
  const filename = await downloadLog(session);
  session.exportedAt = new Date().toISOString();
  await browser.storage.local.set({[LOG_KEY]: logs});
  return {ok: true, filename};
}

export function handleRunLogMessage(message) {
  if (!TYPES.includes(message?.type)) return undefined;
  const result = queue.then(() => processMessage(message));
  queue = result.catch(() => {});
  return result;
}
