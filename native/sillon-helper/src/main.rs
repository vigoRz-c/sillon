//! Assistant système de Sillon (remplace les anciens scripts PowerShell).
//!
//! Deux modes :
//!
//! * `sillon-helper media` : lit le morceau en cours dans les contrôles média
//!   de Windows (SMTC) et règle le volume du lecteur dans le mélangeur.
//!   Sortie : une ligne JSON par événement. Entrée : une commande par ligne
//!   (`playpause`, `next`, `previous`, `play`, `pause`, `shuffle`, `repeat`,
//!   `prefer:<texte>`, `volume-target:<programme.exe>`, `volume:<0-100>`).
//!
//! * `sillon-helper capture <programme.exe>` : enregistre le son de ce seul
//!   programme (« process loopback », Windows 10 2004+ / 11).
//!   Sortie : son brut mono 48 000 Hz, entiers 16 bits petit-boutistes.
//!   Erreur : une ligne « ERR <code> <message> ». Codes de sortie :
//!   2 = capture impossible, 3 = programme fermé, 4 = programme introuvable.

mod capture;
mod media;
mod process;
mod volume;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let code = match args.first().map(String::as_str) {
        Some("media") => media::run(),
        Some("capture") => capture::run(args.get(1).map(String::as_str).unwrap_or("")),
        _ => {
            eprintln!("usage : sillon-helper media | capture <programme.exe>");
            1
        }
    };
    std::process::exit(code);
}
