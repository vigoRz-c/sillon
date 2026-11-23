//! Capture du son d'un seul programme (et de ses sous-processus).
//!
//! Windows 10 (version 2004 et plus) et Windows 11 savent enregistrer la sortie
//! audio d'un seul processus (« process loopback »). Sillon s'en sert pour
//! n'analyser que le lecteur suivi et ignorer le chat vocal, les notifications
//! et les jeux.

use std::io::Write;
use std::time::{Duration, Instant};

use windows::core::{implement, Interface, Ref, Result as WinResult};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Media::Audio::{
    ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation, IActivateAudioInterfaceCompletionHandler,
    IActivateAudioInterfaceCompletionHandler_Impl, IAudioCaptureClient, IAudioClient, AUDCLNT_BUFFERFLAGS_SILENT,
    AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
    AUDCLNT_STREAMFLAGS_LOOPBACK, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, AUDIOCLIENT_ACTIVATION_PARAMS,
    AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, WAVEFORMATEX,
};
use windows::Win32::System::Com::StructuredStorage::{PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0};
use windows::Win32::System::Com::{CoInitializeEx, IAgileObject, IAgileObject_Impl, BLOB, COINIT_MULTITHREADED};
use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject};
use windows::Win32::System::Variant::VT_BLOB;

use crate::process;

const RATE: u32 = 48_000;

fn fail(code: i32, msg: &str) -> i32 {
    eprintln!("ERR {code} {msg}");
    code
}

#[implement(IActivateAudioInterfaceCompletionHandler, IAgileObject)]
struct Done(HANDLE);

impl IActivateAudioInterfaceCompletionHandler_Impl for Done_Impl {
    fn ActivateCompleted(&self, _op: Ref<IActivateAudioInterfaceAsyncOperation>) -> WinResult<()> {
        unsafe { SetEvent(self.0) }
    }
}

// Objet « agile » : Windows peut l'appeler depuis n'importe quel fil.
impl IAgileObject_Impl for Done_Impl {}

/// Client audio branché sur la sortie du processus `pid` et de ses enfants.
unsafe fn activate(pid: u32) -> std::result::Result<IAudioClient, String> {
    let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            },
        },
    };
    // ManuallyDrop : sinon Rust « libère » à la fin les paramètres, qui sont
    // sur la pile (PropVariantClear) et le programme plante.
    let pv = std::mem::ManuallyDrop::new(PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_BLOB,
                Anonymous: PROPVARIANT_0_0_0 {
                    blob: BLOB {
                        cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                        pBlobData: &mut params as *mut _ as *mut u8,
                    },
                },
                ..Default::default()
            }),
        },
    });
    let event = CreateEventW(None, false, false, None).map_err(|e| e.message())?;
    let handler: IActivateAudioInterfaceCompletionHandler = Done(event).into();
    let op = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        &IAudioClient::IID,
        Some(&*pv),
        &handler,
    )
    .map_err(|e| format!("activation refusée : {}", e.message()))?;
    let waited = WaitForSingleObject(event, 5000);
    let _ = CloseHandle(event);
    if waited.0 != 0 {
        return Err("activation sans réponse".into());
    }
    let mut hr = windows::core::HRESULT(0);
    let mut iface = None;
    op.GetActivateResult(&mut hr, &mut iface).map_err(|e| e.message())?;
    if hr.is_err() {
        return Err(format!("activation refusée 0x{:08X}", hr.0));
    }
    iface
        .ok_or_else(|| "activation vide".to_string())?
        .cast::<IAudioClient>()
        .map_err(|e| e.message())
}

pub fn run(exe: &str) -> i32 {
    let valid = exe.len() > 4
        && exe.to_ascii_lowercase().ends_with(".exe")
        && exe.chars().all(|c| c.is_alphanumeric() || "._- ".contains(c));
    if !valid {
        return fail(4, "nom de programme refusé");
    }
    let Some(pid) = process::root_of(exe) else {
        return fail(4, &format!("{exe} n'est pas lancé"));
    };

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let client = match activate(pid) {
            Ok(c) => c,
            Err(e) => return fail(2, &e),
        };
        let fmt = WAVEFORMATEX {
            wFormatTag: 1, // PCM
            nChannels: 2,
            nSamplesPerSec: RATE,
            nAvgBytesPerSec: RATE * 4,
            nBlockAlign: 4,
            wBitsPerSample: 16,
            cbSize: 0,
        };
        let flags = AUDCLNT_STREAMFLAGS_LOOPBACK
            | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
            | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
            | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
        if let Err(e) = client.Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 200_000, 0, &fmt, None) {
            return fail(2, &e.message());
        }
        let capture: IAudioCaptureClient = match client.GetService() {
            Ok(c) => c,
            Err(e) => return fail(2, &e.message()),
        };
        let Ok(ready) = CreateEventW(None, false, false, None) else {
            return fail(2, "événement");
        };
        if client.SetEventHandle(ready).is_err() || client.Start().is_err() {
            return fail(2, "démarrage refusé");
        }

        let target = process::Watch::new(pid);
        let mut out = std::io::stdout().lock();
        let mut buf: Vec<u8> = Vec::with_capacity((RATE * 2) as usize);
        let mut last_check = Instant::now();
        let code = loop {
            WaitForSingleObject(ready, 100);
            buf.clear();
            while capture.GetNextPacketSize().unwrap_or(0) > 0 {
                let mut data = std::ptr::null_mut();
                let mut frames = 0u32;
                let mut flags = 0u32;
                if capture
                    .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                    .is_err()
                {
                    break;
                }
                let silent = flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0;
                let samples = std::slice::from_raw_parts(data as *const i16, frames as usize * 2);
                for f in 0..frames as usize {
                    // Mono : moyenne des deux canaux.
                    let v = if silent {
                        0
                    } else {
                        ((samples[f * 2] as i32 + samples[f * 2 + 1] as i32) / 2) as i16
                    };
                    buf.extend_from_slice(&v.to_le_bytes());
                }
                let _ = capture.ReleaseBuffer(frames);
            }
            if !buf.is_empty() && (out.write_all(&buf).is_err() || out.flush().is_err()) {
                break 0; // Sillon a fermé le tuyau : fin normale
            }
            if last_check.elapsed() >= Duration::from_secs(1) {
                last_check = Instant::now();
                if target.as_ref().is_some_and(|t| t.exited()) {
                    break fail(3, "application fermée");
                }
            }
        };
        let _ = client.Stop();
        let _ = CloseHandle(ready);
        code
    }
}
