//! Sillon's system helper (replaces the old PowerShell scripts).
//!
//! # Protocol (version 1)
//!
//! Two modes:
//!
//! * `sillon-helper media`: reads the current track in the Windows media
//!   controls (SMTC) and sets the player's volume in the mixer.
//!   * Output: one JSON line per event. The first one is
//!     `{"type":"ready","protocol":1}`; the protocol number changes with every
//!     incompatible change of the messages or commands.
//!     Other types: `media`, `volume`, `cmd` (answer to a command, with
//!     `ok` and, on failure, `reason`) and `error`.
//!   * Input: one command per line, 4 KB at most (`playpause`, `next`,
//!     `previous`, `play`, `pause`, `shuffle`, `repeat`, `prefer:<text>`,
//!     `volume-target:<program.exe>`, `volume:<0-100>`). An unknown
//!     command gets `{"type":"cmd","ok":false,"reason":"unknown command"}`,
//!     a line of more than 4 KB `{"type":"cmd","ok":false,"reason":"line too long"}`
//!     (it is not run).
//!   * Exit codes: 0 = normal end (input or output closed),
//!     1 = SMTC or COM unavailable, 6 = error reading the input.
//!     Internal error (panic): line "ERR 5 …" on stderr, then abrupt
//!     stop (panic = "abort": Windows code 0xC0000409, not 5).
//!
//! * `sillon-helper capture <program.exe>`: records the sound of this single
//!   program ("process loopback", Windows 10 2004+ / 11).
//!   * Output: raw mono sound at 48,000 Hz, 16-bit little-endian integers.
//!   * Error: a line "ERR <code> <message>" on stderr. Exit codes:
//!     2 = capture impossible on this Windows, 7 = audio device lost
//!     (output change: a new attempt is possible),
//!     3 = program closed, 4 = program not found or name refused.
//!     Panic: "ERR 5 …" on stderr then abrupt stop (code 0xC0000409).

mod capture;
mod media;
mod process;
mod volume;

use std::io::Write;

/// Writes a line on stderr; a write error (closed pipe) is ignored.
pub fn log(msg: &str) {
    let _ = writeln!(std::io::stderr(), "{msg}");
}

/// A panic is reported in the format of the other errors: "ERR 5 <message>".
fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let payload = info.payload();
        let text = payload
            .downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panique".to_string());
        let place = info
            .location()
            .map(|l| format!(" ({}:{})", l.file(), l.line()))
            .unwrap_or_default();
        // A single line, so that Node can parse it.
        let line = format!("ERR 5 {text}{place}").replace(['\r', '\n'], " ");
        log(&line);
    }));
}

fn main() {
    install_panic_hook();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let code = match args.first().map(String::as_str) {
        Some("media") => media::run(),
        Some("capture") => capture::run(args.get(1).map_or("", String::as_str)),
        _ => {
            log("usage : sillon-helper media | capture <programme.exe>");
            1
        }
    };
    std::process::exit(code);
}
