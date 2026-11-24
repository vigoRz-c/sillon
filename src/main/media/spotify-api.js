// @ts-check
// Connection to the Spotify Web API: queue ("Up next"), and shuffle /
// repeat (Spotify ignores these two commands coming from Windows).
//
// "Authorization Code + PKCE" authorization: no secret in the app, and the
// Client ID is not secret either (it identifies the app, not the user).
//
// Two options:
//  - the Spotify app built into Sillon (BUILTIN_CLIENT_ID): signing in is
//    enough. But in development mode, Spotify limits it to 5 accounts, which
//    its owner adds one by one in their dashboard;
//  - your own app (developer.spotify.com, Premium owner since February
//    2026), with the redirect address REDIRECT_URI below.
// Sign-in happens in the browser; the tokens stay on this PC,
// encrypted by Windows (safeStorage) when possible.

const { app, shell, safeStorage } = require('electron');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { note } = require('./text-norm');
const { t } = require('../app/i18n');

// "Sillon" Spotify app (development mode: allowed accounts only).
const BUILTIN_CLIENT_ID = '2205461c49cc4912a8e5f913ebc36c6d';

const PORT = 43821;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = 'user-read-playback-state user-read-currently-playing user-modify-playback-state';
const MODIFY = 'user-modify-playback-state';
const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';

const escapeHtml = (t) =>
  String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

class SpotifyApi extends EventEmitter {
  // getConfig() -> { custom: bool, clientId: string } (Client ID personnel)
  constructor(getConfig) {
    super();
    this.getConfig = getConfig;
    this.file = path.join(app.getPath('userData'), 'spotify-token.bin');
    this.tokens = null;
    this.server = null;
    this.lastError = '';
    this.persistWarning = ''; // tokens not remembered (encryption unavailable, could not write)
    this.session = 0; // incremented on each sign-out: a write in progress must not undo it
    this.refreshing = null; // token refresh in progress, shared by concurrent calls
    // Asynchronous reading of the tokens (Electron 45+ encryption API).
    this.ready = this.load()
      .then((t) => {
        if (t && !this.tokens) this.tokens = t;
      })
      .catch((e) => this.loadFailed(e));
  }

  loadFailed(e) {
    console.error('Jetons Spotify :', e.message);
    note('spotify', `jetons illisibles : ${e.message}`);
    this.setError(t('spotify.unreadableTokens'));
    return null;
  }

  // ----- Tokens on disk (encrypted by Windows when possible) -----
  async load() {
    let raw;
    try {
      raw = fs.readFileSync(this.file);
    } catch (e) {
      if (e.code === 'ENOENT') return null; // never connected: normal
      return this.loadFailed(e);
    }
    try {
      if (await safeStorage.isAsyncEncryptionAvailable()) {
        try {
          const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(raw);
          const tokens = JSON.parse(result);
          if (shouldReEncrypt) await this.save(tokens); // key renewed by Windows
          return tokens;
        } catch (e) {
          // Plain-text file from an old version: read, then encrypted.
          let legacy = null;
          try {
            legacy = JSON.parse(raw.toString('utf8'));
          } catch {
            /* vraiment illisible */
          }
          if (!legacy || !legacy.refresh) throw e;
          await this.save(legacy);
          return legacy;
        }
      }
      return JSON.parse(raw.toString('utf8'));
    } catch (e) {
      return this.loadFailed(e);
    }
  }

  // Persists first, then keeps in memory. Without Windows encryption, nothing
  // is written in plain text: the sign-in only lasts for this session.
  // Returns false if a sign-out happened in the meantime (nothing is written).
  async save(tokens) {
    const session = this.session;
    const json = JSON.stringify(tokens);
    try {
      if (await safeStorage.isAsyncEncryptionAvailable()) {
        const data = await safeStorage.encryptStringAsync(json);
        if (session !== this.session) return false;
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        fs.writeFileSync(tmp, data);
        fs.renameSync(tmp, this.file);
        this.persistWarning = '';
      } else {
        this.persistWarning = t('spotify.noEncryption');
        this.setError(this.persistWarning);
      }
    } catch (e) {
      console.error('Jetons Spotify :', e.message);
      note('spotify', `tokens not saved: ${e.message}`);
      this.persistWarning = t('spotify.notSaved', { error: e.message });
      this.setError(this.persistWarning);
    }
    if (session !== this.session) return false;
    this.tokens = tokens;
    return true;
  }

  // Client ID used: the user's, or the one built into Sillon.
  clientId() {
    const c = this.getConfig();
    return c.custom ? (c.clientId || '').trim() : BUILTIN_CLIENT_ID;
  }

  builtIn() {
    return !this.getConfig().custom;
  }

  // Tokens obtained with another Client ID (the option changed): unusable.
  tokensMatch() {
    return !!(this.tokens && this.tokens.refresh && this.tokens.clientId === this.clientId());
  }

  // Shuffle / repeat controllable: connected with the permission to
  // control playback (sign-ins from before 0.1.3: sign in again).
  // Spotify may then forbid them at times: see player().allowed.
  canControl() {
    return (
      this.tokensMatch() &&
      String(this.tokens.scope || '')
        .split(' ')
        .includes(MODIFY)
    );
  }

  status() {
    return {
      connected: this.tokensMatch(),
      builtIn: this.builtIn(),
      error: this.lastError,
      redirectUri: REDIRECT_URI,
      canControl: this.canControl(),
      needsReconnect:
        this.tokensMatch() &&
        !String(this.tokens.scope || '')
          .split(' ')
          .includes(MODIFY),
    };
  }

  setError(msg) {
    this.lastError = msg || '';
    this.emit('status', this.status());
  }

  // Clears a passing error, but not the "sign-in not remembered" warning.
  clearError() {
    this.setError(this.persistWarning);
  }

  logout() {
    this.session++;
    this.persistWarning = '';
    this.tokens = null;
    let error = '';
    try {
      fs.unlinkSync(this.file);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.error('Jetons Spotify :', e.message);
        note('spotify', `tokens not erased: ${e.message}`);
        error = t('spotify.notErased', { error: e.message });
      }
    }
    this.setError(error);
  }

  // ----- Sign-in (browser + small local server for the return) -----
  login() {
    const clientId = this.clientId();
    if (!/^[0-9a-f]{32}$/i.test(clientId)) {
      this.setError(t('spotify.badClientId'));
      return;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    const verifier = b64url(crypto.randomBytes(64));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));

    let timer = null;
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const done = (ok, text) => {
        clearTimeout(timer);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        });
        res.end(`<!doctype html><meta charset="utf-8"><title>Sillon</title>
<body style="font-family:Segoe UI,sans-serif;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h2>${escapeHtml(t(ok ? 'spotify.pageConnected' : 'spotify.pageFailed'))}</h2><p>${escapeHtml(text)}</p></div>`);
        server.close();
        if (this.server === server) this.server = null;
      };
      if (url.searchParams.get('state') !== state) {
        // Any page must not be able to cancel the sign-in: 400, the server stays open.
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(t('spotify.unexpected'));
        return;
      }
      const err = url.searchParams.get('error');
      if (err) {
        this.setError(err === 'access_denied' ? t('spotify.denied') : t('spotify.error', { error: err }));
        done(false, t('spotify.closeTab'));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        this.setError(t('spotify.noCode'));
        done(false, t('spotify.noCodePage'));
        return;
      }
      try {
        const tok = await this.tokenRequest({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: clientId,
          code_verifier: verifier,
        });
        await this.save({
          access: tok.access_token,
          refresh: tok.refresh_token,
          expiresAt: Date.now() + tok.expires_in * 1000,
          clientId,
          scope: tok.scope || '',
        });
        this.clearError();
        this.emit('connected');
        done(true, t('spotify.done'));
      } catch (e) {
        this.setError(e.message);
        done(false, e.message);
      }
    });
    server.on('error', (e) => this.setError(t('spotify.portBusy', { port: PORT, error: e.message })));
    server.listen(PORT, '127.0.0.1', () => {
      const q = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        code_challenge_method: 'S256',
        code_challenge: challenge,
        scope: SCOPES,
        state,
      });
      shell.openExternal(`${ACCOUNTS}/authorize?${q}`);
    });
    this.server = server;
    // Give up after 5 minutes without a return.
    timer = setTimeout(
      () => {
        if (this.server === server) {
          server.close();
          this.server = null;
          this.setError(t('spotify.expired'));
        }
      },
      5 * 60 * 1000,
    );
    if (timer.unref) timer.unref();
  }

  // Reply of Spotify's /api/token endpoint.
  /**
   * @typedef {{ access_token: string, refresh_token?: string, expires_in: number, scope?: string,
   *   error?: string, error_description?: string }} TokenResponse
   */

  /** @param {Record<string, string>} params @returns {Promise<TokenResponse>} */
  async tokenRequest(params) {
    const res = await fetch(`${ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(10000),
    });
    const json = /** @type {TokenResponse} */ (await res.json().catch(() => ({})));
    if (!res.ok) {
      const hint = json.error === 'invalid_client' ? t('spotify.refusedHint') : '';
      throw new Error(t('spotify.refused', { error: json.error_description || json.error || res.status, hint }));
    }
    return json;
  }

  async accessToken() {
    await this.ready;
    const t = this.tokens;
    if (!t || !t.refresh) return null;
    if (!this.tokensMatch()) return null; // connected with the other option: sign in again
    if (t.access && Date.now() < t.expiresAt - 60000) return t.access;
    // Only one refresh at a time: Spotify may renew the refresh
    // token, and the second call would get invalid_grant (so a sign-out).
    if (!this.refreshing) {
      this.refreshing = this.refreshTokens(t).finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  async refreshTokens(t) {
    const session = this.session;
    try {
      const tok = await this.tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: t.refresh,
        client_id: t.clientId,
      });
      await this.save({
        ...t,
        access: tok.access_token,
        refresh: tok.refresh_token || t.refresh,
        expiresAt: Date.now() + tok.expires_in * 1000,
        scope: tok.scope || t.scope || '',
      });
      return this.tokens ? this.tokens.access : null; // null if signed out in the meantime
    } catch (e) {
      // Token revoked or app deleted: signing in again is needed.
      if (session === this.session && /invalid_grant|invalid_client/.test(e.message)) this.logout();
      this.setError(e.message);
      return null;
    }
  }

  async get(pathname, retry = true) {
    const token = await this.accessToken();
    if (!token) return null;
    const res = await fetch(API + pathname, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 403) {
      // The real reason given by Spotify, for the diagnostic.
      const body = /** @type {any} */ (await res.json().catch(() => ({})));
      const why = (body.error && (body.error.reason || body.error.message)) || '';
      throw new Error(
        (this.builtIn() ? t('spotify.notOnBuiltin') : t('spotify.forbidden')) +
          (why ? t('spotify.reason', { reason: why }) : ''),
      );
    }
    if (res.status === 204) return null;
    if (res.status === 401 && retry) {
      if (this.tokens) this.tokens = { ...this.tokens, expiresAt: 0 };
      return this.get(pathname, false);
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 30;
      throw Object.assign(new Error(t('spotify.tooMany', { wait })), { retryAfter: wait });
    }
    if (!res.ok) throw new Error(`Spotify ${res.status}`);
    return res.json();
  }

  // Commande de lecture (PUT).
  async put(pathname) {
    const token = await this.accessToken();
    if (!token) throw new Error(t('spotify.notConnectedError'));
    const res = await fetch(API + pathname, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return;
    const body = /** @type {any} */ (await res.json().catch(() => ({})));
    const why = (body.error && (body.error.reason || body.error.message)) || res.status;
    if (res.status === 403) {
      // Forbidden for now (depending on the playback context; always for a
      // free account). It is not final: the state is read again afterwards.
      throw new Error(t('spotify.notNow', { why }));
    }
    if (res.status === 404) throw new Error(t('spotify.noPlayer'));
    throw new Error(`Spotify ${why}`);
  }

  // Shuffle and repeat of the player: { shuffle, repeat: 'None'|'List'|'Track' }.
  async player() {
    const p = await this.get('/me/player');
    if (!p) return null;
    // actions.disallows: what Spotify forbids right now (it changes with
    // playback: start of an album, ad, free account…).
    const no = (p.actions && p.actions.disallows) || {};
    return {
      shuffle: !!p.shuffle_state,
      repeat: { context: 'List', track: 'Track' }[p.repeat_state] || 'None',
      shuffleAllowed: !no.toggling_shuffle,
      repeatAllowed: !(no.toggling_repeat_context && no.toggling_repeat_track),
    };
  }

  setShuffle(on) {
    return this.put(`/me/player/shuffle?state=${on ? 'true' : 'false'}`);
  }
  setRepeat(mode) {
    return this.put(`/me/player/repeat?state=${{ List: 'context', Track: 'track' }[mode] || 'off'}`);
  }

  // Resumes playback (on the given device, otherwise the active device).
  play(deviceId) {
    return this.put(`/me/player/play${deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ''}`);
  }

  // Active device, otherwise the computer: { id, active } (null if none known).
  async playbackDevice() {
    const data = await this.get('/me/player/devices');
    const list = (data && Array.isArray(data.devices) && data.devices) || [];
    const d = list.find((x) => x.is_active) || list.find((x) => x.type === 'Computer');
    return d && d.id ? { id: d.id, active: !!d.is_active } : null;
  }

  // The next tracks: [{ title, artist, image }] (image = Spotify URL).
  // null = no token or refresh failed (unknown, not to be confused
  // with []: empty queue).
  async queue(limit = 4) {
    if (!(await this.accessToken())) return null;
    const data = await this.get('/me/player/queue');
    if (!data || !Array.isArray(data.queue)) return [];
    return data.queue.slice(0, limit).map((it) => {
      const images = (it.album && it.album.images) || it.images || (it.show && it.show.images) || [];
      const small =
        [...images].sort((a, b) => (a.width || 0) - (b.width || 0)).find((i) => (i.width || 0) >= 64) ||
        images[images.length - 1];
      return {
        title: it.name || '',
        artist: (it.artists && it.artists.map((a) => a.name).join(', ')) || (it.show && it.show.name) || '',
        image: small ? small.url : null,
      };
    });
  }
}

module.exports = { SpotifyApi };
