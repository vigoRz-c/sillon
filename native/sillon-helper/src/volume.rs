//! Volume d'un seul programme dans le mélangeur de volume de Windows : ne touche
//! ni au volume général ni aux autres applications.

use windows::core::Interface;
use windows::Win32::Media::Audio::{
    eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
    DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

use crate::process;

/// Volumes de toutes les sessions audio du programme, sur toutes les sorties actives.
fn sessions(exe: &str) -> Vec<ISimpleAudioVolume> {
    let mut found = Vec::new();
    unsafe {
        let Ok(en) = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) else {
            return found;
        };
        let Ok(devices) = en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) else {
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

/// Volume 0-100 (0 si coupé), ou -1 si le programme n'a pas de son ouvert.
pub fn get(exe: &str) -> i32 {
    let Some(v) = sessions(exe).into_iter().next() else {
        return -1;
    };
    unsafe {
        let level = v.GetMasterVolume().unwrap_or(1.0);
        let muted = v.GetMute().map(|b| b.as_bool()).unwrap_or(false);
        if muted {
            0
        } else {
            (level * 100.0).round() as i32
        }
    }
}

/// Règle le volume (0-100). Faux si le programme n'a pas de son ouvert.
pub fn set(exe: &str, percent: i32) -> bool {
    let level = percent.clamp(0, 100) as f32 / 100.0;
    let mut any = false;
    unsafe {
        for v in sessions(exe) {
            let _ = v.SetMasterVolume(level, std::ptr::null());
            if level > 0.0 {
                let _ = v.SetMute(false, std::ptr::null());
            }
            any = true;
        }
    }
    any
}
