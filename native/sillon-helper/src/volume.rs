//! Volume d'un seul programme dans le mélangeur de volume de Windows : ne touche
//! ni au volume général ni aux autres applications.
//!
//! L'énumérateur de périphériques et les contrôles de session sont gardés en
//! cache (le volume est relu chaque seconde) ; le cache est vidé à la moindre
//! erreur ou au bout de quelques secondes (nouvelles sessions).

use std::cell::RefCell;
use std::time::{Duration, Instant};

use windows::core::Interface;
use windows::Win32::Media::Audio::{
    eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
    DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

use crate::process;

/// Durée de vie des contrôles de session en cache.
const SESSIONS_TTL: Duration = Duration::from_secs(5);

struct CachedSessions {
    exe: String,
    at: Instant,
    volumes: Vec<ISimpleAudioVolume>,
}

thread_local! {
    static ENUMERATOR: RefCell<Option<IMMDeviceEnumerator>> = const { RefCell::new(None) };
    static SESSIONS: RefCell<Option<CachedSessions>> = const { RefCell::new(None) };
}

/// Vide les caches (après une erreur COM : périphérique changé, session fermée…).
fn invalidate() {
    ENUMERATOR.with(|c| *c.borrow_mut() = None);
    SESSIONS.with(|c| *c.borrow_mut() = None);
}

/// Énumérateur de périphériques, créé une seule fois.
fn enumerator() -> Option<IMMDeviceEnumerator> {
    ENUMERATOR.with(|c| {
        let mut slot = c.borrow_mut();
        if slot.is_none() {
            // SAFETY: création COM sans pointeur fourni par nous.
            *slot = unsafe { CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) }.ok();
        }
        slot.clone()
    })
}

/// Volumes de toutes les sessions audio du programme, sur toutes les sorties actives.
fn enumerate(exe: &str) -> Vec<ISimpleAudioVolume> {
    let mut found = Vec::new();
    let Some(en) = enumerator() else {
        return found;
    };
    // SAFETY: interfaces COM obtenues et utilisées sur ce seul fil, sans pointeur brut.
    unsafe {
        let Ok(devices) = en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) else {
            invalidate();
            return found;
        };
        let count = devices.GetCount().unwrap_or(0);
        for d in 0..count {
            let Ok(dev) = devices.Item(d) else { continue };
            let Ok(mgr) = dev.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else {
                continue;
            };
            let Ok(list) = mgr.GetSessionEnumerator() else { continue };
            let n = list.GetCount().unwrap_or(0);
            for i in 0..n {
                let Ok(ctl) = list.GetSession(i) else { continue };
                let Ok(ctl2) = ctl.cast::<IAudioSessionControl2>() else {
                    continue;
                };
                let pid = ctl2.GetProcessId().unwrap_or(0);
                if pid == 0 {
                    continue;
                }
                let same = process::name_of(pid).is_some_and(|n| n.eq_ignore_ascii_case(exe));
                if same {
                    if let Ok(v) = ctl.cast::<ISimpleAudioVolume>() {
                        found.push(v);
                    }
                }
            }
        }
    }
    found
}

/// Sessions du programme, depuis le cache si possible. `fresh` force une nouvelle énumération.
fn sessions(exe: &str, fresh: bool) -> Vec<ISimpleAudioVolume> {
    if !fresh {
        let cached = SESSIONS.with(|c| {
            c.borrow()
                .as_ref()
                .filter(|s| s.exe.eq_ignore_ascii_case(exe) && s.at.elapsed() < SESSIONS_TTL)
                .map(|s| s.volumes.clone())
        });
        if let Some(v) = cached {
            return v;
        }
    }
    let volumes = enumerate(exe);
    // Une liste vide n'est pas gardée : un lecteur qui démarre doit être vu tout de suite.
    SESSIONS.with(|c| {
        *c.borrow_mut() = (!volumes.is_empty()).then(|| CachedSessions {
            exe: exe.to_string(),
            at: Instant::now(),
            volumes: volumes.clone(),
        });
    });
    volumes
}

/// Volume 0-100 (0 si coupé) d'après le niveau et l'état muet.
fn percent(level: f32, muted: bool) -> i32 {
    if muted {
        return 0;
    }
    // Niveau borné à 0..=1 : le résultat tient dans 0..=100.
    #[allow(clippy::cast_possible_truncation)]
    {
        (level.clamp(0.0, 1.0) * 100.0).round() as i32
    }
}

/// Niveau 0.0-1.0 pour un pourcentage (borné à 0-100).
fn level_of(percent: i32) -> f32 {
    // Valeur bornée à 0..=100 : conversion exacte en f32.
    #[allow(clippy::cast_precision_loss)]
    {
        percent.clamp(0, 100) as f32 / 100.0
    }
}

fn read(v: &ISimpleAudioVolume) -> Option<i32> {
    // SAFETY: appels COM sans pointeur fourni par nous.
    unsafe {
        let level = v.GetMasterVolume().ok()?;
        let muted = v.GetMute().ok()?.as_bool();
        Some(percent(level, muted))
    }
}

/// Volume 0-100 (0 si coupé), ou -1 si le programme n'a pas de son ouvert
/// ou si la lecture échoue (volume inconnu).
pub fn get(exe: &str) -> i32 {
    for fresh in [false, true] {
        let Some(v) = sessions(exe, fresh).into_iter().next() else {
            return -1;
        };
        if let Some(p) = read(&v) {
            return p;
        }
        invalidate();
    }
    -1
}

/// Règle le volume (0-100). Faux si le programme n'a pas de son ouvert ou si
/// aucune session n'a accepté la valeur.
pub fn set(exe: &str, percent: i32) -> bool {
    let level = level_of(percent);
    for fresh in [false, true] {
        let mut any = false;
        for v in sessions(exe, fresh) {
            // SAFETY: appels COM ; un pointeur nul pour le contexte d'événement est permis.
            unsafe {
                let mut ok = v.SetMasterVolume(level, std::ptr::null()).is_ok();
                if level > 0.0 {
                    ok &= v.SetMute(false, std::ptr::null()).is_ok();
                }
                any |= ok;
            }
        }
        if any {
            return true;
        }
        invalidate();
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_arrondit_et_borne() {
        assert_eq!(percent(0.0, false), 0);
        assert_eq!(percent(1.0, false), 100);
        assert_eq!(percent(0.456, false), 46);
        assert_eq!(percent(1.7, false), 100);
        assert_eq!(percent(-0.2, false), 0);
    }

    #[test]
    fn percent_muet_vaut_zero() {
        assert_eq!(percent(0.8, true), 0);
    }

    #[test]
    fn level_of_borne_les_valeurs() {
        assert!((level_of(-5) - 0.0).abs() < f32::EPSILON);
        assert!((level_of(50) - 0.5).abs() < f32::EPSILON);
        assert!((level_of(900) - 1.0).abs() < f32::EPSILON);
    }
}
