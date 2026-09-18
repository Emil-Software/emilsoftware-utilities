// Run after npm run build. Uses a separate headless Edge profile and a local fixture API.
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function resolveBrowser() {
  if (process.env.ACCESSI_TEST_BROWSER) return process.env.ACCESSI_TEST_BROWSER;

  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function main() {
  const edge = resolveBrowser();
  if (!edge) throw new Error('Nessun browser Chromium trovato. Imposta ACCESSI_TEST_BROWSER con il percorso dell\'eseguibile.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'accessi-console-browser-'));
  const app = express();
  app.use(express.json());
  app.use('/api/accessi/console/assets', express.static(path.resolve('dist/accessi-module/Console')));
  app.use('/api/accessi/console', (_req, res) => res.sendFile(path.resolve('dist/accessi-module/Console/index.html')));
  const user = { codiceUtente: 2, email: 'managed@example.com', flagDueFattori: false, passwordlessLoginEnabled: false, passwordLoginEnabled: true, statoRegistrazione: 1 };
  const challenge = { challengeId: 'a'.repeat(64), expiresAt: new Date(Date.now() + 600000).toISOString(), resendAfterSeconds: 0, twoFactorRequired: true, method: 'email' };
  let profileUpdate;
  let resends = 0;
  const ok = (res, Result) => res.json({ status: 200, severity: 'success', statusCode: 0, Result });
  app.post('/api/accessi/auth/login', (req, res) => {
    if (req.body.email === 'code@example.com') { assert.equal(req.body.password, undefined); return ok(res, { challenge }); }
    return ok(res, req.body.password ? { token: { value: 'fixture-token' } } : { passwordRequired: true });
  });
  app.post('/api/accessi/auth/two-factor/verify', (req, res) => req.body.code === '123456' ? ok(res, { token: { value: 'fixture-token' } }) : res.status(401).json({ message: 'Codice non valido.' }));
  app.post('/api/accessi/auth/two-factor/resend', (_req, res) => { resends++; ok(res, { challenge }); });
  app.post('/api/accessi/auth/get-user-by-token', (_req, res) => ok(res, { userData: { codiceUtente: 1, email: 'admin@example.com', flagSuper: true } }));
  app.get('/api/accessi/user/get-users', (_req, res) => ok(res, [{ utente: user }]));
  app.put('/api/accessi/user/update-user/2', (req, res) => { profileUpdate = req.body; Object.assign(user, req.body); ok(res, {}); });
  app.use('/api/accessi/permission/grants', (_req, res) => ok(res, { ruoli: [], abilitazioni: [] }));
  app.use('/api/accessi', (_req, res) => ok(res, []));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/accessi/console/`;
  const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let socket;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 200 && !fs.existsSync(portFile); i++) await delay(100);
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await once(socket, 'open');
    let sequence = 0;
    const requests = new Map();
    const exceptions = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
      const pending = requests.get(message.id);
      if (pending) { requests.delete(message.id); message.error ? pending.reject(new Error(pending.method + ': ' + message.error.message)) : pending.resolve(message.result); }
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; requests.set(id, { method, resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const waitFor = async expression => {
      for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(100); }
      throw new Error(`Timed out: ${expression}`);
    };
    await call('Runtime.enable');
    await call('Page.navigate', { url: base });
    await waitFor("Boolean(document.querySelector('#login-form')?.onsubmit)");
    assert.equal(await evaluate("document.querySelector('#password-field').hidden"), true);
    await evaluate("document.querySelector('[name=email]').value='code@example.com'; document.querySelector('#login-form').requestSubmit()");
    await waitFor("!document.querySelector('#two-factor-form').hidden");
    assert.equal(await evaluate("document.querySelector('#password-field').hidden"), true);
    assert.equal(await evaluate("sessionStorage.getItem('accessi-console-token')"), null);
    await evaluate("document.querySelector('#resend-code').click()");
    await waitFor("!document.querySelector('#loading-overlay').hidden === false");
    assert.equal(resends, 1);
    await evaluate("document.querySelector('[name=code]').value='000000'; document.querySelector('#two-factor-form').requestSubmit()");
    await waitFor("document.querySelector('#login-error').textContent.includes('Codice non valido')");
    await evaluate("document.querySelector('[name=code]').value='123456'; document.querySelector('#two-factor-form').requestSubmit()");
    await waitFor("Boolean(document.querySelector('[data-user=\"2\"]'))");
    await evaluate("document.querySelector('[data-user=\"2\"]').click()");
    await waitFor("Boolean(document.querySelector('[name=flagDueFattori]'))");
    await evaluate("document.querySelector('[data-user-tab=profile]').click(); document.querySelector('[name=flagDueFattori]').click(); document.querySelector('[name=passwordlessLoginEnabled]').click(); document.querySelector('#profile').requestSubmit()");
    await waitFor("document.querySelector('#notice').textContent.includes('Profilo e policy aggiornati')");
    assert.equal(profileUpdate.flagDueFattori, true);
    assert.equal(profileUpdate.passwordlessLoginEnabled, true);
    await evaluate("document.querySelector('[name=flagDueFattori]').click(); document.querySelector('#profile').requestSubmit()");
    await waitFor("document.querySelector('[name=passwordlessLoginEnabled]').disabled && !document.querySelector('#loading-overlay').hidden === false");
    assert.equal(profileUpdate.flagDueFattori, false);
    assert.equal(profileUpdate.passwordlessLoginEnabled, false);
    await evaluate("document.querySelector('#logout').click()");
    await waitFor("!document.querySelector('#login').hidden");
    await evaluate("document.querySelector('[name=email]').value='normal@example.com'; document.querySelector('#login-form').requestSubmit()");
    await waitFor("!document.querySelector('#password-field').hidden");
    await evaluate("document.querySelector('[name=password]').value='Password-123'; document.querySelector('#login-form').requestSubmit()");
    await waitFor("!document.querySelector('#console').hidden");
    await call('Page.navigate', { url: base + '#two-factor=' + challenge.challengeId });
    await waitFor("!document.querySelector('#two-factor-form').hidden && location.hash === ''");
    assert.equal(await evaluate("sessionStorage.getItem('accessi-console-token')"), null);
    assert.deepEqual(exceptions, []);
    console.log('PASS: console passwordless, OTP errors/resend, verification, optional policy on/off, password login and SSO handoff.');
  } finally {
    if (socket) socket.close();
    browser.kill();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    // Only the uniquely generated test profile is eligible for cleanup.
    assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep + 'accessi-console-browser-'));
    for (let i = 0; i < 20; i++) {
      try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch { await delay(100); }
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
