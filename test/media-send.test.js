// state.js sendMedia : la pochette (lourde) n'est envoyée qu'une fois par
// fenêtre tant qu'elle ne change pas ; une page rechargée la reçoit en entier.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/main/app/state');

function fakeWin() {
  const sent = [];
  return { sent, isDestroyed: () => false, webContents: { send: (ch, d) => sent.push([ch, d]) } };
}

test('pochette envoyée une fois, puis « coverKept » tant qu’elle ne change pas', () => {
  const a = fakeWin();
  const b = fakeWin();
  const m = { title: 'T', cover: 'data:image/png;base64,AAA' };
  S.sendMedia([a], m);
  S.sendMedia([a, b], { ...m, volume: 40 });
  assert.equal(a.sent[0][1].cover, m.cover);
  assert.equal(a.sent[1][1].cover, undefined);
  assert.equal(a.sent[1][1].coverKept, true);
  assert.equal(a.sent[1][1].volume, 40);
  assert.equal(b.sent[0][1].cover, m.cover, 'nouvelle fenêtre : pochette complète');
  S.sendMedia([a], { ...m, cover: 'data:image/png;base64,BBB' });
  assert.equal(a.sent[2][1].cover, 'data:image/png;base64,BBB');
  assert.equal(a.sent[2][1].coverKept, undefined);
});

test('full : envoi complet (page rechargée), sans pochette : rien de gardé', () => {
  const a = fakeWin();
  const m = { cover: 'data:x' };
  S.sendMedia([a], m);
  S.sendMedia([a], m, { full: true });
  assert.equal(a.sent[1][1].cover, 'data:x');
  S.sendMedia([a], { cover: null });
  S.sendMedia([a], { cover: null });
  assert.equal(a.sent[3][1].coverKept, undefined);
});

test('fenêtre fermée : ignorée', () => {
  const dead = { isDestroyed: () => true, webContents: { send: () => assert.fail('envoi à une fenêtre fermée') } };
  assert.doesNotThrow(() => S.sendMedia([dead, null], { cover: 'x' }));
});
