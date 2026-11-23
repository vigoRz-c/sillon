// Connexion à l'API Web de Spotify : file d'attente (« À suivre »), et lecture
// aléatoire / répétition (Spotify ignore ces deux commandes venant de Windows).
//
// Autorisation "Authorization Code + PKCE" : pas de secret dans l'app, et le
// Client ID n'est pas secret non plus (il identifie l'app, pas l'utilisateur).
//
// Deux possibilités :
//  - l'app Spotify intégrée à Sillon (BUILTIN_CLIENT_ID) : il suffit de se
//    connecter. Mais en mode développement, Spotify la limite à 5 comptes, que
//    son propriétaire ajoute un par un dans son tableau de bord ;
//  - sa propre app (developer.spotify.com, propriétaire Premium depuis février
//    2026), avec l'adresse de retour REDIRECT_URI ci-dessous.
// La connexion se fait dans le navigateur ; les jetons restent sur ce PC,
// chiffrés par Windows (safeStorage) quand c'est possible.

const { app, shell, safeStorage } = require('electron');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

// App Spotify « Sillon » (mode développement : comptes autorisés uniquement).
const BUILTIN_CLIENT_ID = '2205461c49cc4912a8e5f913ebc36c6d';

const PORT = 43821;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = 'user-read-playback-state user-read-currently-playing user-modify-playback-state';
const MODIFY = 'user-modify-playback-state';
const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

class SpotifyApi extends EventEmitter {
  // getConfig() -> { custom: bool, clientId: string } (Client ID personnel)
  constructor(getConfig) {
    super();
    this.getConfig = getConfig;
    this.file = path.join(app.getPath('userData'), 'spotify-token.bin');
    this.tokens = null;
    // Lecture asynchrone des jetons (API de chiffrement d'Electron 45+).
    this.ready = this.load().then((t) => {
      this.tokens = t;
    });
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
    } catch {
      return null;
    }
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

  // Client ID utilisé : celui de l'utilisateur, ou celui intégré à Sillon.
  clientId() {
    const c = this.getConfig();
    return c.custom ? (c.clientId || '').trim() : BUILTIN_CLIENT_ID;
  }

  builtIn() {
    return !this.getConfig().custom;
  }

  // Jetons obtenus avec un autre Client ID (on a changé d'option) : inutilisables.
  tokensMatch() {
    return !!(this.tokens && this.tokens.refresh && this.tokens.clientId === this.clientId());
  }

  // Aléatoire / répétition pilotables : connecté avec l'autorisation de
  // commander la lecture (connexions d'avant la 0.1.3 : se reconnecter).
  // Spotify peut ensuite les interdire par moments : voir player().allowed.
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

  logout() {
    this.tokens = null;
    try {
      fs.unlinkSync(this.file);
    } catch {
      /* déjà absent */
    }
    this.setError('');
  }

  // ----- Connexion (navigateur + petit serveur local pour le retour) -----
  login() {
    const clientId = this.clientId();
    if (!/^[0-9a-f]{32}$/i.test(clientId)) {
      this.setError('Client ID manquant ou invalide (32 caractères, copié depuis le tableau de bord Spotify).');
      return;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    const verifier = b64url(crypto.randomBytes(64));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const done = (ok, text) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Sillon</title>
<body style="font-family:Segoe UI,sans-serif;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h2>${ok ? 'Sillon est connecté à Spotify' : 'Connexion impossible'}</h2><p>${text}</p></div>`);
        server.close();
        if (this.server === server) this.server = null;
      };
      if (url.searchParams.get('state') !== state) {
        done(false, 'Réponse inattendue : relance la connexion depuis Sillon.');
        return;
      }
      const err = url.searchParams.get('error');
      if (err) {
        this.setError(err === 'access_denied' ? 'Connexion refusée dans Spotify.' : `Spotify : ${err}`);
        done(false, 'Tu peux fermer cet onglet.');
        return;
      }
      try {
        const tok = await this.tokenRequest({
          grant_type: 'authorization_code',
          code: url.searchParams.get('code'),
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
    // Abandon au bout de 5 minutes sans retour.
    setTimeout(
      () => {
        if (this.server === server) {
          server.close();
          this.server = null;
        }
      },
      5 * 60 * 1000,
    );
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
    if (!this.tokensMatch()) return null; // connecté avec l'autre option : se reconnecter
    if (t.access && Date.now() < t.expiresAt - 60000) return t.access;
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
    const res = await fetch(API + pathname, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 403) {
      // La vraie raison donnée par Spotify, pour le diagnostic.
      const body = await res.json().catch(() => ({}));
      const why = (body.error && (body.error.reason || body.error.message)) || '';
      throw new Error(
        (this.builtIn()
          ? "Ton compte Spotify n'est pas autorisé sur l'app intégrée à Sillon (Spotify la limite à 5 comptes, ajoutés par son propriétaire). Demande-lui de t'ajouter, ou utilise ton propre Client ID ci-dessous."
          : "Spotify refuse l'accès : le propriétaire de ton app doit avoir Premium, et ton compte doit être ajouté dans « User Management » de l'app.") +
          (why ? ` (Spotify : ${why})` : ''),
      );
    }
    if (res.status === 204) return null;
    if (res.status === 401 && retry) {
      this.tokens.expiresAt = 0;
      return this.get(pathname, false);
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 30;
      throw Object.assign(new Error(`Spotify : trop de requêtes, nouvel essai dans ${wait} s`), { retryAfter: wait });
    }
    if (!res.ok) throw new Error(`Spotify ${res.status}`);
    return res.json();
  }

  // Commande de lecture (PUT).
  async put(pathname) {
    const token = await this.accessToken();
    if (!token) throw new Error('Spotify non connecté');
    const res = await fetch(API + pathname, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return;
    const body = await res.json().catch(() => ({}));
    const why = (body.error && (body.error.reason || body.error.message)) || res.status;
    if (res.status === 403) {
      // Interdit pour l'instant (selon le contexte de lecture ; toujours pour un
      // compte gratuit). Ce n'est pas définitif : on relit l'état ensuite.
      throw new Error(`Spotify n'autorise pas ce changement pour le moment (${why})`);
    }
    if (res.status === 404) throw new Error('Aucun lecteur Spotify actif (lance la lecture dans Spotify).');
    throw new Error(`Spotify ${why}`);
  }

  // Aléatoire et répétition du lecteur : { shuffle, repeat: 'None'|'List'|'Track' }.
  async player() {
    const p = await this.get('/me/player');
    if (!p) return null;
    // actions.disallows : ce que Spotify interdit en ce moment (ça change selon
    // la lecture : début d'album, pub, compte gratuit…).
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

  // Les prochains morceaux : [{ title, artist, image }] (image = URL Spotify).
  async queue(limit = 4) {
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

module.exports = { SpotifyApi, REDIRECT_URI, BUILTIN_CLIENT_ID };
