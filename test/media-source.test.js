// WindowsMediaSource with a fake process: helper protocol,
// command filtering, EPIPE, restart with a growing delay.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { WindowsMediaSource, HELPER_PROTOCOL } = require('../src/main/media/media');

function fakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = Object.assign(new EventEmitter(), {
    writable: true,
    written: [],
    write(s) {
      this.written.push(s);
      return true;
    },
    end() {
      this.writable = false;
    },
  });
  proc.killed = false;
  proc.kill = () => {
    proc.killed = true;
  };
  proc.say = async (obj) => {
    proc.stdout.write((typeof obj === 'string' ? obj : JSON.stringify(obj)) + '\n');
    await new Promise((r) => setImmediate(r)); // lets readline deliver the line
  };
  return proc;
}

function setup(opts = {}) {
  const procs = [];
  const notes = [];
  const src = new WindowsMediaSource({
    spawnFn: () => {
      const p = fakeProc();
      procs.push(p);
      return p;
    },
    note: (kind, text) => notes.push(`${kind}: ${text}`),
    ...opts,
  });
  const errors = [];
  src.on('error', (e) => errors.push(e.message));
  const medias = [];
  src.on('media', (m) => medias.push(m));
  src.start();
  return { src, procs, notes, errors, medias };
}

const PLAYING = { type: 'media', active: true, status: 'Playing', title: 'A', artist: 'X', newTrack: true };

test('non-JSON line ignored, logged only the first times', async () => {
  const { src, procs, notes, medias } = setup();
  for (let i = 0; i < 10; i++) await procs[0].say(`bruit ${i}`);
  await procs[0].say(PLAYING);
  assert.equal(notes.filter((n) => n.includes('illisible')).length, 3);
  assert.equal(medias.length, 1);
  src.stop();
});

test('ready: sends prefer (and the targeted player), up-to-date protocol without a warning', async () => {
  const { src, procs, notes } = setup({ prefer: 'spotify' });
  src.volumeExe = 'spotify.exe';
  await procs[0].say({ type: 'ready', protocol: HELPER_PROTOCOL });
  assert.deepEqual(procs[0].stdin.written, ['prefer:spotify\n', 'volume-target:spotify.exe\n']);
  assert.ok(!notes.some((n) => n.includes('outdated')));
  src.stop();
});

test('ready without a protocol or with another one: "outdated helper" (without blocking)', async () => {
  const a = setup();
  await a.procs[0].say({ type: 'ready' });
  assert.ok(a.notes.some((n) => n.includes('outdated helper: run npm run build:helper again')));
  assert.equal(a.procs[0].stdin.written.length, 1);
  a.src.stop();
  const b = setup();
  await b.procs[0].say({ type: 'ready', protocol: 99 });
  assert.ok(b.notes.some((n) => n.includes('outdated helper')));
  b.src.stop();
});

test('command: allow list, boolean returned', () => {
  const { src, procs, notes } = setup();
  const ok = ['playpause', 'play', 'pause', 'next', 'previous', 'shuffle', 'repeat', 'volume:40', 'prefer:spotify'];
  for (const c of ok) assert.equal(src.command(c), true, c);
  assert.equal(src.command('volume-target:spotify.exe'), true);
  assert.equal(src.command('format c:'), false);
  assert.equal(src.command(''), false);
  assert.equal(src.command(null), false);
  assert.equal(src.command('NEXT'), false);
  assert.equal(procs[0].stdin.written.length, 10);
  assert.ok(notes.some((n) => n.includes('command refused')));
  src.stop();
});

test('command: line breaks are removed from the values (no injection)', () => {
  const { src, procs } = setup();
  assert.equal(src.command('prefer:abc\nnext\r\nquit'), true);
  assert.deepEqual(procs[0].stdin.written, ['prefer:abcnextquit\n']);
  assert.equal(src.command('\nnext'), true); // becomes "next": still a known command
  assert.equal(procs[0].stdin.written[1], 'next\n');
  src.stop();
});

test('command: without a helper, the lost command is logged', () => {
  const { src, procs, notes } = setup();
  procs[0].stdin.writable = false;
  assert.equal(src.command('next'), false);
  assert.ok(notes.some((n) => n.includes('commande perdue')));
  src.stop();
});

test('EPIPE on stdin: no unhandled exception', () => {
  const { src, procs, notes } = setup();
  const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
  assert.doesNotThrow(() => procs[0].stdin.emit('error', epipe));
  assert.ok(notes.some((n) => n.includes('EPIPE')));
  src.stop();
});

test('death of the helper: error, code and signal noted, inactive state emitted', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const { src, procs, notes, errors, medias } = setup();
  await procs[0].say(PLAYING);
  assert.equal(medias.at(-1).active, true);
  procs[0].emit('exit', 3, null);
  assert.ok(notes.some((n) => n.includes('code 3')));
  assert.equal(errors.length, 1);
  assert.equal(medias.at(-1).active, false);
  assert.equal(src.proc, null);
  src.stop();
});

test('restart: delay 1 s, 2 s, 4 s as long as the helper crashes quickly', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const { src, procs } = setup();
  procs[0].emit('exit', 1, null);
  t.mock.timers.tick(999);
  assert.equal(procs.length, 1);
  t.mock.timers.tick(1);
  assert.equal(procs.length, 2);
  procs[1].emit('exit', 1, null);
  t.mock.timers.tick(1999);
  assert.equal(procs.length, 2);
  t.mock.timers.tick(1);
  assert.equal(procs.length, 3);
  procs[2].emit('exit', 1, null);
  t.mock.timers.tick(3999);
  assert.equal(procs.length, 3);
  t.mock.timers.tick(1);
  assert.equal(procs.length, 4);
  src.stop();
});

test('ready no longer clears the counter: only stable operation (10 s) does', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const { src, procs } = setup();
  procs[0].emit('exit', 1, null);
  t.mock.timers.tick(1000);
  await procs[1].say({ type: 'ready', protocol: 1 });
  procs[1].emit('exit', 1, null); // crashes right after ready: the delay must double
  t.mock.timers.tick(1999);
  assert.equal(procs.length, 2);
  t.mock.timers.tick(1);
  assert.equal(procs.length, 3);
  t.mock.timers.tick(10_000); // stable
  procs[2].emit('exit', 0, null);
  t.mock.timers.tick(1000); // back to 1 s
  assert.equal(procs.length, 4);
  src.stop();
});

test('failed launch (error event): same restart, only once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const { src, procs, errors } = setup();
  procs[0].emit('error', new Error('ENOENT'));
  procs[0].emit('exit', null, null);
  assert.equal(errors.length, 1);
  t.mock.timers.tick(1000);
  assert.equal(procs.length, 2);
  src.stop();
});

test('stop: no more restart', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const { src, procs } = setup();
  procs[0].emit('exit', 1, null);
  src.stop();
  t.mock.timers.tick(60_000);
  assert.equal(procs.length, 1);
});

test('playback command lost during the restart: replayed on "ready" if it is less than 5 s old', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const { src, procs } = setup();
  await procs[0].say({ type: 'ready', protocol: HELPER_PROTOCOL });
  procs[0].emit('exit', 1, null); // the helper goes down
  assert.equal(src.command('play'), false); // during the restart: lost
  t.mock.timers.tick(1000); // restarted
  assert.equal(procs.length, 2);
  t.mock.timers.tick(2000);
  await procs[1].say({ type: 'ready', protocol: HELPER_PROTOCOL });
  assert.ok(procs[1].stdin.written.includes('play\n'));
  src.stop();
});

test('command lost more than 5 s ago or not a playback one: not replayed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const { src, procs } = setup();
  procs[0].emit('exit', 1, null);
  src.command('next');
  src.command('volume:30'); // not a playback command
  t.mock.timers.tick(6000);
  await procs[1].say({ type: 'ready', protocol: HELPER_PROTOCOL });
  assert.ok(!procs[1].stdin.written.includes('next\n'));
  assert.ok(!procs[1].stdin.written.includes('volume:30\n'));
  src.stop();
});
