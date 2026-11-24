//! Morceau en cours (contrôles média de Windows, SMTC) et volume du lecteur.
//!
//! Même source que le panneau média de Windows : Spotify, un onglet YouTube,
//! VLC… sans compte ni API. Envoie un événement JSON par changement.
//!
//! Les changements sont signalés par les événements SMTC (session courante,
//! propriétés, état de lecture, chronologie) ; un sondage lent (2 s) sert de
//! filet de sécurité. Tous les appels WinRT asynchrones ont un délai maximal.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, SyncSender};
use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::{json, Value};
use windows::core::{IUnknown, Interface, RuntimeType};
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    CurrentSessionChangedEventArgs, GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionMediaProperties as Props, MediaPropertiesChangedEventArgs,
    PlaybackInfoChangedEventArgs, SessionsChangedEventArgs, TimelinePropertiesChangedEventArgs,
};
use windows::Media::MediaPlaybackAutoRepeatMode;
use windows::Storage::Streams::DataReader;
use windows_future::{AsyncStatus, IAsyncOperation};

/// Version du protocole annoncée dans le message « ready » (voir main.rs).
const PROTOCOL: u32 = 1;
/// Longueur maximale d'une ligne de commande reçue (le reste est ignoré).
const MAX_LINE: usize = 4096;
/// Taille maximale d'une pochette (au-delà, on n'en envoie pas).
const MAX_COVER: u32 = 8 * 1024 * 1024;
/// Délai maximal d'une commande (lecture, pause…) auprès du lecteur.
const CMD_TIMEOUT: Duration = Duration::from_secs(4);
/// Délai maximal de lecture des propriétés du morceau.
const PROPS_TIMEOUT: Duration = Duration::from_secs(4);
/// Délai maximal pour ouvrir et lire la pochette (par étape).
const COVER_TIMEOUT: Duration = Duration::from_secs(5);
/// Délai maximal de démarrage du gestionnaire SMTC.
const INIT_TIMEOUT: Duration = Duration::from_secs(5);
/// Sondage de secours : les événements SMTC déclenchent la lecture immédiatement.
const FALLBACK_POLL: Duration = Duration::from_secs(2);

/// Passe à vrai quand l'écriture sur stdout échoue : Sillon est parti.
static STDOUT_BROKEN: AtomicBool = AtomicBool::new(false);

fn emit(v: &Value) {
    let mut out = std::io::stdout().lock();
    if writeln!(out, "{v}").is_err() || out.flush().is_err() {
        STDOUT_BROKEN.store(true, Ordering::Relaxed);
    }
}

/// Message envoyé à la boucle principale.
enum Msg {
    /// Une ligne de commande (4 Ko au plus).
    Line(String),
    /// Fin de l'entrée : Sillon est parti.
    Eof,
    /// Erreur d'E/S sur l'entrée.
    InputError(String),
    /// Un événement SMTC demande une relecture.
    Wake,
}

/// Commande reçue de Sillon.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Cmd {
    PlayPause,
    Play,
    Pause,
    Next,
    Previous,
    Shuffle,
    Repeat,
    Prefer(String),
    VolumeTarget(String),
    Volume(i32),
}

/// Analyse une ligne de commande (sans toucher à Windows). `None` si elle est
/// vide ou inconnue ; un volume est borné à 0-100.
fn parse_command(line: &str) -> Option<Cmd> {
    let line = line.trim();
    match line {
        "playpause" => return Some(Cmd::PlayPause),
        "play" => return Some(Cmd::Play),
        "pause" => return Some(Cmd::Pause),
        "next" => return Some(Cmd::Next),
        "previous" => return Some(Cmd::Previous),
        "shuffle" => return Some(Cmd::Shuffle),
        "repeat" => return Some(Cmd::Repeat),
        _ => {}
    }
    if let Some(p) = line.strip_prefix("prefer:") {
        return Some(Cmd::Prefer(p.trim().to_lowercase()));
    }
    if let Some(exe) = line.strip_prefix("volume-target:") {
        return Some(Cmd::VolumeTarget(exe.trim().to_string()));
    }
    if let Some(v) = line.strip_prefix("volume:") {
        return v.trim().parse::<i32>().ok().map(|n| Cmd::Volume(n.clamp(0, 100)));
    }
    None
}

/// Lit une ligne (sans le `\n`) en gardant au plus `cap` octets : le reste de
/// la ligne est lu puis ignoré. `Ok(None)` à la fin de l'entrée.
fn read_line_capped<R: BufRead>(r: &mut R, cap: usize) -> std::io::Result<Option<Vec<u8>>> {
    let mut line = Vec::new();
    let mut any = false;
    loop {
        let chunk = match r.fill_buf() {
            Ok(c) => c,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        if chunk.is_empty() {
            // Fin de l'entrée : une dernière ligne sans `\n` compte quand même.
            return Ok(any.then_some(line));
        }
        any = true;
        let newline = chunk.iter().position(|&b| b == b'\n');
        let used = newline.map_or(chunk.len(), |i| i + 1);
        let data = newline.unwrap_or(chunk.len());
        let room = cap.saturating_sub(line.len());
        line.extend_from_slice(&chunk[..data.min(room)]);
        r.consume(used);
        if newline.is_some() {
            return Ok(Some(line));
        }
    }
}

/// Début d'une chaîne (en caractères), pour ne pas renvoyer 4 Ko dans un message.
fn truncate_chars(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// Attend la fin d'une opération WinRT, au plus `timeout`. Au-delà, l'opération
/// est annulée et l'attente est un échec.
fn wait<T: RuntimeType + 'static>(op: &IAsyncOperation<T>, timeout: Duration) -> Result<T, String> {
    let start = Instant::now();
    loop {
        match op.Status() {
            Ok(AsyncStatus::Started) => {}
            // Terminée, annulée ou en erreur : GetResults donne le résultat ou l'erreur.
            Ok(_) => return op.GetResults().map_err(|e| e.message()),
            Err(e) => return Err(e.message()),
        }
        if start.elapsed() >= timeout {
            let _ = op.Cancel();
            return Err("délai dépassé".to_string());
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// Intervalle (unités de 100 ns) en secondes, arrondi au dixième.
fn secs(ticks: i64) -> f64 {
    // Perte de précision sans effet : l'intervalle est ensuite arrondi au dixième.
    #[allow(clippy::cast_precision_loss)]
    {
        (ticks as f64 / 1e6).round() / 10.0
    }
}

/// Date Windows (100 ns depuis 1601) en millisecondes Unix.
fn unix_ms(universal_time: i64) -> i64 {
    (universal_time - 116_444_736_000_000_000) / 10_000
}

fn status_name(s: &Session) -> String {
    let Ok(info) = s.GetPlaybackInfo() else {
        return String::new();
    };
    let st = info.PlaybackStatus().map_or(-1, |x| x.0);
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

/// Mode suivant : aucune -> playlist -> morceau -> aucune.
fn next_repeat(m: MediaPlaybackAutoRepeatMode) -> MediaPlaybackAutoRepeatMode {
    match m {
        MediaPlaybackAutoRepeatMode::List => MediaPlaybackAutoRepeatMode::Track,
        MediaPlaybackAutoRepeatMode::Track => MediaPlaybackAutoRepeatMode::None,
        _ => MediaPlaybackAutoRepeatMode::List,
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

/// Type d'image sûr à recopier dans une « data URL » : seulement des formats
/// bitmap connus (pas de SVG, qui peut contenir du script), sinon `image/png`.
fn clean_mime(raw: &str) -> String {
    const ALLOWED: [&str; 6] = [
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/webp",
        "image/gif",
        "image/bmp",
    ];
    let m = raw.trim().to_ascii_lowercase();
    if ALLOWED.contains(&m.as_str()) {
        m
    } else {
        "image/png".to_string()
    }
}

/// Une taille de pochette acceptable (non nulle, 8 Mo au plus).
fn cover_size(size: u64) -> Option<u32> {
    u32::try_from(size).ok().filter(|&s| s > 0 && s <= MAX_COVER)
}

/// Résultat de la lecture d'une pochette.
enum CoverRead {
    /// Identique à la précédente (non ré-encodée).
    Same,
    /// Nouvelle image : empreinte et « data URL ».
    New(u64, String),
}

/// Pochette (octets bruts lus, plafonnés et délai respecté), ou None.
fn fetch_cover(props: &Props) -> Option<(String, Vec<u8>)> {
    let thumb = props.Thumbnail().ok()?;
    let stream = wait(&thumb.OpenReadAsync().ok()?, COVER_TIMEOUT).ok()?;
    let size = cover_size(stream.Size().ok()?)?;
    let mime = clean_mime(&stream.ContentType().map(|h| h.to_string()).unwrap_or_default());
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    wait(&reader.LoadAsync(size).ok()?, COVER_TIMEOUT).ok()?;
    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf).ok()?;
    Some((mime, buf))
}

/// Lit la pochette. Si son empreinte est `previous`, renvoie `Same` sans l'encoder en base64.
fn read_cover(props: &Props, previous: Option<u64>) -> Option<CoverRead> {
    let (mime, bytes) = fetch_cover(props)?;
    let mut h = DefaultHasher::new();
    mime.hash(&mut h);
    bytes.hash(&mut h);
    let hash = h.finish();
    if previous == Some(hash) {
        return Some(CoverRead::Same);
    }
    let url = format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    );
    Some(CoverRead::New(hash, url))
}

/// Abonnement aux événements d'une session (retiré à la destruction).
struct Subscription {
    session: Session,
    /// Identité de la session (voir `identity`).
    id: usize,
    tokens: [i64; 3],
}

impl Subscription {
    fn new(session: &Session, tx: &SyncSender<Msg>) -> windows::core::Result<Subscription> {
        let t1 = tx.clone();
        let props = session.MediaPropertiesChanged(
            &TypedEventHandler::<Session, MediaPropertiesChangedEventArgs>::new(move |_, _| {
                let _ = t1.try_send(Msg::Wake);
                Ok(())
            }),
        )?;
        let t2 = tx.clone();
        let playback = match session.PlaybackInfoChanged(
            &TypedEventHandler::<Session, PlaybackInfoChangedEventArgs>::new(move |_, _| {
                let _ = t2.try_send(Msg::Wake);
                Ok(())
            }),
        ) {
            Ok(t) => t,
            Err(e) => {
                // Abonnement partiel : on retire ce qui est déjà inscrit.
                let _ = session.RemoveMediaPropertiesChanged(props);
                return Err(e);
            }
        };
        let t3 = tx.clone();
        let timeline = match session.TimelinePropertiesChanged(&TypedEventHandler::<
            Session,
            TimelinePropertiesChangedEventArgs,
        >::new(move |_, _| {
            let _ = t3.try_send(Msg::Wake);
            Ok(())
        })) {
            Ok(t) => t,
            Err(e) => {
                let _ = session.RemoveMediaPropertiesChanged(props);
                let _ = session.RemovePlaybackInfoChanged(playback);
                return Err(e);
            }
        };
        Ok(Subscription {
            session: session.clone(),
            id: identity(session),
            tokens: [props, playback, timeline],
        })
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        let _ = self.session.RemoveMediaPropertiesChanged(self.tokens[0]);
        let _ = self.session.RemovePlaybackInfoChanged(self.tokens[1]);
        let _ = self.session.RemoveTimelinePropertiesChanged(self.tokens[2]);
    }
}

struct State {
    manager: Manager,
    tx: SyncSender<Msg>,
    prefer: String,
    last_key: String,
    last_signature: String,
    last_cover: Option<String>,
    last_cover_hash: Option<u64>,
    cover_checks: Vec<Instant>,
    /// Relecture immédiate demandée (changement de lecteur préféré).
    poll_now: bool,
    volume_exe: String,
    volume_wanted: Option<i32>,
    last_volume: Option<i32>,
    last_volume_read: Option<Instant>,
    /// Session dont on écoute les événements (liée à l'objet session lui-même :
    /// une même application peut en changer, Spotify relancé, autre onglet).
    events: Option<Subscription>,
}

/// Identité d'une session (adresse canonique de l'objet) ; 0 si elle est inconnue.
fn identity(s: &Session) -> usize {
    s.cast::<IUnknown>().map_or(0, |u| u.as_raw() as usize)
}

/// La session de l'application préférée passe-t-elle avant les autres ? Oui si
/// elle joue, ou si aucune autre ne joue (sinon on afficherait « en pause »
/// alors qu'un autre lecteur joue).
fn prefer_preferred(preferred_playing: bool, other_playing: bool) -> bool {
    preferred_playing || !other_playing
}

fn is_playing(s: &Session) -> bool {
    status_name(s) == "Playing"
}

impl State {
    /// Session préférée (ex. Spotify), sinon celle que Windows met en avant.
    fn session(&self) -> Option<Session> {
        if !self.prefer.is_empty() {
            if let Ok(list) = self.manager.GetSessions() {
                let mut preferred = None;
                let mut other_playing = None;
                for s in list {
                    let id = s
                        .SourceAppUserModelId()
                        .map(|h| h.to_string().to_lowercase())
                        .unwrap_or_default();
                    if preferred.is_none() && id.contains(&self.prefer) {
                        preferred = Some(s);
                    } else if other_playing.is_none() && is_playing(&s) {
                        other_playing = Some(s);
                    }
                }
                if let Some(p) = preferred {
                    if prefer_preferred(is_playing(&p), other_playing.is_some()) {
                        return Some(p);
                    }
                    // Le préféré est en pause et un autre lecteur joue : on suit celui
                    // que Windows met en avant s'il joue, sinon le premier qui joue.
                    return self
                        .manager
                        .GetCurrentSession()
                        .ok()
                        .filter(is_playing)
                        .or(other_playing);
                }
            }
        }
        self.manager.GetCurrentSession().ok()
    }

    /// Exécute une ligne de commande : analyse d'abord, session ensuite.
    fn command(&mut self, line: &str) {
        let line = line.trim();
        if line.is_empty() {
            return;
        }
        let name = truncate_chars(line, 64);
        let Some(cmd) = parse_command(line) else {
            emit(&json!({ "type": "cmd", "cmd": name, "ok": false, "reason": "commande inconnue" }));
            return;
        };
        match cmd {
            Cmd::Prefer(p) => {
                self.prefer = p;
                self.last_key.clear();
                self.poll_now = true;
            }
            // Volume : on ne garde que la dernière valeur demandée (glissement continu).
            Cmd::VolumeTarget(exe) => {
                self.volume_exe = exe;
                self.last_volume = None;
                self.last_volume_read = None;
            }
            Cmd::Volume(v) => self.volume_wanted = Some(v),
            other => self.media_command(&other, &name),
        }
    }

    /// Envoie une commande de lecture à la session ; la réponse (pour le
    /// diagnostic) dit si le lecteur l'a acceptée.
    fn media_command(&self, cmd: &Cmd, name: &str) {
        let Some(s) = self.session() else {
            emit(&json!({ "type": "cmd", "cmd": name, "ok": false, "reason": "aucune session média" }));
            return;
        };
        let started = match cmd {
            Cmd::PlayPause => s.TryTogglePlayPauseAsync(),
            Cmd::Play => s.TryPlayAsync(),
            Cmd::Pause => s.TryPauseAsync(),
            Cmd::Next => s.TrySkipNextAsync(),
            Cmd::Previous => s.TrySkipPreviousAsync(),
            Cmd::Shuffle => s.TryChangeShuffleActiveAsync(!shuffle_of(&s)),
            Cmd::Repeat => s.TryChangeAutoRepeatModeAsync(next_repeat(repeat_of(&s))),
            // Les autres commandes sont traitées dans `command`.
            _ => return,
        };
        let result = started.map_err(|e| e.message()).and_then(|op| wait(&op, CMD_TIMEOUT));
        let app = s.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default();
        match result {
            Ok(true) => emit(&json!({ "type": "cmd", "cmd": name, "ok": true, "app": app })),
            Ok(false) => emit(&json!({
                "type": "cmd", "cmd": name, "ok": false, "app": app, "reason": "refusée par le lecteur"
            })),
            Err(reason) => emit(&json!({ "type": "cmd", "cmd": name, "ok": false, "app": app, "reason": reason })),
        }
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
            emit(&json!({ "type": "volume", "exe": self.volume_exe, "volume": now }));
        } else if self
            .last_volume_read
            .is_none_or(|t| t.elapsed() >= Duration::from_secs(1))
        {
            self.last_volume_read = Some(Instant::now());
            let v = crate::volume::get(&self.volume_exe);
            if self.last_volume != Some(v) {
                self.last_volume = Some(v);
                emit(&json!({ "type": "volume", "exe": self.volume_exe, "volume": v }));
            }
        }
    }

    /// Écoute les événements de la session suivie (on change d'abonnement avec
    /// elle, même si c'est la même application : l'objet session change).
    fn subscribe(&mut self, s: &Session) {
        let id = identity(s);
        if id != 0 && self.events.as_ref().is_some_and(|sub| sub.id == id) {
            return;
        }
        self.events = Subscription::new(s, &self.tx).ok();
    }

    /// Prochaine échéance interne (relecture de pochette, relecture du volume).
    fn next_deadline(&self, next_poll: Instant) -> Instant {
        let mut d = next_poll;
        if let Some(t) = self.cover_checks.first() {
            d = d.min(*t);
        }
        if !self.volume_exe.is_empty() {
            let v = self
                .last_volume_read
                .map_or_else(Instant::now, |t| t + Duration::from_secs(1));
            d = d.min(v);
        }
        d
    }

    fn cover_check_due(&self) -> bool {
        self.cover_checks.first().is_some_and(|t| Instant::now() >= *t)
    }

    /// Relecture de pochette échue mais impossible (plus de session, lecteur
    /// muet) : on la consomme, sinon l'échéance passée ferait tourner la
    /// boucle en continu.
    fn skip_due_cover_check(&mut self) {
        if self.cover_check_due() {
            self.cover_checks.remove(0);
        }
    }

    fn poll(&mut self) {
        let Some(s) = self.session() else {
            self.events = None;
            self.cover_checks.clear();
            if self.last_key != "<none>" {
                emit(&json!({ "type": "media", "active": false }));
                self.last_key = "<none>".into();
                self.last_signature.clear();
            }
            return;
        };
        let app = s.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default();
        self.subscribe(&s);
        let Ok(props) = s
            .TryGetMediaPropertiesAsync()
            .map_err(|e| e.message())
            .and_then(|op| wait(&op, PROPS_TIMEOUT))
        else {
            self.skip_due_cover_check();
            return;
        };
        let title = props.Title().map(|h| h.to_string()).unwrap_or_default();
        let artist = props.Artist().map(|h| h.to_string()).unwrap_or_default();
        let album = props.AlbumTitle().map(|h| h.to_string()).unwrap_or_default();
        let key = format!("{app}|{title}|{artist}");
        let status = status_name(&s);
        let (pos, dur, updated) = match s.GetTimelineProperties() {
            Ok(tl) => {
                let p = tl.Position().map_or(0, |t| t.Duration);
                let a = tl.StartTime().map_or(0, |t| t.Duration);
                let b = tl.EndTime().map_or(0, |t| t.Duration);
                let u = tl.LastUpdatedTime().map_or(0, |d| unix_ms(d.UniversalTime));
                (secs(p), secs(b.saturating_sub(a).max(0)), u)
            }
            Err(_) => (0.0, 0.0, 0),
        };
        let shuffle = shuffle_of(&s);
        let repeat = repeat_name(repeat_of(&s));
        let state = format!("{status}|{pos}|{dur}|{shuffle}|{repeat}");

        let track_changed = key != self.last_key;
        let mut cover_changed = false;
        if track_changed {
            if let Some(CoverRead::New(hash, url)) = read_cover(&props, None) {
                self.last_cover = Some(url);
                self.last_cover_hash = Some(hash);
            } else {
                self.last_cover = None;
                self.last_cover_hash = None;
            }
            // Spotify publie le nouveau titre avant la nouvelle pochette : la
            // première lecture renvoie souvent l'image du morceau précédent.
            // On relit la pochette plusieurs fois dans les secondes qui suivent
            // (sans ré-encoder une image identique).
            let now = Instant::now();
            self.cover_checks = [700, 1500, 3000, 6000, 12000]
                .iter()
                .map(|ms| now + Duration::from_millis(*ms))
                .collect();
        } else if self.cover_check_due() {
            self.cover_checks.remove(0);
            if let Some(CoverRead::New(hash, url)) = read_cover(&props, self.last_cover_hash) {
                self.last_cover = Some(url);
                self.last_cover_hash = Some(hash);
                cover_changed = true;
            }
        }

        if track_changed || cover_changed || state != self.last_signature {
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
            emit(&msg);
            self.last_key = key;
            self.last_signature = state;
        }
    }
}

/// Lit les commandes sur stdin (autre fil : la boucle n'attend jamais l'entrée).
///
/// Le canal est borné (64 messages) : si la boucle principale est occupée, ce
/// fil attend au lieu de laisser grossir la mémoire. Les réveils SMTC, eux,
/// sont abandonnés quand le canal est plein (la relecture arrive de toute façon).
fn spawn_stdin_reader(tx: SyncSender<Msg>) {
    std::thread::spawn(move || {
        let mut input = std::io::stdin().lock();
        loop {
            let msg = match read_line_capped(&mut input, MAX_LINE) {
                Ok(Some(bytes)) => Msg::Line(String::from_utf8_lossy(&bytes).into_owned()),
                Ok(None) => Msg::Eof,
                Err(e) => Msg::InputError(e.to_string()),
            };
            let last = !matches!(msg, Msg::Line(_));
            if tx.send(msg).is_err() || last {
                return;
            }
        }
    });
}

/// Suite à donner à un message.
enum Flow {
    Continue,
    Exit(i32),
}

fn handle(st: &mut State, msg: Msg, woke: &mut bool) -> Flow {
    match msg {
        Msg::Line(l) => st.command(&l),
        Msg::Wake => *woke = true,
        Msg::Eof => return Flow::Exit(0),
        Msg::InputError(e) => {
            crate::log(&format!("ERR 6 lecture de l'entrée impossible : {e}"));
            return Flow::Exit(6);
        }
    }
    Flow::Continue
}

pub fn run() -> i32 {
    if let Err(e) = crate::process::init_com() {
        emit(&json!({ "type": "error", "message": e }));
        return 1;
    }
    let manager = match Manager::RequestAsync()
        .map_err(|e| e.message())
        .and_then(|op| wait(&op, INIT_TIMEOUT))
    {
        Ok(m) => m,
        Err(e) => {
            emit(&json!({ "type": "error", "message": format!("SMTC indisponible : {e}") }));
            return 1;
        }
    };

    let (tx, rx) = mpsc::sync_channel::<Msg>(64);
    spawn_stdin_reader(tx.clone());

    // Changement de session courante ou de liste des sessions : relecture immédiate.
    let t1 = tx.clone();
    let t2 = tx.clone();
    let events = manager
        .CurrentSessionChanged(&TypedEventHandler::<Manager, CurrentSessionChangedEventArgs>::new(
            move |_, _| {
                let _ = t1.try_send(Msg::Wake);
                Ok(())
            },
        ))
        .and(
            manager.SessionsChanged(&TypedEventHandler::<Manager, SessionsChangedEventArgs>::new(
                move |_, _| {
                    let _ = t2.try_send(Msg::Wake);
                    Ok(())
                },
            )),
        );
    if let Err(e) = events {
        // Le sondage de secours continue de fonctionner, en plus lent à réagir.
        crate::log(&format!(
            "avertissement : événements SMTC indisponibles : {}",
            e.message()
        ));
    }

    let mut st = State {
        manager,
        tx,
        prefer: "spotify".into(),
        last_key: String::new(),
        last_signature: String::new(),
        last_cover: None,
        last_cover_hash: None,
        cover_checks: Vec::new(),
        poll_now: false,
        volume_exe: String::new(),
        volume_wanted: None,
        last_volume: None,
        last_volume_read: None,
        events: None,
    };
    emit(&json!({ "type": "ready", "protocol": PROTOCOL }));

    let mut next_poll = Instant::now();
    loop {
        if STDOUT_BROKEN.load(Ordering::Relaxed) {
            return 0; // Sillon n'écoute plus : fin normale
        }
        // Attente : une commande ou un événement réveille la boucle tout de suite.
        let wait_for = st
            .next_deadline(next_poll)
            .saturating_duration_since(Instant::now())
            .max(Duration::from_millis(10));
        let mut woke = false;
        let first = match rx.recv_timeout(wait_for) {
            Ok(m) => Some(m),
            Err(RecvTimeoutError::Timeout) => None,
            Err(RecvTimeoutError::Disconnected) => return 0,
        };
        // Tout ce qui est en attente, d'un coup.
        for msg in first.into_iter().chain(std::iter::from_fn(|| rx.try_recv().ok())) {
            if let Flow::Exit(code) = handle(&mut st, msg, &mut woke) {
                return code;
            }
        }
        st.volume();
        if woke || std::mem::take(&mut st.poll_now) || st.cover_check_due() || Instant::now() >= next_poll {
            next_poll = Instant::now() + FALLBACK_POLL;
            st.poll();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn lecteur_prefere_seulement_s_il_joue_ou_si_rien_d_autre_ne_joue() {
        assert!(prefer_preferred(true, true));
        assert!(prefer_preferred(true, false));
        assert!(prefer_preferred(false, false)); // tous en pause : le préféré
        assert!(!prefer_preferred(false, true)); // un autre joue : lui
    }

    #[test]
    fn commandes_simples() {
        assert_eq!(parse_command("playpause"), Some(Cmd::PlayPause));
        assert_eq!(parse_command("play"), Some(Cmd::Play));
        assert_eq!(parse_command("pause"), Some(Cmd::Pause));
        assert_eq!(parse_command("next"), Some(Cmd::Next));
        assert_eq!(parse_command("previous"), Some(Cmd::Previous));
        assert_eq!(parse_command("shuffle"), Some(Cmd::Shuffle));
        assert_eq!(parse_command("repeat"), Some(Cmd::Repeat));
    }

    #[test]
    fn commandes_avec_espaces_et_fin_de_ligne() {
        assert_eq!(parse_command("  next \r"), Some(Cmd::Next));
    }

    #[test]
    fn commande_prefer() {
        assert_eq!(parse_command("prefer: Spotify "), Some(Cmd::Prefer("spotify".into())));
        assert_eq!(parse_command("prefer:"), Some(Cmd::Prefer(String::new())));
    }

    #[test]
    fn commande_volume_target() {
        assert_eq!(
            parse_command("volume-target: Spotify.exe "),
            Some(Cmd::VolumeTarget("Spotify.exe".into()))
        );
    }

    #[test]
    fn commande_volume_bornes() {
        assert_eq!(parse_command("volume:0"), Some(Cmd::Volume(0)));
        assert_eq!(parse_command("volume:100"), Some(Cmd::Volume(100)));
        assert_eq!(parse_command("volume: 42"), Some(Cmd::Volume(42)));
        assert_eq!(parse_command("volume:-5"), Some(Cmd::Volume(0)));
        assert_eq!(parse_command("volume:101"), Some(Cmd::Volume(100)));
        assert_eq!(parse_command("volume:999999"), Some(Cmd::Volume(100)));
    }

    #[test]
    fn commande_volume_invalide() {
        assert_eq!(parse_command("volume:"), None);
        assert_eq!(parse_command("volume:abc"), None);
        assert_eq!(parse_command("volume:1.5"), None);
        assert_eq!(parse_command("volume:99999999999999"), None);
    }

    #[test]
    fn commande_inconnue_ou_vide() {
        assert_eq!(parse_command(""), None);
        assert_eq!(parse_command("   "), None);
        assert_eq!(parse_command("stop"), None);
        assert_eq!(parse_command("PLAY"), None);
        assert_eq!(parse_command("play now"), None);
    }

    #[test]
    fn secondes_arrondies_au_dixieme() {
        assert!((secs(0) - 0.0).abs() < 1e-9);
        assert!((secs(10_000_000) - 1.0).abs() < 1e-9);
        assert!((secs(12_340_000) - 1.2).abs() < 1e-9);
        assert!((secs(12_360_000) - 1.2).abs() < 1e-9);
        assert!((secs(1_800_000_000) - 180.0).abs() < 1e-9);
        assert!((secs(-10_000_000) + 1.0).abs() < 1e-9);
    }

    #[test]
    fn date_windows_en_millisecondes_unix() {
        // 1970-01-01 en date Windows.
        assert_eq!(unix_ms(116_444_736_000_000_000), 0);
        assert_eq!(unix_ms(116_444_736_000_000_000 + 10_000_000), 1000);
    }

    #[test]
    fn cycle_de_repetition() {
        use MediaPlaybackAutoRepeatMode as M;
        assert_eq!(next_repeat(M::None), M::List);
        assert_eq!(next_repeat(M::List), M::Track);
        assert_eq!(next_repeat(M::Track), M::None);
    }

    #[test]
    fn noms_de_repetition() {
        use MediaPlaybackAutoRepeatMode as M;
        assert_eq!(repeat_name(M::None), "None");
        assert_eq!(repeat_name(M::List), "List");
        assert_eq!(repeat_name(M::Track), "Track");
    }

    #[test]
    fn mime_valide_conserve() {
        assert_eq!(clean_mime("image/jpeg"), "image/jpeg");
        assert_eq!(clean_mime("image/svg+xml"), "image/png");
        assert_eq!(clean_mime("IMAGE/PNG"), "image/png");
        assert_eq!(clean_mime("image/vnd.microsoft.icon"), "image/png");
    }

    #[test]
    fn mime_invalide_remplace_par_png() {
        assert_eq!(clean_mime(""), "image/png");
        assert_eq!(clean_mime("image/"), "image/png");
        assert_eq!(clean_mime("text/html"), "image/png");
        assert_eq!(clean_mime("image/png;base64,AAA"), "image/png");
        assert_eq!(clean_mime("image/png\"onerror=x"), "image/png");
        assert_eq!(clean_mime("image/a b"), "image/png");
    }

    #[test]
    fn taille_de_pochette_bornee() {
        assert_eq!(cover_size(0), None);
        assert_eq!(cover_size(1), Some(1));
        assert_eq!(cover_size(u64::from(MAX_COVER)), Some(MAX_COVER));
        assert_eq!(cover_size(u64::from(MAX_COVER) + 1), None);
        assert_eq!(cover_size(u64::MAX), None);
    }

    #[test]
    fn lecture_de_lignes() {
        let mut r = Cursor::new(b"play\nnext\r\nlast".to_vec());
        assert_eq!(read_line_capped(&mut r, 100).unwrap(), Some(b"play".to_vec()));
        assert_eq!(read_line_capped(&mut r, 100).unwrap(), Some(b"next\r".to_vec()));
        assert_eq!(read_line_capped(&mut r, 100).unwrap(), Some(b"last".to_vec()));
        assert_eq!(read_line_capped(&mut r, 100).unwrap(), None);
    }

    #[test]
    fn lecture_ligne_vide_et_fin() {
        let mut r = Cursor::new(b"\n".to_vec());
        assert_eq!(read_line_capped(&mut r, 100).unwrap(), Some(Vec::new()));
        assert_eq!(read_line_capped(&mut r, 100).unwrap(), None);
    }

    #[test]
    fn lecture_ligne_trop_longue_tronquee() {
        let mut data = vec![b'a'; 10_000];
        data.extend_from_slice(b"\nnext\n");
        let mut r = Cursor::new(data);
        let first = read_line_capped(&mut r, MAX_LINE).unwrap().unwrap();
        assert_eq!(first.len(), MAX_LINE);
        // La ligne suivante reste intacte.
        assert_eq!(read_line_capped(&mut r, MAX_LINE).unwrap(), Some(b"next".to_vec()));
    }

    #[test]
    fn lecture_octets_invalides_tolerée() {
        let mut r = Cursor::new(vec![0xff, 0xfe, b'\n']);
        let bytes = read_line_capped(&mut r, 100).unwrap().unwrap();
        assert!(!String::from_utf8_lossy(&bytes).is_empty());
    }

    #[test]
    fn troncature_en_caracteres() {
        assert_eq!(truncate_chars("éèàù", 2), "éè");
        assert_eq!(truncate_chars("ab", 10), "ab");
    }
}
