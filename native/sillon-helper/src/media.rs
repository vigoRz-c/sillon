//! Current track (Windows media controls, SMTC) and player volume.
//!
//! Same source as the Windows media panel: Spotify, a YouTube tab,
//! VLC… with no account or API. Sends one JSON event per change.
//!
//! Changes are reported by the SMTC events (current session,
//! properties, playback state, timeline); a slow poll (2 s) serves as a
//! safety net. Every asynchronous WinRT call has a maximum delay.

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

/// Protocol version announced in the "ready" message (see main.rs).
const PROTOCOL: u32 = 1;
/// Maximum length of a received command line (the rest is ignored).
const MAX_LINE: usize = 4096;
/// Maximum size of a cover (beyond it, none is sent).
const MAX_COVER: u32 = 8 * 1024 * 1024;
/// Maximum delay of a command (play, pause…) to the player.
const CMD_TIMEOUT: Duration = Duration::from_secs(4);
/// Maximum delay to read the track properties.
const PROPS_TIMEOUT: Duration = Duration::from_secs(4);
/// Maximum delay to open and read the cover (per step).
const COVER_TIMEOUT: Duration = Duration::from_secs(5);
/// Maximum delay to start the SMTC manager.
const INIT_TIMEOUT: Duration = Duration::from_secs(5);
/// Fallback poll: the SMTC events trigger the reading immediately.
const FALLBACK_POLL: Duration = Duration::from_secs(2);

/// Becomes true when writing to stdout fails: Sillon is gone.
static STDOUT_BROKEN: AtomicBool = AtomicBool::new(false);

fn emit(v: &Value) {
    let mut out = std::io::stdout().lock();
    if writeln!(out, "{v}").is_err() || out.flush().is_err() {
        STDOUT_BROKEN.store(true, Ordering::Relaxed);
    }
}

/// Message sent to the main loop.
enum Msg {
    /// A command line (4 KB at most).
    Line(String),
    /// A line longer than 4 KB: refused (truncated, it would change meaning).
    TooLong(String),
    /// End of the input: Sillon is gone.
    Eof,
    /// I/O error on the input.
    InputError(String),
    /// An SMTC event asks for a new reading.
    Wake,
}

/// Command received from Sillon.
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

/// Parses a command line (without touching Windows). `None` if it is
/// empty or unknown; a volume is bounded to 0-100.
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

/// Line read from the input: its bytes (at most `cap`) and whether it was cut.
#[derive(Debug, PartialEq, Eq)]
struct Line {
    bytes: Vec<u8>,
    truncated: bool,
}

/// Reads a line (without the `\n`) keeping at most `cap` bytes: the rest of
/// the line is read then ignored, and the line is marked `truncated`.
/// `Ok(None)` at the end of the input.
fn read_line_capped<R: BufRead>(r: &mut R, cap: usize) -> std::io::Result<Option<Line>> {
    let mut line = Vec::new();
    let mut any = false;
    let mut truncated = false;
    loop {
        let chunk = match r.fill_buf() {
            Ok(c) => c,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        if chunk.is_empty() {
            // End of the input: a last line without `\n` still counts.
            return Ok(any.then_some(Line { bytes: line, truncated }));
        }
        any = true;
        let newline = chunk.iter().position(|&b| b == b'\n');
        let used = newline.map_or(chunk.len(), |i| i + 1);
        let data = newline.unwrap_or(chunk.len());
        let room = cap.saturating_sub(line.len());
        truncated |= data > room;
        line.extend_from_slice(&chunk[..data.min(room)]);
        r.consume(used);
        if newline.is_some() {
            return Ok(Some(Line { bytes: line, truncated }));
        }
    }
}

/// Start of a string (in characters), so as not to send back 4 KB in a message.
fn truncate_chars(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// Waits for the end of a WinRT operation, at most `timeout`. Beyond it, the operation
/// is cancelled and the wait is a failure.
fn wait<T: RuntimeType + 'static>(op: &IAsyncOperation<T>, timeout: Duration) -> Result<T, String> {
    let start = Instant::now();
    loop {
        match op.Status() {
            Ok(AsyncStatus::Started) => {}
            // Completed, cancelled or in error: GetResults gives the result or the error.
            Ok(_) => return op.GetResults().map_err(|e| e.message()),
            Err(e) => return Err(e.message()),
        }
        if start.elapsed() >= timeout {
            let _ = op.Cancel();
            return Err("timed out".to_string());
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// Interval (units of 100 ns) in seconds, rounded to the tenth.
fn secs(ticks: i64) -> f64 {
    // Loss of precision without effect: the interval is then rounded to the tenth.
    #[allow(clippy::cast_precision_loss)]
    {
        (ticks as f64 / 1e6).round() / 10.0
    }
}

/// Windows date (100 ns since 1601) in Unix milliseconds.
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

/// Next mode: none -> playlist -> track -> none.
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

/// Image type safe to copy into a "data URL": only known bitmap
/// formats (no SVG, which may contain script), otherwise `image/png`.
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

/// An acceptable cover size (not zero, 8 MB at most).
fn cover_size(size: u64) -> Option<u32> {
    u32::try_from(size).ok().filter(|&s| s > 0 && s <= MAX_COVER)
}

/// Result of reading a cover.
enum CoverRead {
    /// Same as the previous one (not re-encoded).
    Same,
    /// New image: checksum and "data URL".
    New(u64, String),
}

/// Cover (raw bytes read, capped and within the delay), or None.
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

/// Reads the cover. If its checksum is `previous`, returns `Same` without encoding it in base64.
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

/// Subscription to the events of a session (removed on destruction).
struct Subscription {
    session: Session,
    /// Identity of the session (see `identity`).
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
                // Partial subscription: remove what is already registered.
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
    /// Immediate new reading asked (change of preferred player).
    poll_now: bool,
    volume_exe: String,
    volume_wanted: Option<i32>,
    last_volume: Option<i32>,
    last_volume_read: Option<Instant>,
    /// Session whose events are listened to (tied to the session object itself:
    /// the same application may change it, Spotify restarted, another tab).
    events: Option<Subscription>,
}

/// Identity of a session (canonical address of the object); 0 if it is unknown.
fn identity(s: &Session) -> usize {
    s.cast::<IUnknown>().map_or(0, |u| u.as_raw() as usize)
}

/// Does the preferred application's session come before the others? Yes if
/// it is playing, or if no other one is playing (otherwise "paused" would be shown
/// while another player is playing).
fn prefer_preferred(preferred_playing: bool, other_playing: bool) -> bool {
    preferred_playing || !other_playing
}

fn is_playing(s: &Session) -> bool {
    status_name(s) == "Playing"
}

impl State {
    /// Preferred session (e.g. Spotify), otherwise the one Windows puts forward.
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
                    // The preferred one is paused and another player is playing: follow the one
                    // Windows puts forward if it is playing, otherwise the first one playing.
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

    /// Runs a command line: parsing first, session next.
    fn command(&mut self, line: &str) {
        let line = line.trim();
        if line.is_empty() {
            return;
        }
        let name = truncate_chars(line, 64);
        let Some(cmd) = parse_command(line) else {
            emit(&json!({ "type": "cmd", "cmd": name, "ok": false, "reason": "unknown command" }));
            return;
        };
        match cmd {
            Cmd::Prefer(p) => {
                self.prefer = p;
                self.last_key.clear();
                self.poll_now = true;
            }
            // Volume: only the last requested value is kept (continuous drag).
            Cmd::VolumeTarget(exe) => {
                self.volume_exe = exe;
                self.last_volume = None;
                self.last_volume_read = None;
            }
            Cmd::Volume(v) => self.volume_wanted = Some(v),
            other => self.media_command(&other, &name),
        }
    }

    /// Sends a playback command to the session; the answer (for the
    /// diagnostic) says whether the player accepted it.
    fn media_command(&self, cmd: &Cmd, name: &str) {
        let Some(s) = self.session() else {
            emit(&json!({ "type": "cmd", "cmd": name, "ok": false, "reason": "no media session" }));
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
            // The other commands are handled in `command`.
            _ => return,
        };
        let result = started.map_err(|e| e.message()).and_then(|op| wait(&op, CMD_TIMEOUT));
        let app = s.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default();
        match result {
            Ok(true) => emit(&json!({ "type": "cmd", "cmd": name, "ok": true, "app": app })),
            Ok(false) => emit(&json!({
                "type": "cmd", "cmd": name, "ok": false, "app": app, "reason": "refused by the player"
            })),
            Err(reason) => emit(&json!({ "type": "cmd", "cmd": name, "ok": false, "app": app, "reason": reason })),
        }
    }

    /// Player volume: applied right away, read again every second.
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

    /// Listens to the events of the followed session (the subscription changes with
    /// it, even if it is the same application: the session object changes).
    fn subscribe(&mut self, s: &Session) {
        let id = identity(s);
        if id != 0 && self.events.as_ref().is_some_and(|sub| sub.id == id) {
            return;
        }
        self.events = Subscription::new(s, &self.tx).ok();
    }

    /// Next internal deadline (cover re-read, volume re-read).
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

    /// Cover re-read due but impossible (no more session, silent
    /// player): it is consumed, otherwise the past deadline would make the
    /// loop spin continuously.
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
            // Spotify publishes the new title before the new cover: the
            // first reading often returns the picture of the previous track.
            // The cover is read again several times in the following seconds
            // (without re-encoding an identical image).
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

/// Reads the commands on stdin (another thread: the loop never waits for the input).
///
/// The channel is bounded (64 messages): if the main loop is busy, this
/// thread waits instead of letting the memory grow. The SMTC wake-ups
/// are dropped when the channel is full (the new reading arrives anyway).
fn spawn_stdin_reader(tx: SyncSender<Msg>) {
    std::thread::spawn(move || {
        let mut input = std::io::stdin().lock();
        loop {
            let msg = match read_line_capped(&mut input, MAX_LINE) {
                Ok(Some(Line { bytes, truncated })) => {
                    let text = String::from_utf8_lossy(&bytes).into_owned();
                    if truncated {
                        Msg::TooLong(text)
                    } else {
                        Msg::Line(text)
                    }
                }
                Ok(None) => Msg::Eof,
                Err(e) => Msg::InputError(e.to_string()),
            };
            let last = !matches!(msg, Msg::Line(_) | Msg::TooLong(_));
            if tx.send(msg).is_err() || last {
                return;
            }
        }
    });
}

/// What to do with a message.
enum Flow {
    Continue,
    Exit(i32),
}

fn handle(st: &mut State, msg: Msg, woke: &mut bool) -> Flow {
    match msg {
        Msg::Line(l) => st.command(&l),
        Msg::TooLong(l) => emit(&json!({
            "type": "cmd",
            "cmd": truncate_chars(l.trim(), 64),
            "ok": false,
            "reason": "line too long",
        })),
        Msg::Wake => *woke = true,
        Msg::Eof => return Flow::Exit(0),
        Msg::InputError(e) => {
            crate::log(&format!("ERR 6 could not read the input: {e}"));
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

    // Change of current session or of the session list: immediate new reading.
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
        // The fallback poll keeps working, slower to react.
        crate::log(&format!("warning: SMTC events unavailable: {}", e.message()));
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
            return 0; // Sillon no longer listens: normal end
        }
        // Waiting: a command or an event wakes the loop right away.
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
        // Everything pending, at once.
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
    fn preferred_player_only_if_playing_or_nothing_else_plays() {
        assert!(prefer_preferred(true, true));
        assert!(prefer_preferred(true, false));
        assert!(prefer_preferred(false, false)); // all paused: the preferred one
        assert!(!prefer_preferred(false, true)); // another one plays: that one
    }

    #[test]
    fn simple_commands() {
        assert_eq!(parse_command("playpause"), Some(Cmd::PlayPause));
        assert_eq!(parse_command("play"), Some(Cmd::Play));
        assert_eq!(parse_command("pause"), Some(Cmd::Pause));
        assert_eq!(parse_command("next"), Some(Cmd::Next));
        assert_eq!(parse_command("previous"), Some(Cmd::Previous));
        assert_eq!(parse_command("shuffle"), Some(Cmd::Shuffle));
        assert_eq!(parse_command("repeat"), Some(Cmd::Repeat));
    }

    #[test]
    fn commands_with_spaces_and_line_ends() {
        assert_eq!(parse_command("  next \r"), Some(Cmd::Next));
    }

    #[test]
    fn prefer_command() {
        assert_eq!(parse_command("prefer: Spotify "), Some(Cmd::Prefer("spotify".into())));
        assert_eq!(parse_command("prefer:"), Some(Cmd::Prefer(String::new())));
    }

    #[test]
    fn volume_target_command() {
        assert_eq!(
            parse_command("volume-target: Spotify.exe "),
            Some(Cmd::VolumeTarget("Spotify.exe".into()))
        );
    }

    #[test]
    fn volume_command_bounds() {
        assert_eq!(parse_command("volume:0"), Some(Cmd::Volume(0)));
        assert_eq!(parse_command("volume:100"), Some(Cmd::Volume(100)));
        assert_eq!(parse_command("volume: 42"), Some(Cmd::Volume(42)));
        assert_eq!(parse_command("volume:-5"), Some(Cmd::Volume(0)));
        assert_eq!(parse_command("volume:101"), Some(Cmd::Volume(100)));
        assert_eq!(parse_command("volume:999999"), Some(Cmd::Volume(100)));
    }

    #[test]
    fn invalid_volume_command() {
        assert_eq!(parse_command("volume:"), None);
        assert_eq!(parse_command("volume:abc"), None);
        assert_eq!(parse_command("volume:1.5"), None);
        assert_eq!(parse_command("volume:99999999999999"), None);
    }

    #[test]
    fn unknown_or_empty_command() {
        assert_eq!(parse_command(""), None);
        assert_eq!(parse_command("   "), None);
        assert_eq!(parse_command("stop"), None);
        assert_eq!(parse_command("PLAY"), None);
        assert_eq!(parse_command("play now"), None);
    }

    #[test]
    fn seconds_rounded_to_the_tenth() {
        assert!((secs(0) - 0.0).abs() < 1e-9);
        assert!((secs(10_000_000) - 1.0).abs() < 1e-9);
        assert!((secs(12_340_000) - 1.2).abs() < 1e-9);
        assert!((secs(12_360_000) - 1.2).abs() < 1e-9);
        assert!((secs(1_800_000_000) - 180.0).abs() < 1e-9);
        assert!((secs(-10_000_000) + 1.0).abs() < 1e-9);
    }

    #[test]
    fn windows_date_in_unix_milliseconds() {
        // 1970-01-01 as a Windows date.
        assert_eq!(unix_ms(116_444_736_000_000_000), 0);
        assert_eq!(unix_ms(116_444_736_000_000_000 + 10_000_000), 1000);
    }

    #[test]
    fn repeat_cycle() {
        use MediaPlaybackAutoRepeatMode as M;
        assert_eq!(next_repeat(M::None), M::List);
        assert_eq!(next_repeat(M::List), M::Track);
        assert_eq!(next_repeat(M::Track), M::None);
    }

    #[test]
    fn repeat_names() {
        use MediaPlaybackAutoRepeatMode as M;
        assert_eq!(repeat_name(M::None), "None");
        assert_eq!(repeat_name(M::List), "List");
        assert_eq!(repeat_name(M::Track), "Track");
    }

    #[test]
    fn valid_mime_kept() {
        assert_eq!(clean_mime("image/jpeg"), "image/jpeg");
        assert_eq!(clean_mime("image/svg+xml"), "image/png");
        assert_eq!(clean_mime("IMAGE/PNG"), "image/png");
        assert_eq!(clean_mime("image/vnd.microsoft.icon"), "image/png");
    }

    #[test]
    fn invalid_mime_replaced_by_png() {
        assert_eq!(clean_mime(""), "image/png");
        assert_eq!(clean_mime("image/"), "image/png");
        assert_eq!(clean_mime("text/html"), "image/png");
        assert_eq!(clean_mime("image/png;base64,AAA"), "image/png");
        assert_eq!(clean_mime("image/png\"onerror=x"), "image/png");
        assert_eq!(clean_mime("image/a b"), "image/png");
    }

    #[test]
    fn cover_size_bounded() {
        assert_eq!(cover_size(0), None);
        assert_eq!(cover_size(1), Some(1));
        assert_eq!(cover_size(u64::from(MAX_COVER)), Some(MAX_COVER));
        assert_eq!(cover_size(u64::from(MAX_COVER) + 1), None);
        assert_eq!(cover_size(u64::MAX), None);
    }

    #[test]
    fn reading_lines() {
        let mut r = Cursor::new(b"play\nnext\r\nlast".to_vec());
        assert_eq!(read_line_capped(&mut r, 100).unwrap(), Some(ok_line(b"play")));
        assert_eq!(read_line_capped(&mut r, 100).unwrap(), Some(ok_line(b"next\r")));
        assert_eq!(read_line_capped(&mut r, 100).unwrap(), Some(ok_line(b"last")));
        assert_eq!(read_line_capped(&mut r, 100).unwrap(), None);
    }

    #[test]
    fn reading_empty_line_and_end() {
        let mut r = Cursor::new(b"\n".to_vec());
        assert_eq!(read_line_capped(&mut r, 100).unwrap(), Some(ok_line(b"")));
        assert_eq!(read_line_capped(&mut r, 100).unwrap(), None);
    }

    #[test]
    fn reading_too_long_line_marked() {
        let mut data = vec![b'a'; 10_000];
        data.extend_from_slice(b"\nnext\n");
        let mut r = Cursor::new(data);
        let first = read_line_capped(&mut r, MAX_LINE).unwrap().unwrap();
        assert_eq!(first.bytes.len(), MAX_LINE);
        assert!(first.truncated, "cut line: to refuse, not to run");
        // The next line stays intact.
        assert_eq!(read_line_capped(&mut r, MAX_LINE).unwrap(), Some(ok_line(b"next")));
    }

    #[test]
    fn reading_line_of_exact_size_not_marked() {
        let mut data = vec![b'a'; MAX_LINE];
        data.push(b'\n');
        let line = read_line_capped(&mut Cursor::new(data), MAX_LINE).unwrap().unwrap();
        assert_eq!(line.bytes.len(), MAX_LINE);
        assert!(!line.truncated);
    }

    fn ok_line(b: &[u8]) -> Line {
        Line {
            bytes: b.to_vec(),
            truncated: false,
        }
    }

    #[test]
    fn reading_invalid_bytes_tolerated() {
        let mut r = Cursor::new(vec![0xff, 0xfe, b'\n']);
        let line = read_line_capped(&mut r, 100).unwrap().unwrap();
        assert!(!String::from_utf8_lossy(&line.bytes).is_empty());
    }

    #[test]
    fn troncature_en_caracteres() {
        assert_eq!(truncate_chars("éèàù", 2), "éè");
        assert_eq!(truncate_chars("ab", 10), "ab");
    }
}
