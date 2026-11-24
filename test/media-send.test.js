// state.js sendMedia: the (heavy) cover is only sent once per
// window as long as it does not change; a reloaded page receives it in full.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/main/app/state');

function fakeWin() {
  const sent = [];
  return { sent, isDestroyed: () => false, webContents: { send: (ch, d) => sent.push([ch, d]) } };
}

test('cover sent once, then "coverKept" as long as it does not change', () => {
  const a = fakeWin();
  const b = fakeWin();
  const m = { title: 'T', cover: 'data:image/png;base64,AAA' };
  S.sendMedia([a], m);
  S.sendMedia([a, b], { ...m, volume: 40 });
  assert.equal(a.sent[0][1].cover, m.cover);
  assert.equal(a.sent[1][1].cover, undefined);
  assert.equal(a.sent[1][1].coverKept, true);
  assert.equal(a.sent[1][1].volume, 40);
  assert.equal(b.sent[0][1].cover, m.cover, 'new window: complete cover');
  S.sendMedia([a], { ...m, cover: 'data:image/png;base64,BBB' });
  assert.equal(a.sent[2][1].cover, 'data:image/png;base64,BBB');
  assert.equal(a.sent[2][1].coverKept, undefined);
});

test('full: complete send (reloaded page), without a cover: nothing kept', () => {
  const a = fakeWin();
  const m = { cover: 'data:x' };
  S.sendMedia([a], m);
  S.sendMedia([a], m, { full: true });
  assert.equal(a.sent[1][1].cover, 'data:x');
  S.sendMedia([a], { cover: null });
  S.sendMedia([a], { cover: null });
  assert.equal(a.sent[3][1].coverKept, undefined);
});

test('closed window: ignored', () => {
  const dead = { isDestroyed: () => true, webContents: { send: () => assert.fail('sent to a closed window') } };
  assert.doesNotThrow(() => S.sendMedia([dead, null], { cover: 'x' }));
});
