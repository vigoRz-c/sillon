const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  style: 'bars',          // bars | mirror | ring | wave | aurora
  theme: 'wallpaper',     // wallpaper | album | neon | sunset | ocean | spotify | mono
  mode: 'wallpaper',      // wallpaper | top | normal
  layout: 'scene',        // scene (disque, paroles, panneau) | strip (bandeau)
  showLyrics: true,
  showPanel: true,
  sceneHidden: false,     // masquée par le bouton du panneau, réaffichée depuis l'icône
  sceneScreen: 'primary', // primary | secondary
  gameMode: true,         // s'arrêter pendant un jeu / une vidéo en plein écran
  dimOnPause: true,       // scène atténuée quand la musique est en pause
  sleepAfter: 5,          // minutes sans musique avant de masquer la scène (0 = jamais)
  lyricsOffsets: {},      // décalage des paroles par morceau ("artiste|titre" -> secondes)
  discIntensity: 1.3,     // halo et rayons du disque (0,5 à 2)
  discX: 0.6,             // position du disque (fraction de l'écran)
  discY: 0.45,
  discSize: 1,            // taille du disque (0,6 à 1,6)
  discRays: 'fine',       // rayons du disque : fine (fins, serrés) | bold (épais, espacés)
  discColors: 'album',    // couleurs du disque : album (pochette) | violet | neon | sunset | ocean | spotify | mono
  discBloom: 0.8,         // lueur au centre du disque (0 à 1,5)
  edgeGlow: 0.8,          // bord de l'écran lumineux qui pulse (0 = aucun, jusqu'à 2)
  panelRing: true,        // anneaux qui vibrent autour de la pochette du panneau
  showClock: true,        // horloge en haut à droite de la scène
  veilleDelay: 5,         // minutes d'inactivité avant l'écran de veille (0 = jamais)
  veilleOnlyPlaying: true, // seulement quand de la musique joue
  veilleLock: true,       // verrouiller la session (comme Windows + L) en sortant
  spotifyCustomClientId: false, // false : app Spotify intégrée à Sillon ; true : la sienne
  spotifyClientId: '',    // Client ID de sa propre app Spotify (si spotifyCustomClientId)
  bounds: null,           // { x, y, width, height } en DIP, null = placement par défaut
  showNowPlaying: true,
  opacity: 1,
  sensitivity: 1,
  audioSource: 'app',     // son analysé : app (seulement le lecteur suivi) | system (tout le PC)
  fps: 30,               // images par seconde (30 : bien plus léger, 60 : plus fluide)
  preferApp: 'spotify',   // session média préférée ('' = celle que Windows met en avant)
  launchAtLogin: false,
  autoUpdate: true,       // chercher et installer les nouvelles versions (version installée)
};

class Settings {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    this.data = { ...DEFAULTS };
    try {
      Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch { /* premier lancement */ }
    // 0.1.5 : 30 images par seconde par défaut (60 était enregistré pour tout
    // le monde, choisi ou non). Une seule fois : qui remet 60 le garde.
    if (!this.data.fps30) {
      if (this.data.fps === 60) this.data.fps = 30;
      this.set({ fps30: true });
    }
  }
  get(key) { return key ? this.data[key] : { ...this.data }; }
  set(patch) {
    Object.assign(this.data, patch);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (e) { console.error('Sauvegarde des réglages impossible :', e); }
    return this.get();
  }
}

module.exports = { Settings, DEFAULTS };
