//! Volume of a single program in the Windows volume mixer: touches
//! neither the general volume nor the other applications.
//!
//! The device enumerator and the session controls are kept in
//! cache (the volume is read again every second); the cache is emptied on the slightest
//! error or after a few seconds (new sessions).

use std::cell::RefCell;
use std::time::{Duration, Instant};

use windows::core::Interface;
use windows::Win32::Media::Audio::{
    eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
    DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

use crate::process;

/// Lifetime of the cached session controls.
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

/// Empties the caches (after a COM error: device changed, session closed…).
fn invalidate() {
    ENUMERATOR.with(|c| *c.borrow_mut() = None);
    SESSIONS.with(|c| *c.borrow_mut() = None);
}

/// Device enumerator, created only once.
fn enumerator() -> Option<IMMDeviceEnumerator> {
    ENUMERATOR.with(|c| {
        let mut slot = c.borrow_mut();
        if slot.is_none() {
            // SAFETY: COM creation without a pointer given by us.
            *slot = unsafe { CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) }.ok();
        }
        slot.clone()
    })
}

/// Volumes of every audio session of the program, on every active output.
fn enumerate(exe: &str) -> Vec<ISimpleAudioVolume> {
    let mut found = Vec::new();
    let Some(en) = enumerator() else {
        return found;
    };
    // SAFETY: COM interfaces obtained and used on this single thread, without a raw pointer.
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

/// Sessions of the program, from the cache if possible. `fresh` forces a new enumeration.
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
    // An empty list is not kept: a player that starts must be seen right away.
    SESSIONS.with(|c| {
        *c.borrow_mut() = (!volumes.is_empty()).then(|| CachedSessions {
            exe: exe.to_string(),
            at: Instant::now(),
            volumes: volumes.clone(),
        });
    });
    volumes
}

/// Volume 0-100 (0 if muted) from the level and the mute state.
fn percent(level: f32, muted: bool) -> i32 {
    if muted {
        return 0;
    }
    // Level bounded to 0..=1: the result fits in 0..=100.
    #[allow(clippy::cast_possible_truncation)]
    {
        (level.clamp(0.0, 1.0) * 100.0).round() as i32
    }
}

/// Level 0.0-1.0 for a percentage (bounded to 0-100).
fn level_of(percent: i32) -> f32 {
    // Value bounded to 0..=100: exact conversion to f32.
    #[allow(clippy::cast_precision_loss)]
    {
        percent.clamp(0, 100) as f32 / 100.0
    }
}

fn read(v: &ISimpleAudioVolume) -> Option<i32> {
    // SAFETY: COM calls without a pointer given by us.
    unsafe {
        let level = v.GetMasterVolume().ok()?;
        let muted = v.GetMute().ok()?.as_bool();
        Some(percent(level, muted))
    }
}

/// Volume 0-100 (0 if muted), or -1 if the program has no open sound
/// or if the reading fails (unknown volume).
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

/// Sets the volume (0-100). False if the program has no open sound or if
/// no session accepted the value.
pub fn set(exe: &str, percent: i32) -> bool {
    let level = level_of(percent);
    for fresh in [false, true] {
        let mut any = false;
        for v in sessions(exe, fresh) {
            // SAFETY: COM calls; a null pointer for the event context is allowed.
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
    fn percent_rounds_and_bounds() {
        assert_eq!(percent(0.0, false), 0);
        assert_eq!(percent(1.0, false), 100);
        assert_eq!(percent(0.456, false), 46);
        assert_eq!(percent(1.7, false), 100);
        assert_eq!(percent(-0.2, false), 0);
    }

    #[test]
    fn muted_percent_is_zero() {
        assert_eq!(percent(0.8, true), 0);
    }

    #[test]
    fn level_of_bounds_the_values() {
        assert!((level_of(-5) - 0.0).abs() < f32::EPSILON);
        assert!((level_of(50) - 0.5).abs() < f32::EPSILON);
        assert!((level_of(900) - 1.0).abs() < f32::EPSILON);
    }
}
