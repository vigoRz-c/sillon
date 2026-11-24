// Contrat entre le processus principal, le pont (preload), les pages et la démo.
// Lit les fichiers comme du texte (aucun require d'Electron) et vérifie que :
//   1. chaque canal envoyé par le preload (send / invoke) a un ipcMain.on / handle ;
//   2. chaque canal « on… » du preload est émis quelque part dans src/main ;
//   3. chaque bridge.X utilisé par src/renderer existe dans le preload ;
//   4. demo/fake-bridge.js expose exactement les méthodes du preload ;
//   5. chaque page a le droit (PAGE_CHANNELS) d'envoyer ce qu'elle utilise.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function jsFiles(rel) {
  const out = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.js')) out.push(p);
    }
  })(path.join(ROOT, rel));
  return out;
}
const sourcesOf = (rel) =>
  jsFiles(rel).map((p) => ({ file: path.relative(ROOT, p), text: fs.readFileSync(p, 'utf8') }));

// Bloc « { … } » qui suit `start` (accolades équilibrées, sans tenir compte des chaînes).
function blockAfter(text, start) {
  const i = text.indexOf(start);
  assert.notEqual(i, -1, `« ${start} » introuvable`);
  const open = text.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}' && --depth === 0) return text.slice(open, j + 1);
  }
  throw new Error(`accolade fermante introuvable après « ${start} »`);
}

const preloadText = read('src/main/app/preload.js');
const preloadBlock = blockAfter(preloadText, "exposeInMainWorld('bridge'");
// Clés de premier niveau (indentation de deux espaces dans preload.js).
const preloadKeys = [...preloadBlock.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
// Canaux utilisés par chaque méthode : ipcRenderer.send/invoke/on('canal', …).
// Les abonnements passent par sub('canal') (équivaut à ipcRenderer.on).
const preloadChannels = [...preloadBlock.matchAll(/(?:ipcRenderer\.(send|invoke|on)|\b(sub))\('([^']+)'/g)].map(
  (m) => ({
    kind: m[1] || 'on',
    channel: m[3],
  }),
);
// Méthode du pont -> canal envoyé au processus principal (send / invoke seulement).
const methodChannel = {};
for (const m of preloadBlock.matchAll(/^ {2}(\w+):.*?ipcRenderer\.(?:send|invoke)\('([^']+)'/gm))
  methodChannel[m[1]] = m[2];

const main = sourcesOf('src/main');
// Le processus principal écrit « ipc.handle » ou « ipcMain.handle » (alias).
const mainHandled = new Set(
  main.flatMap((s) =>
    [...s.text.matchAll(/\bipc(?:Main)?\.(?:on|handle|once|handleOnce)\(\s*'([^']+)'/g)].map((m) => m[1]),
  ),
);
// Émissions reconnues : webContents.send('canal', …) et S.send(fenêtres, 'canal', …).
const SEND = /\bsend\(\s*(?:(?:\[[^\]]*\]|[\w.]+(?:\(\))?)\s*,\s*)?'([^']+)'/g;
const mainSent = new Set(main.flatMap((s) => [...s.text.matchAll(SEND)].map((m) => m[1])));

test('le preload expose des méthodes et des canaux', () => {
  assert.ok(preloadKeys.length >= 30, `trop peu de méthodes détectées : ${preloadKeys.length}`);
  assert.ok(preloadChannels.length >= preloadKeys.length - 2);
});

test('chaque canal send / invoke du preload est écouté par ipcMain', () => {
  const missing = preloadChannels
    .filter((c) => c.kind !== 'on')
    .filter((c) => !mainHandled.has(c.channel))
    .map((c) => c.channel);
  assert.deepEqual(missing, [], `canaux sans ipcMain.on/handle dans src/main : ${missing.join(', ')}`);
});

test('chaque canal on… du preload est émis par src/main', () => {
  const missing = preloadChannels
    .filter((c) => c.kind === 'on')
    .filter((c) => !mainSent.has(c.channel))
    .map((c) => c.channel);
  assert.deepEqual(missing, [], `canaux jamais émis par src/main : ${missing.join(', ')}`);
});

test('chaque bridge.X utilisé par src/renderer existe dans le preload', () => {
  const used = new Set();
  for (const s of sourcesOf('src/renderer')) {
    for (const m of s.text.matchAll(/\bbridge\.(\w+)/g)) used.add(m[1]);
  }
  const missing = [...used].filter((k) => !preloadKeys.includes(k));
  assert.deepEqual(missing, [], `bridge.X inconnus du preload : ${missing.join(', ')}`);
});

test('demo/fake-bridge.js expose exactement les méthodes du preload', () => {
  const demoBlock = blockAfter(read('demo/fake-bridge.js'), 'window.bridge = {');
  const demoKeys = [...demoBlock.matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]);
  const absentFromDemo = preloadKeys.filter((k) => !demoKeys.includes(k));
  const absentFromPreload = demoKeys.filter((k) => !preloadKeys.includes(k));
  assert.deepEqual(absentFromDemo, [], `manquants dans demo/fake-bridge.js : ${absentFromDemo.join(', ')}`);
  assert.deepEqual(absentFromPreload, [], `en trop dans demo/fake-bridge.js : ${absentFromPreload.join(', ')}`);
});

test('chaque page peut envoyer les canaux des méthodes du pont qu’elle utilise, et rien d’inutile', () => {
  const { PAGE_CHANNELS } = require('../src/main/app/ipc-guard');
  const pagesDir = 'src/renderer/pages';
  const pages = fs.readdirSync(path.join(ROOT, pagesDir)).filter((f) => f.endsWith('.html'));
  assert.deepEqual(
    pages.slice().sort(),
    Object.keys(PAGE_CHANNELS).sort(),
    'une page HTML sans liste de canaux (ou l’inverse)',
  );
  for (const page of pages) {
    const html = read(`${pagesDir}/${page}`);
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => path.posix.join(pagesDir, m[1]));
    const needed = new Set();
    for (const js of scripts) {
      for (const m of read(js).matchAll(/\bbridge\.(\w+)/g)) if (methodChannel[m[1]]) needed.add(methodChannel[m[1]]);
    }
    const allowed = PAGE_CHANNELS[page];
    const missing = [...needed].filter((c) => !allowed.includes(c));
    const unused = allowed.filter((c) => !needed.has(c));
    assert.deepEqual(missing, [], `${page} utilise des canaux non autorisés : ${missing.join(', ')}`);
    assert.deepEqual(unused, [], `${page} a des canaux qu’elle n’utilise pas : ${unused.join(', ')}`);
    for (const c of allowed) assert.ok(mainHandled.has(c), `${page} : canal ${c} sans ipcMain.on/handle`);
  }
});
