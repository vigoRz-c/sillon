const test = require('node:test');
const assert = require('node:assert');
const { retryDelay, createPcmAssembler, appendCapped } = require('../src/main/audio/audio-utils');
const { isAsleep } = require('../src/main/app/rest');

test('retryDelay : 3 s, 30 s puis 60 s', () => {
  assert.deepStrictEqual([1, 2, 3, 4, 50].map(retryDelay), [3000, 30000, 60000, 60000, 60000]);
  assert.strictEqual(retryDelay(0), 3000);
  assert.strictEqual(retryDelay(NaN), 3000);
});

test('PCM : un morceau impair garde son octet pour le suivant', () => {
  const a = createPcmAssembler();
  const out1 = a.push(Buffer.from([1, 2, 3]));
  assert.deepStrictEqual([...out1], [1, 2]);
  const out2 = a.push(Buffer.from([4, 5, 6, 7]));
  assert.deepStrictEqual([...out2], [3, 4, 5, 6]);
  const out3 = a.push(Buffer.from([8]));
  assert.deepStrictEqual([...out3], [7, 8]);
});

test('PCM : toujours une longueur paire, aucun octet perdu', () => {
  const a = createPcmAssembler();
  const input = Buffer.from(Array.from({ length: 101 }, (_, i) => i));
  const got = [];
  for (let i = 0; i < input.length;) {
    const n = 1 + ((i * 7) % 5);
    const out = a.push(input.subarray(i, i + n));
    assert.strictEqual(out.length % 2, 0);
    got.push(...out);
    i += n;
  }
  assert.deepStrictEqual(got, [...input.subarray(0, 100)]);
  assert.strictEqual(a.push(Buffer.alloc(0)).length, 0);
  a.reset();
  assert.deepStrictEqual([...a.push(Buffer.from([9, 9]))], [9, 9]);
});

test('appendCapped : plafonne en gardant la fin', () => {
  assert.strictEqual(appendCapped('abc', 'de', 10), 'abcde');
  assert.strictEqual(appendCapped('abc', 'defg', 5), 'cdefg');
});

test('isAsleep : après N minutes sans musique', () => {
  const base = { silentSince: 0, minutes: 5 };
  assert.strictEqual(isAsleep({ ...base, playing: true, now: 1e9 }), false);
  assert.strictEqual(isAsleep({ ...base, playing: false, now: 4 * 60000 }), false);
  assert.strictEqual(isAsleep({ ...base, playing: false, now: 5 * 60000 + 1 }), true);
  assert.strictEqual(isAsleep({ ...base, minutes: 0, playing: false, now: 1e9 }), false);
});
