// One-click login engine — standalone hosted copy.
// Flow (agreed, do not change):
//   1. Opening the link IS the request. No "Request login" button, no form.
//   2. No mail, no code, no numbers, no time limit / expiry.
//   3. The phone that has the login opens the same page, sees the waiting
//      device, taps Approve once.
//   4. Approving stores a session and the waiting device signs itself in
//      and stays in. Deny / Cancel / Sign out / revoke all work.
//
// This is a demo of the user's own engine. It is NOT Microsoft/Outlook
// login: approving gives access to THIS app only, not to a real Outlook
// account. Anyone with the link can approve — keep the link private.
//
// Zero dependencies: Node stdlib only. Store is a JSON file so sessions
// survive restarts (on Railway, attach a Volume at /data — see README).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

// Data dir: Railway Volume at /data when present, else ./data.
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data'));
const STORE_FILE = path.join(DATA_DIR, 'store.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---- store (JSON file, write-through, atomic rename) ----
let store = { requests: [], sessions: [], approvers: {}, blocked: {} };
function loadStore() {
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.requests) && Array.isArray(parsed.sessions)) {
      store = { approvers: {}, blocked: {}, ...parsed };
    }
  } catch { /* first run: start empty */ }
}
function saveStore() {
  const tmp = STORE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}
loadStore();

function newId() { return crypto.randomUUID(); }

function deviceNameFromUA(ua = '') {
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua)) return 'iPad';
  if (/android/i.test(ua)) return 'Android phone';
  if (/windows/i.test(ua)) return 'Windows computer';
  if (/macintosh|mac os x/i.test(ua)) return 'Mac';
  if (/linux/i.test(ua)) return 'Linux computer';
  return 'This device';
}

function getDeviceId(req, res) {
  const cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').map((c) => {
      const i = c.indexOf('=');
      return i === -1 ? [] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
    }).filter((p) => p.length === 2)
  );
  let did = cookies.did;
  if (!did || typeof did !== 'string' || did.length < 10) {
    did = newId();
    res.setHeader('Set-Cookie', `did=${did}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`);
  }
  return did;
}

function myRequest(did) {
  return store.requests.find((r) => r.deviceId === did && r.status === 'pending') || null;
}
function hasSession(did) {
  return store.sessions.some((s) => s.deviceId === did);
}

function stateFor(req, res) {
  const did = getDeviceId(req, res);
  const ua = req.headers['user-agent'] || '';
  const name = deviceNameFromUA(ua);

  // Opening the link IS the request: a new, unsigned-in, non-approver
  // device automatically appears as waiting. No button, no form.
  // A device that was denied, cancelled, or signed out does NOT re-ask
  // on its own — it waits for "Ask again" instead of silently re-asking.
  if (!hasSession(did) && !store.approvers[did] && !store.blocked[did] && !myRequest(did)) {
    store.requests.push({ id: newId(), deviceId: did, deviceName: name, status: 'pending' });
    saveStore();
  }

  const mine = myRequest(did);
  return {
    deviceId: did,
    deviceName: name,
    signedIn: hasSession(did),
    approver: Boolean(store.approvers[did]),
    // My own ask (null when signed in, approver, denied or cancelled).
    myRequest: mine ? { id: mine.id, status: mine.status } : null,
    // Waiting devices that are NOT me — the phone approves these.
    waiting: store.requests
      .filter((r) => r.status === 'pending' && r.deviceId !== did)
      .map((r) => ({ id: r.id, deviceName: r.deviceName })),
    sessions: store.sessions.map((s) => ({ deviceId: s.deviceId, deviceName: s.deviceName, mine: s.deviceId === did })),
    past: store.requests
      .filter((r) => r.status !== 'pending')
      .slice(-20)
      .map((r) => ({ deviceName: r.deviceName, status: r.status, mine: r.deviceId === did })),
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    return sendJson(res, 200, stateFor(req, res));
  }

  if (req.method === 'POST' && url.pathname === '/api/approve') {
    const did = getDeviceId(req, res);
    const { requestId } = await readBody(req);
    const r = store.requests.find((x) => x.id === requestId && x.status === 'pending');
    if (!r) return sendJson(res, 404, { ok: false, error: 'That request is no longer waiting.' });
    if (r.deviceId === did) return sendJson(res, 400, { ok: false, error: 'You cannot approve your own request.' });
    r.status = 'approved';
    if (!hasSession(r.deviceId)) store.sessions.push({ deviceId: r.deviceId, deviceName: r.deviceName });
    // The device that approved is the phone: it stops asking for itself.
    store.approvers[did] = true;
    const mine = myRequest(did);
    if (mine) mine.status = 'cancelled';
    saveStore();
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/deny') {
    const did = getDeviceId(req, res);
    const { requestId } = await readBody(req);
    const r = store.requests.find((x) => x.id === requestId && x.status === 'pending');
    if (!r) return sendJson(res, 404, { ok: false, error: 'That request is no longer waiting.' });
    if (r.deviceId === did) return sendJson(res, 400, { ok: false, error: 'You cannot deny your own request.' });
    r.status = 'denied';
    store.blocked[r.deviceId] = 'denied';
    store.approvers[did] = true;
    const mine = myRequest(did);
    if (mine) mine.status = 'cancelled';
    saveStore();
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/cancel') {
    const did = getDeviceId(req, res);
    const mine = myRequest(did);
    if (mine) { mine.status = 'cancelled'; store.blocked[did] = 'cancelled'; saveStore(); }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/ask-again') {
    const did = getDeviceId(req, res);
    delete store.blocked[did];
    if (!hasSession(did) && !myRequest(did)) {
      store.requests.push({ id: newId(), deviceId: did, deviceName: deviceNameFromUA(req.headers['user-agent'] || ''), status: 'pending' });
      saveStore();
    }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/signout') {
    const did = getDeviceId(req, res);
    store.sessions = store.sessions.filter((s) => s.deviceId !== did);
    delete store.approvers[did];
    store.blocked[did] = 'signed-out';
    saveStore();
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/clear-past') {
    store.requests = store.requests.filter((r) => r.status === 'pending');
    saveStore();
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, HOST, () => {
  console.log(`one-click-login listening on ${HOST}:${PORT} (store: ${STORE_FILE})`);
});
