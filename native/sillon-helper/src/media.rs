//! Morceau en cours (contrôles média de Windows, SMTC) et volume du lecteur.
//!
//! Même source que le panneau média de Windows : Spotify, un onglet YouTube,
//! VLC… sans compte ni API. Envoie un événement JSON par changement.

use std::io::{BufRead, Write};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::{json, Value};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionMediaProperties as Props,
};
use windows::Media::MediaPlaybackAutoRepeatMode;
use windows::Storage::Streams::DataReader;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

fn emit(v: Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{v}");
    let _ = out.flush();
}

/// Intervalle entre deux dates Windows (100 ns) en secondes, arrondi au dixième.
fn secs(ticks: i64) -> f64 {
    (ticks as f64 / 1e6).round() / 10.0
}

fn status_name(s: Session) -> String {
    let Ok(info) = s.GetPlaybackInfo() else {
        return String::new();
    };
    let st = info.PlaybackStatus().map(|x| x.0).unwrap_or(-1);
    match st {
        0 => "Closed",
        1 => "Opened",
        2 => "Changing",
        3 => "Stopped",
        4 => "Playing",
        5 => "Paused",
        _ => "",
    }
    .to_string()
}

fn repeat_name(m: MediaPlaybackAutoRepeatMode) -> &'static str {
    match m {
        MediaPlaybackAutoRepeatMode::Track => "Track",
        MediaPlaybackAutoRepeatMode::List => "List",
        _ => "None",
    }
}

fn shuffle_of(s: &Session) -> bool {
    s.GetPlaybackInfo()
        .and_then(|i| i.IsShuffleActive())
        .and_then(|r| r.Value())
        .unwrap_or(false)
}

fn repeat_of(s: &Session) -> MediaPlaybackAutoRepeatMode {
    s.GetPlaybackInfo()
        .and_then(|i| i.AutoRepeatMode())
        .and_then(|r| r.Value())
        .unwrap_or(MediaPlaybackAutoRepeatMode::None)
}

/// Pochette en « data URL », ou None.
fn read_cover(props: &Props) -> Option<String> {
    let thumb = props.Thumbnail().ok()?;
    let stream = thumb.OpenReadAsync().ok()?.join().ok()?;
    let size = stream.Size().ok()? as u32;
    if size == 0 {
        return None;
    }
    let mime = stream.ContentType().map(|h| h.to_string()).unwrap_or_default();
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    reader.LoadAsync(size).ok()?.join().ok()?;
    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf).ok()?;
    let mime = if mime.is_empty() { "image/png".to_string() } else { mime };
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(buf)
    ))
}

struct State {
    manager: Manager,
    prefer: String,
    last_key: String,
    last_state: String,
    last_cover: Option<String>,
    cover_checks: Vec<Instant>,
    volume_exe: String,
    volume_wanted: Option<i32>,
    last_volume: Option<i32>,
    last_volume_read: Option<Instant>,
}

impl State {
    /// Session préférée (ex. Spotify), sinon celle que Windows met en avant.
    fn session(&self) -> Option<Session> {
        if !self.prefer.is_empty() {
            if let Ok(list) = self.manager.GetSessions() {
                for s in list {
                    let id = s
                        .SourceAppUserModelId()
                        .map(|h| h.to_string().to_lowercase())
                        .unwrap_or_default();
                    if id.contains(&self.prefer) {
                        return Some(s);
                    }
                }
            }
        }
        self.manager.GetCurrentSession().ok()
    }

    fn command(&mut self, cmd: &str) {
        if let Some(p) = cmd.strip_prefix("prefer:") {
            self.prefer = p.trim().to_lowercase();
            self.last_key.clear();
            return;
        }
        // Volume : on ne garde que la dernière valeur demandée (glissement continu).
        if let Some(exe) = cmd.strip_prefix("volume-target:") {
            self.volume_exe = exe.trim().to_string();
            self.last_volume = None;
            self.last_volume_read = None;
            return;
        }
        if let Some(v) = cmd.strip_prefix("volume:") {
            if let Ok(v) = v.trim().parse::<i32>() {
                self.volume_wanted = Some(v);
            }
            return;
        }
        let Some(s) = self.session() else {
            emit(json!({ "type": "cmd", "cmd": cmd, "ok": false, "reason": "aucune session média" }));
            return;
        };
        // Réponse de Windows (pour le diagnostic) : vrai = acceptée par le lecteur.
        let op = match cmd {
            "playpause" => s.TryTogglePlayPauseAsync(),
            "play" => s.TryPlayAsync(),
            "pause" => s.TryPauseAsync(),
            "next" => s.TrySkipNextAsync(),
            "previous" => s.TrySkipPreviousAsync(),
            "shuffle" => s.TryChangeShuffleActiveAsync(!shuffle_of(&s)),
            "repeat" => {
                // Aucune -> playlist -> morceau -> aucune
                let next = match repeat_of(&s) {
                    MediaPlaybackAutoRepeatMode::List => MediaPlaybackAutoRepeatMode::Track,
                    MediaPlaybackAutoRepeatMode::Track => MediaPlaybackAutoRepeatMode::None,
                    _ => MediaPlaybackAutoRepeatMode::List,
                };
                s.TryChangeAutoRepeatModeAsync(next)
            }
            _ => return,
        };
        let ok = op.and_then(|o| o.join()).unwrap_or(false);
        let app = s.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default();
        emit(json!({ "type": "cmd", "cmd": cmd, "ok": ok, "app": app }));
    }

    /// Volume du lecteur : appliqué tout de suite, relu chaque seconde.
    fn volume(&mut self) {
        if self.volume_exe.is_empty() {
            return;
        }
        if let Some(v) = self.volume_wanted.take() {
            let now = if crate::volume::set(&self.volume_exe, v) { v } else { -1 };
            self.last_volume = Some(now);
            self.last_volume_read = Some(Instant::now());
            emit(json!({ "type": "volume", "exe": self.volume_exe, "volume": now }));
        } else if self
            .last_volume_read
            .is_none_or(|t| t.elapsed() >= Duration::from_secs(1))
        {
            self.last_volume_read = Some(Instant::now());
            let v = crate::volume::get(&self.volume_exe);
            if self.last_volume != Some(v) {
                self.last_volume = Some(v);
                emit(json!({ "type": "volume", "exe": self.volume_exe, "volume": v }));
            }
        }
    }

    fn poll(&mut self) {
        let Some(s) = self.session() else {
            if self.last_key != "<none>" {
                emit(json!({ "type": "media", "active": false }));
                self.last_key = "<none>".into();
                self.last_state.clear();
            }
            return;
        };
        let Ok(props) = s.TryGetMediaPropertiesAsync().and_then(|o| o.join()) else {
            return;
        };
        let app = s.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default();
        let title = props.Title().map(|h| h.to_string()).unwrap_or_default();
        let artist = props.Artist().map(|h| h.to_string()).unwrap_or_default();
        let album = props.AlbumTitle().map(|h| h.to_string()).unwrap_or_default();
        let key = format!("{app}|{title}|{artist}");
        let status = status_name(s.clone());
        let (pos, dur, updated) = match s.GetTimelineProperties() {
            Ok(tl) => {
                let p = tl.Position().map(|t| t.Duration).unwrap_or(0);
                let a = tl.StartTime().map(|t| t.Duration).unwrap_or(0);
                let b = tl.EndTime().map(|t| t.Duration).unwrap_or(0);
                // Date Windows (100 ns depuis 1601) -> millisecondes Unix.
                let u = tl
                    .LastUpdatedTime()
                    .map(|d| (d.UniversalTime - 116_444_736_000_000_000) / 10_000)
                    .unwrap_or(0);
                (secs(p), secs(b - a), u)
            }
            Err(_) => (0.0, 0.0, 0),
        };
        let shuffle = shuffle_of(&s);
        let repeat = repeat_name(repeat_of(&s));
        let state = format!("{status}|{pos}|{dur}|{shuffle}|{repeat}");

        let track_changed = key != self.last_key;
        let mut cover_changed = false;
        if track_changed {
            self.last_cover = read_cover(&props);
            // Spotify publie le nouveau titre avant la nouvelle pochette : la
            // première lecture renvoie souvent l'image du morceau précédent.
            // On relit la pochette plusieurs fois dans les secondes qui suivent.
            let now = Instant::now();
            self.cover_checks = [700, 1500, 3000, 6000, 12000]
                .iter()
                .map(|ms| now + Duration::from_millis(*ms))
                .collect();
        } else if self.cover_checks.first().is_some_and(|t| Instant::now() >= *t) {
            self.cover_checks.remove(0);
            if let Some(fresh) = read_cover(&props) {
                if Some(&fresh) != self.last_cover.as_ref() {
                    self.last_cover = Some(fresh);
                    cover_changed = true;
                }
            }
        }

        if track_changed || cover_changed || state != self.last_state {
            let mut msg = json!({
                "type": "media", "active": true, "app": app, "title": title, "artist": artist,
                "album": album, "status": status, "shuffle": shuffle, "repeat": repeat,
                "position": pos, "duration": dur, "updated": updated,
            });
            if track_changed {
                msg["cover"] = json!(self.last_cover);
                msg["newTrack"] = json!(true);
            } else if cover_changed {
                msg["cover"] = json!(self.last_cover);
                msg["coverUpdate"] = json!(true);
            }
            emit(msg);
            self.last_key = key;
            self.last_state = state;
        }
    }
}

pub fn run() -> i32 {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let manager = match Manager::RequestAsync().and_then(|o| o.join()) {
        Ok(m) => m,
        Err(e) => {
            emit(json!({ "type": "error", "message": format!("SMTC indisponible : {}", e.message()) }));
            return 1;
        }
    };

    // Commandes lues sur un autre fil : la boucle n'attend jamais l'entrée.
    let (tx, rx) = mpsc::channel::<Option<String>>();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            match line {
                Ok(l) => {
                    if tx.send(Some(l)).is_err() {
                        return;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = tx.send(None); // Sillon est parti
    });

    let mut st = State {
        manager,
        prefer: "spotify".into(),
        last_key: String::new(),
        last_state: String::new(),
        last_cover: None,
        cover_checks: Vec::new(),
        volume_exe: String::new(),
        volume_wanted: None,
        last_volume: None,
        last_volume_read: None,
    };
    emit(json!({ "type": "ready" }));

    const POLL: Duration = Duration::from_millis(400);
    let mut last_poll: Option<Instant> = None;
    loop {
        // Toutes les commandes en attente.
        loop {
            match rx.try_recv() {
                Ok(Some(line)) => st.command(line.trim()),
                Ok(None) | Err(mpsc::TryRecvError::Disconnected) => return 0,
                Err(mpsc::TryRecvError::Empty) => break,
            }
        }
        st.volume();
        // Lecture du morceau toutes les 400 ms (pas à chaque commande reçue).
        if last_poll.is_none_or(|t| t.elapsed() >= POLL) {
            last_poll = Some(Instant::now());
            st.poll();
        }
        // Attente : une commande reçue (volume…) réveille la boucle tout de suite.
        let wait = POLL.saturating_sub(last_poll.map(|t| t.elapsed()).unwrap_or_default());
        match rx.recv_timeout(wait.max(Duration::from_millis(10))) {
            Ok(Some(line)) => st.command(line.trim()),
            Ok(None) | Err(RecvTimeoutError::Disconnected) => return 0,
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
}
