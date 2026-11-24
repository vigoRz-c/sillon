// Mapping between the Windows media session and the program to listen to.
//
// Module with no dependency on Electron: the logic is tested separately.

// Windows media session (AppUserModelId) -> program to listen to.
const KNOWN = [
  [/spotify/i, 'Spotify.exe'],
  [/msedge/i, 'msedge.exe'],
  [/chrome/i, 'chrome.exe'],
  [/firefox|308046B0AF4A39CB/i, 'firefox.exe'],
  [/brave/i, 'brave.exe'],
  [/opera/i, 'opera.exe'],
  [/vivaldi/i, 'vivaldi.exe'],
  [/vlc/i, 'vlc.exe'],
  [/deezer/i, 'Deezer.exe'],
  [/foobar/i, 'foobar2000.exe'],
  [/aimp/i, 'AIMP.exe'],
];

function exeForApp(appId) {
  if (!appId || typeof appId !== 'string') return null;
  for (const [re, exe] of KNOWN) if (re.test(appId)) return exe;
  const m = /([\w.\- ]+\.exe)$/i.exec(appId); // some apps give their .exe
  return m ? m[1] : null;
}

module.exports = { KNOWN, exeForApp };
