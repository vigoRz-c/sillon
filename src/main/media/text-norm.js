// Normalisation des titres et des noms d'artistes, partagée par la recherche
// de pochettes (Deezer) et de paroles (LRCLIB).

// Sans accents, en minuscules, lettres et chiffres séparés par une espace.
function strict(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// "Bohemian Rhapsody - Remastered 2011" -> "Bohemian Rhapsody".
// Seules les parenthèses qui suivent du texte sont retirées : « (Don't Fear)
// The Reaper » garde son début. Si tout disparaissait, on rend le texte d'origine.
function cleanTitle(s) {
  const src = String(s || '').trim();
  const out = src
    .replace(/(?<=\S)\s*[([].*?[)\]]/g, '')
    .replace(/(?<=\S)\s+-\s+.*$/, '')
    .trim();
  return out || src;
}

// "Break Stuff (Remastered 2021) - Live" -> "break stuff"
const norm = (s) => strict(cleanTitle(s));

// Windows donne parfois "Artiste 1, Artiste 2" : on garde le premier.
const firstArtist = (s) =>
  String(s || '')
    .split(/,|&| feat\.? | ft\.? /i)[0]
    .trim();

// Premier artiste, normalisé (pour comparer).
const artistKey = (s) => norm(firstArtist(s));

// Note dans le diagnostic si disponible (le module dépend d'Electron : absent
// dans les tests, où l'on n'a pas besoin du journal).
let diag;
function note(kind, text) {
  try {
    if (diag === undefined) diag = require('../app/diagnostic');
    diag.note(kind, text);
  } catch {
    diag = null;
  }
}

// Télécharge une image distante en data URL (la page n'accepte que data:).
// Garde-fous : HTTPS, hôte autorisé (hosts : RegExp sur le nom d'hôte), type
// image/jpeg|png|webp, 2 Mo au plus. Lève une erreur sinon.
const IMAGE_MAX = 2 * 1024 * 1024;
const IMAGE_TYPE = /^image\/(jpeg|png|webp)\s*(;|$)/i;

function checkImageUrl(url, hosts) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error("adresse d'image invalide");
  }
  if (u.protocol !== 'https:') throw new Error('image refusée : HTTPS obligatoire');
  if (!hosts.test(u.hostname)) throw new Error(`image refusée : hôte non autorisé (${u.hostname})`);
  return u;
}

// Lit le corps d'une réponse en s'arrêtant dès que `max` octets sont dépassés
// (un en-tête content-length absent ou mensonger ne suffit pas à protéger la
// mémoire).
async function readCapped(res, max, tooBig = 'réponse trop volumineuse') {
  const declared = Number(res.headers && res.headers.get && res.headers.get('content-length'));
  if (declared > max) throw new Error(tooBig);
  if (!res.body || typeof res.body.getReader !== 'function') {
    // Réponse sans flux lisible (corps vide, réponse simulée) : lecture directe.
    const buf =
      typeof res.arrayBuffer === 'function'
        ? Buffer.from(await res.arrayBuffer())
        : Buffer.from(await res.text(), 'utf8');
    if (buf.length > max) throw new Error(tooBig);
    return buf;
  }
  const reader = res.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new Error(tooBig);
    }
    parts.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(parts, size);
}

// JSON plafonné. Une réponse qui n'expose que json() (réponse simulée dans
// les tests) est lue telle quelle.
async function readJsonCapped(res, max, tooBig) {
  const readable = (res.body && typeof res.body.getReader === 'function') || res.arrayBuffer || res.text;
  if (!readable && typeof res.json === 'function') return res.json();
  return JSON.parse((await readCapped(res, max, tooBig)).toString('utf8'));
}

const MAX_REDIRECTS = 3;

async function fetchImageDataUrl(url, hosts, timeout = 8000) {
  let u = checkImageUrl(url, hosts);
  const signal = AbortSignal.timeout(timeout);
  let res;
  // Redirections suivies à la main : chaque adresse est vérifiée AVANT la requête.
  for (let hop = 0; ; hop++) {
    res = await fetch(u.href, { signal, redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) break;
    const loc = res.headers && res.headers.get && res.headers.get('location');
    if (!loc || hop >= MAX_REDIRECTS) throw new Error(`image ${res.status} : redirection refusée`);
    u = checkImageUrl(new URL(loc, u).href, hosts);
  }
  if (!res.ok) throw new Error(`image ${res.status}`);
  const type = (res.headers && res.headers.get('content-type')) || '';
  if (!IMAGE_TYPE.test(type)) throw new Error(`image refusée : type ${type || 'inconnu'}`);
  const buf = await readCapped(res, IMAGE_MAX, 'image refusée : trop grosse');
  return `data:${type.split(';')[0].trim().toLowerCase()};base64,${buf.toString('base64')}`;
}

module.exports = {
  strict,
  cleanTitle,
  norm,
  firstArtist,
  artistKey,
  note,
  fetchImageDataUrl,
  readCapped,
  readJsonCapped,
  IMAGE_MAX,
};
