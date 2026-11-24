// Contract between the main process, the bridge (preload), the pages and the demo.
// Reads the files as text (no require of Electron) and checks that:
//   1. every channel sent by the preload (send / invoke) has an ipcMain.on / handle;
//   2. every "on…" channel of the preload is emitted somewhere in src/main;
//   3. every bridge.X used by src/renderer exists in the preload;
//   4. demo/fake-bridge.js exposes exactly the methods of the preload;
//   5. every page is allowed (PAGE_CHANNELS) to send what it uses.
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

// Block "{ … }" that follows `start` (balanced braces, ignoring strings).
function blockAfter(text, start) {
  const i = text.indexOf(start);
  assert.notEqual(i, -1, `"${start}" not found`);
  const open = text.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}' && --depth === 0) return text.slice(open, j + 1);
  }
  throw new Error(`closing brace not found after "${start}"`);
}

const preloadText = read('src/main/app/preload.js');
const preloadBlock = blockAfter(preloadText, "exposeInMainWorld('bridge'");
// Top-level keys (two-space indentation in preload.js).
const preloadKeys = [...preloadBlock.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
// Channels used by each method: ipcRenderer.send/invoke/on('channel', …).
// Subscriptions go through sub('channel') (same as ipcRenderer.on).
const preloadChannels = [...preloadBlock.matchAll(/(?:ipcRenderer\.(send|invoke|on)|\b(sub))\('([^']+)'/g)].map(
  (m) => ({
    kind: m[1] || 'on',
    channel: m[3],
  }),
);
// Bridge method -> channel sent to the main process (send / invoke only).
const methodChannel = {};
for (const m of preloadBlock.matchAll(/^ {2}(\w+):.*?ipcRenderer\.(?:send|invoke)\('([^']+)'/gm))
  methodChannel[m[1]] = m[2];

const main = sourcesOf('src/main');
// The main process writes "ipc.handle" or "ipcMain.handle" (alias).
const mainHandled = new Set(
  main.flatMap((s) =>
    [...s.text.matchAll(/\bipc(?:Main)?\.(?:on|handle|once|handleOnce)\(\s*'([^']+)'/g)].map((m) => m[1]),
  ),
);
// Recognized emissions: webContents.send('channel', …) and S.send(windows, 'channel', …).
const SEND = /\bsend\(\s*(?:(?:\[[^\]]*\]|[\w.]+(?:\(\))?)\s*,\s*)?'([^']+)'/g;
const mainSent = new Set(main.flatMap((s) => [...s.text.matchAll(SEND)].map((m) => m[1])));

test('the preload exposes methods and channels', () => {
  assert.ok(preloadKeys.length >= 30, `too few methods detected: ${preloadKeys.length}`);
  assert.ok(preloadChannels.length >= preloadKeys.length - 2);
});

test('every send / invoke channel of the preload is listened to by ipcMain', () => {
  const missing = preloadChannels
    .filter((c) => c.kind !== 'on')
    .filter((c) => !mainHandled.has(c.channel))
    .map((c) => c.channel);
  assert.deepEqual(missing, [], `channels without ipcMain.on/handle in src/main: ${missing.join(', ')}`);
});

test('every on… channel of the preload is emitted by src/main', () => {
  const missing = preloadChannels
    .filter((c) => c.kind === 'on')
    .filter((c) => !mainSent.has(c.channel))
    .map((c) => c.channel);
  assert.deepEqual(missing, [], `channels never emitted by src/main: ${missing.join(', ')}`);
});

test('every bridge.X used by src/renderer exists in the preload', () => {
  const used = new Set();
  for (const s of sourcesOf('src/renderer')) {
    for (const m of s.text.matchAll(/\bbridge\.(\w+)/g)) used.add(m[1]);
  }
  const missing = [...used].filter((k) => !preloadKeys.includes(k));
  assert.deepEqual(missing, [], `bridge.X inconnus du preload : ${missing.join(', ')}`);
});

test('demo/fake-bridge.js exposes exactly the methods of the preload', () => {
  const demoBlock = blockAfter(read('demo/fake-bridge.js'), 'window.bridge = {');
  const demoKeys = [...demoBlock.matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]);
  const absentFromDemo = preloadKeys.filter((k) => !demoKeys.includes(k));
  const absentFromPreload = demoKeys.filter((k) => !preloadKeys.includes(k));
  assert.deepEqual(absentFromDemo, [], `manquants dans demo/fake-bridge.js : ${absentFromDemo.join(', ')}`);
  assert.deepEqual(absentFromPreload, [], `en trop dans demo/fake-bridge.js : ${absentFromPreload.join(', ')}`);
});

test('every page may send the channels of the bridge methods it uses, and nothing useless', () => {
  const { PAGE_CHANNELS } = require('../src/main/app/ipc-guard');
  const pagesDir = 'src/renderer/pages';
  const pages = fs.readdirSync(path.join(ROOT, pagesDir)).filter((f) => f.endsWith('.html'));
  assert.deepEqual(
    pages.slice().sort(),
    Object.keys(PAGE_CHANNELS).sort(),
    'an HTML page without a channel list (or the reverse)',
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
    assert.deepEqual(missing, [], `${page} uses channels it is not allowed: ${missing.join(', ')}`);
    assert.deepEqual(unused, [], `${page} has channels it does not use: ${unused.join(', ')}`);
    for (const c of allowed) assert.ok(mainHandled.has(c), `${page} : canal ${c} sans ipcMain.on/handle`);
  }
});
