// Connexion à l'API Web de Spotify, pour la file d'attente (« À suivre »).
//
// Autorisation "Authorization Code + PKCE" : pas de secret dans l'app. Il faut
// une app gratuite sur developer.spotify.com (son propriétaire doit avoir
// Spotify Premium depuis février 2026), avec l'adresse de retour REDIRECT_URI
// ci-dessous, puis coller son Client ID dans les paramètres de Spoti-View.
// La connexion se fait dans le navigateur ; les jetons restent sur ce PC,
// chiffrés par Windows (safeStorage) quand c'est possible.

const { app, shell, safeStorage } = require('electron');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 43821;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = 'user-read-playback-state user-read-currently-playing';
const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

class SpotifyApi extends EventEmitter {
  constructor(getClientId) {
    super();
    this.getClientId = getClientId;
    this.file = path.join(app.getPath('userData'), 'spotify-token.bin');
    this.tokens = null;
    // Lecture asynchrone des jetons (API de chiffrement d'Electron 45+).
    this.ready = this.load().then((t) => { this.tokens = t; });
    this.server = null;
    this.lastError = '';
  }

  // ----- Jetons sur disque (chiffrés par Windows quand c'est possible) -----
  async load() {
    try {
      const raw = fs.readFileSync(this.file);
      if (await safeStorage.isAsyncEncryptionAvailable()) {
        const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(raw);
        const tokens = JSON.parse(result);
        if (shouldReEncrypt) await this.save(tokens); // clé renouvelée par Windows
        return tokens;
      }
      return JSON.parse(raw.toString('utf8'));
    } catch { return null; }
  }

  async save(tokens) {
    this.tokens = tokens;
    const json = JSON.stringify(tokens);
    const data = (await safeStorage.isAsyncEncryptionAvailable())
      ? await safeStorage.encryptStringAsync(json)
      : Buffer.from(json, 'utf8');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, data);
  }

  status() {
    return { connected: !!(this.tokens && this.tokens.refresh), error: this.lastError, redirectUri: REDIRECT_URI };
  }

  setError(msg) {
    this.lastError = msg || '';
    this.emit('status', this.status());
  }

  logout() {
    this.tokens = null;
    try { fs.unlinkSync(this.file); } catch { /* déjà absent */ }
    this.setError('');
  }

  // ----- Connexion (navigateur + petit serveur local pour le retour) -----
  login() {
    const clientId = (this.getClientId() || '').trim();
    if (!/^[0-9a-f]{32}$/i.test(clientId)) {
      this.setError('Client ID manquant ou invalide (32 caractères, copié depuis le tableau de bord Spotify).');
      return;
    }
    if (this.server) { this.server.close(); this.server = null; }
    const verifier = b64url(crypto.randomBytes(64));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const done = (ok, text) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Spoti-View</title>
<body style="font-family:Segoe UI,sans-serif;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h2>${ok ? 'Spoti-View est connecté à Spotify' : 'Connexion impossible'}</h2><p>${text}</p></div>`);
        server.close();
        if (this.server === server) this.server = null;
      };
      if (url.searchParams.get('state') !== state) { done(false, 'Réponse inattendue : relance la connexion depuis Spoti-View.'); return; }
      const err = url.searchParams.get('error');
      if (err) { this.setError(err === 'access_denied' ? 'Connexion refusée dans Spotify.' : `Spotify : ${err}`); done(false, 'Tu peux fermer cet onglet.'); return; }
      try {
        const tok = await this.tokenRequest({
          grant_type: 'authorization_code', code: url.searchParams.get('code'),
          redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: verifier,
        });
        await this.save({ access: tok.access_token, refresh: tok.refresh_token, expiresAt: Date.now() + tok.expires_in * 1000, clientId });
        this.setError('');
        this.emit('connected');
        done(true, 'Tu peux fermer cet onglet et revenir au bureau.');
      } catch (e) {
        this.setError(e.message);
        done(false, e.message);
      }
    });
    server.on('error', (e) => this.setError(`Port ${PORT} indisponible : ${e.message}`));
    server.listen(PORT, '127.0.0.1', () => {
      const q = new URLSearchParams({
        client_id: clientId, response_type: 'code', redirect_uri: REDIRECT_URI,
        code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES, state,
      });
      shell.openExternal(`${ACCOUNTS}/authorize?${q}`);
    });
    this.server = server;
    // Abandon au bout de 5 minutes sans retour.
    setTimeout(() => { if (this.server === server) { server.close(); this.server = null; } }, 5 * 60 * 1000);
  }

  async tokenRequest(params) {
    const res = await fetch(`${ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const hint = json.error === 'invalid_client' ? ' (Client ID ou adresse de retour non enregistrée ?)' : '';
      throw new Error(`Spotify a refusé la connexion : ${json.error_description || json.error || res.status}${hint}`);
    }
    return json;
  }

  async accessToken() {
    await this.ready;
    const t = this.tokens;
    if (!t || !t.refresh) return null;
    if (t.access && Date.now() < t.expiresAt - 60000) return t.access;
    try {
      const tok = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: t.clientId });
      await this.save({ ...t, access: tok.access_token, refresh: tok.refresh_token || t.refresh, expiresAt: Date.now() + tok.expires_in * 1000 });
      return this.tokens.access;
    } catch (e) {
      // Jeton révoqué ou app supprimée : il faut se reconnecter.
      if (/invalid_grant|invalid_client/.test(e.message)) this.logout();
      this.setError(e.message);
      return null;
    }
  }

  async get(pathname, retry = true) {
    const token = await this.accessToken();
    if (!token) return null;
    const res = await fetch(API + pathname, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (res.status === 204) return null;
    if (res.status === 401 && retry) { this.tokens.expiresAt = 0; return this.get(pathname, false); }
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 30;
      throw Object.assign(new Error(`Spotify : trop de requêtes, nouvel essai dans ${wait} s`), { retryAfter: wait });
    }
    if (res.status === 403) throw new Error('Spotify refuse l\'accès (le propriétaire de l\'app doit avoir Premium, et ton compte doit être autorisé dans l\'app).');
    if (!res.ok) throw new Error(`Spotify ${res.status}`);
    return res.json();
  }

  // Les prochains morceaux : [{ title, artist, image }] (image = URL Spotify).
  async queue(limit = 4) {
    const data = await this.get('/me/player/queue');
    if (!data || !Array.isArray(data.queue)) return [];
    return data.queue.slice(0, limit).map((it) => {
      const images = (it.album && it.album.images) || it.images || (it.show && it.show.images) || [];
      const small = [...images].sort((a, b) => (a.width || 0) - (b.width || 0)).find((i) => (i.width || 0) >= 64) || images[images.length - 1];
      return {
        title: it.name || '',
        artist: (it.artists && it.artists.map((a) => a.name).join(', ')) || (it.show && it.show.name) || '',
        image: small ? small.url : null,
      };
    });
  }
}

module.exports = { SpotifyApi, REDIRECT_URI };
