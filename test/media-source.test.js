// WindowsMediaSource avec un faux processus : protocole de l'assistant,
// filtrage des commandes, EPIPE, redémarrage avec délai croissant.
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
    await new Promise((r) => setImmediate(r)); // laisse readline livrer la ligne
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

test('ligne non JSON ignorée, journalisée seulement les premières fois', async () => {
  const { src, procs, notes, medias } = setup();
  for (let i = 0; i < 10; i++) await procs[0].say(`bruit ${i}`);
  await procs[0].say(PLAYING);
  assert.equal(notes.filter((n) => n.includes('illisible')).length, 3);
  assert.equal(medias.length, 1);
  src.stop();
});

test('ready : envoie prefer (et le lecteur ciblé), protocole à jour sans avertissement', async () => {
  const { src, procs, notes } = setup({ prefer: 'spotify' });
  src.volumeExe = 'spotify.exe';
  await procs[0].say({ type: 'ready', protocol: HELPER_PROTOCOL });
  assert.deepEqual(procs[0].stdin.written, ['prefer:spotify\n', 'volume-target:spotify.exe\n']);
  assert.ok(!notes.some((n) => n.includes('périmé')));
  src.stop();
});

test('ready sans protocole ou avec un autre : « assistant périmé » (sans bloquer)', async () => {
  const a = setup();
  await a.procs[0].say({ type: 'ready' });
  assert.ok(a.notes.some((n) => n.includes('assistant périmé : relancer npm run build:helper')));
  assert.equal(a.procs[0].stdin.written.length, 1);
  a.src.stop();
  const b = setup();
  await b.procs[0].say({ type: 'ready', protocol: 99 });
  assert.ok(b.notes.some((n) => n.includes('assistant périmé')));
  b.src.stop();
});

test('command : liste blanche, booléen renvoyé', () => {
  const { src, procs, notes } = setup();
  const ok = ['playpause', 'play', 'pause', 'next', 'previous', 'shuffle', 'repeat', 'volume:40', 'prefer:spotify'];
  for (const c of ok) assert.equal(src.command(c), true, c);
  assert.equal(src.command('volume-target:spotify.exe'), true);
  assert.equal(src.command('format c:'), false);
  assert.equal(src.command(''), false);
  assert.equal(src.command(null), false);
  assert.equal(src.command('NEXT'), false);
  assert.equal(procs[0].stdin.written.length, 10);
  assert.ok(notes.some((n) => n.includes('commande refusée')));
  src.stop();
});

test('command : les sauts de ligne sont retirés des valeurs (pas d’injection)', () => {
  const { src, procs } = setup();
  assert.equal(src.command('prefer:abc\nnext\r\nquit'), true);
  assert.deepEqual(procs[0].stdin.written, ['prefer:abcnextquit\n']);
  assert.equal(src.command('\nnext'), true); // devient « next » : reste une commande connue
  assert.equal(procs[0].stdin.written[1], 'next\n');
  src.stop();
});

test('command : sans assistant, la commande perdue est journalisée', () => {
  const { src, procs, notes } = setup();
  procs[0].stdin.writable = false;
  assert.equal(src.command('next'), false);
  assert.ok(notes.some((n) => n.includes('commande perdue')));
  src.stop();
});

test('EPIPE sur stdin : aucune exception non gérée', () => {
  const { src, procs, notes } = setup();
  const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
  assert.doesNotThrow(() => procs[0].stdin.emit('error', epipe));
  assert.ok(notes.some((n) => n.includes('EPIPE')));
  src.stop();
});

test('mort de l’assistant : erreur, code et signal notés, état inactif émis', async (t) => {
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

test('redémarrage : délai 1 s, 2 s, 4 s tant que l’assistant plante vite', (t) => {
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

test('ready n’efface plus le compteur : seul un fonctionnement stable (10 s) le fait', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const { src, procs } = setup();
  procs[0].emit('exit', 1, null);
  t.mock.timers.tick(1000);
  await procs[1].say({ type: 'ready', protocol: 1 });
  procs[1].emit('exit', 1, null); // plante juste après ready : le délai doit doubler
  t.mock.timers.tick(1999);
  assert.equal(procs.length, 2);
  t.mock.timers.tick(1);
  assert.equal(procs.length, 3);
  t.mock.timers.tick(10_000); // stable
  procs[2].emit('exit', 0, null);
  t.mock.timers.tick(1000); // retour à 1 s
  assert.equal(procs.length, 4);
  src.stop();
});

test('échec de lancement (événement error) : même redémarrage, une seule fois', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const { src, procs, errors } = setup();
  procs[0].emit('error', new Error('ENOENT'));
  procs[0].emit('exit', null, null);
  assert.equal(errors.length, 1);
  t.mock.timers.tick(1000);
  assert.equal(procs.length, 2);
  src.stop();
});

test('stop : plus de redémarrage', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const { src, procs } = setup();
  procs[0].emit('exit', 1, null);
  src.stop();
  t.mock.timers.tick(60_000);
  assert.equal(procs.length, 1);
});
