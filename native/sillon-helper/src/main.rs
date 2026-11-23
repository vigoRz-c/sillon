//! Assistant système de Sillon (remplace les anciens scripts PowerShell).
//!
//! # Protocole (version 1)
//!
//! Deux modes :
//!
//! * `sillon-helper media` : lit le morceau en cours dans les contrôles média
//!   de Windows (SMTC) et règle le volume du lecteur dans le mélangeur.
//!   * Sortie : une ligne JSON par événement. Le premier est
//!     `{"type":"ready","protocol":1}` ; le numéro de protocole change à chaque
//!     modification incompatible des messages ou des commandes.
//!     Autres types : `media`, `volume`, `cmd` (réponse à une commande, avec
//!     `ok` et, en cas d'échec, `reason`) et `error`.
//!   * Entrée : une commande par ligne, 4 Ko au plus (`playpause`, `next`,
//!     `previous`, `play`, `pause`, `shuffle`, `repeat`, `prefer:<texte>`,
//!     `volume-target:<programme.exe>`, `volume:<0-100>`). Une commande
//!     inconnue reçoit `{"type":"cmd","ok":false,"reason":"commande inconnue"}`.
//!   * Codes de sortie : 0 = fin normale (entrée ou sortie fermée),
//!     1 = SMTC ou COM indisponible, 6 = erreur de lecture de l'entrée.
//!     Erreur interne (panique) : ligne « ERR 5 … » sur stderr, puis arrêt
//!     brutal (panic = "abort" : code Windows 0xC0000409, pas 5).
//!
//! * `sillon-helper capture <programme.exe>` : enregistre le son de ce seul
//!   programme (« process loopback », Windows 10 2004+ / 11).
//!   * Sortie : son brut mono 48 000 Hz, entiers 16 bits petit-boutistes.
//!   * Erreur : une ligne « ERR <code> <message> » sur stderr. Codes de sortie :
//!     2 = capture impossible sur ce Windows, 7 = périphérique audio perdu
//!     (changement de sortie : nouvel essai possible),
//!     3 = programme fermé, 4 = programme introuvable ou nom refusé.
//!     Panique : « ERR 5 … » sur stderr puis arrêt brutal (code 0xC0000409).

mod capture;
mod media;
mod process;
mod volume;

use std::io::Write;

/// Écrit une ligne sur stderr ; une erreur d'écriture (tuyau fermé) est ignorée.
pub fn log(msg: &str) {
    let _ = writeln!(std::io::stderr(), "{msg}");
}

/// Une panique est annoncée au format des autres erreurs : « ERR 5 <message> ».
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
        // Une seule ligne, pour que Node puisse l'analyser.
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
