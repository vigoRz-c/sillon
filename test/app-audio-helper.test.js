// Choice of the audio source: exit codes of the capture helper
// (2 = Windows cannot, 3/4 = player missing). Simulated helper and clock.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const root = path.join(__dirname, '..', 'src', 'main');
const diagPath = path.join(root, 'app', 'diagnostic.js');
require.cache[diagPath] = {
  id: diagPath,
  filename: diagPath,
  loaded: true,
  exports: { note: () => {} },
};

const spawned = [];
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'child_process') {
    return {
      spawn: (_exe, args) => {
        const p = new EventEmitter();
        p.stdout = new PassThrough();
        p.stderr = new PassThrough();
        p.kill = () => {};
        p.args = args;
        spawned.push(p);
        return p;
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};
const S = require('../src/main/app/state');
const appAudio = require('../src/main/audio/app-audio');
Module._load = realLoad;

function fakeWindow() {
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    once() {},
    on() {},
    webContents: { executeJavaScript: () => Promise.resolve(), send() {} },
  };
}

const spotify = { active: true, app: 'Spotify.exe', status: 'Playing' };
const chrome = { active: true, app: 'Chrome', status: 'Playing' };

// The module keeps its state: each test changes player to start again from zero.
let seq = 0;
function setup(t, media) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  S.settings = { get: (k) => (k === 'audioSource' ? 'app' : k === 'preferApp' ? 'spotify' : null) };
  S.lastMedia = { active: false };
  appAudio.onMedia({ active: false, app: `reset${seq++}` }); // starts again without delay
  S.lastMedia = media;
  spawned.length = 0;
  const win = fakeWindow();
  appAudio.startAudio(win);
  appAudio.onMedia(media);
  t.after(() => appAudio.stop());
  return win;
}

const exitWith = (code) => spawned.at(-1).emit('exit', code);

test('a single code 2: no final switch, new attempt', (t) => {
  setup(t, spotify);
  assert.equal(spawned.length, 1);
  exitWith(2);
  assert.equal(appAudio.status().unsupported, false);
  assert.equal(appAudio.status().mode, 'app');
  t.mock.timers.tick(3000);
  assert.equal(spawned.length, 2); // restarted
});

test('three codes 2 in a row: all the PC sound', (t) => {
  setup(t, spotify);
  for (let i = 0; i < 3; i++) {
    exitWith(2);
    t.mock.timers.tick(60000);
  }
  assert.equal(appAudio.status().unsupported, true);
  assert.equal(appAudio.status().mode, 'system');
});

test('sound received resets the code 2 counter', (t) => {
  setup(t, spotify);
  exitWith(2);
  exitWith(2); // no effect: no followed process any more
  t.mock.timers.tick(60000);
  spawned.at(-1).stdout.emit('data', Buffer.from([1, 0]));
  assert.equal(appAudio.status().unsupportedCodes, 0);
});

test('player changed: "not supported" lifted', (t) => {
  setup(t, spotify);
  for (let i = 0; i < 3; i++) {
    exitWith(2);
    t.mock.timers.tick(60000);
  }
  assert.equal(appAudio.status().unsupported, true);
  appAudio.onMedia(chrome);
  assert.equal(appAudio.status().unsupported, false);
  assert.equal(appAudio.status().mode, 'app');
});

test('5 codes 4 in a row with the player announced active: all the PC sound', (t) => {
  setup(t, spotify);
  for (let i = 0; i < 4; i++) {
    exitWith(4);
    t.mock.timers.tick(3000);
    assert.equal(appAudio.status().mode, 'app');
  }
  exitWith(4);
  assert.equal(appAudio.status().mode, 'system');
  assert.match(appAudio.status().reason, /not found/);
  // Jusqu'au prochain changement de lecteur.
  appAudio.onMedia(chrome);
  assert.equal(appAudio.status().mode, 'app');
});
