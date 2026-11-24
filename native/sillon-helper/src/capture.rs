//! Capture of the sound of a single program (and of its child processes).
//!
//! Windows 10 (version 2004 and later) and Windows 11 can record the audio
//! output of a single process ("process loopback"). Sillon uses it to
//! analyze only the followed player and ignore voice chat, notifications
//! and games.

use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use windows::core::{implement, Interface, Ref, Result as WinResult};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_FAILED, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation, IActivateAudioInterfaceCompletionHandler,
    IActivateAudioInterfaceCompletionHandler_Impl, IAudioCaptureClient, IAudioClient, AUDCLNT_BUFFERFLAGS_SILENT,
    AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
    AUDCLNT_STREAMFLAGS_LOOPBACK, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, AUDIOCLIENT_ACTIVATION_PARAMS,
    AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, WAVEFORMATEX,
};
use windows::Win32::System::Com::StructuredStorage::{PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0};
use windows::Win32::System::Com::{IAgileObject, IAgileObject_Impl, BLOB};
use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject};
use windows::Win32::System::Variant::VT_BLOB;

use crate::process;

const RATE: u32 = 48_000;

/// "Silent" flag of a WASAPI packet (the value is a small positive integer).
#[allow(clippy::cast_sign_loss)]
const SILENT: u32 = AUDCLNT_BUFFERFLAGS_SILENT.0 as u32;

fn fail(code: i32, msg: &str) -> i32 {
    crate::log(&format!("ERR {code} {msg}"));
    code
}

/// Windows handle closed automatically (no leak on the error paths).
struct OwnedHandle(HANDLE);

// SAFETY: a Windows event handle can be signaled and closed from any thread.
unsafe impl Send for OwnedHandle {}
// SAFETY: same; SetEvent and WaitForSingleObject are safe with concurrent access.
unsafe impl Sync for OwnedHandle {}

impl OwnedHandle {
    /// Auto-reset event, not signaled.
    fn event() -> WinResult<OwnedHandle> {
        // SAFETY: no pointer given; the handle is closed in Drop.
        unsafe { CreateEventW(None, false, false, None) }.map(OwnedHandle)
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        // SAFETY: handle opened by `event`, closed only once here.
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

/// Signals the event at the end of the activation. The handler keeps its own
/// reference (Arc): if the wait timed out, Windows can still signal it without
/// touching an already closed handle.
#[implement(IActivateAudioInterfaceCompletionHandler, IAgileObject)]
struct Done(Arc<OwnedHandle>);

impl IActivateAudioInterfaceCompletionHandler_Impl for Done_Impl {
    fn ActivateCompleted(&self, _op: Ref<IActivateAudioInterfaceAsyncOperation>) -> WinResult<()> {
        // SAFETY: the handle is valid as long as the Arc exists.
        unsafe { SetEvent(self.0 .0) }
    }
}

// "Agile" object: Windows may call it from any thread.
impl IAgileObject_Impl for Done_Impl {}

/// Audio client plugged into the output of process `pid` and of its children.
///
/// # Safety
/// COM must be initialized on the calling thread.
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
    let size = u32::try_from(std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>()).map_err(|_| "taille".to_string())?;
    // ManuallyDrop: otherwise Rust "frees" the parameters at the end, which are
    // on the stack (PropVariantClear), and the program crashes.
    let pv = std::mem::ManuallyDrop::new(PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_BLOB,
                Anonymous: PROPVARIANT_0_0_0 {
                    blob: BLOB {
                        cbSize: size,
                        // `params` lives until the end of the function, so during the whole
                        // call to ActivateAudioInterfaceAsync, which copies it.
                        pBlobData: std::ptr::addr_of_mut!(params).cast::<u8>(),
                    },
                },
                ..Default::default()
            }),
        },
    });
    let event = Arc::new(OwnedHandle::event().map_err(|e| e.message())?);
    let handler: IActivateAudioInterfaceCompletionHandler = Done(Arc::clone(&event)).into();
    // SAFETY: `pv` and `handler` are valid for the duration of the call; on failure,
    // the event is closed by Drop (no leak).
    let op = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        &IAudioClient::IID,
        Some(&*pv),
        &handler,
    )
    .map_err(|e| format!("activation refused: {}", e.message()))?;
    // If the wait times out, the event stays open as long as the handler (Arc) exists.
    let waited = WaitForSingleObject(event.0, 5000);
    if waited == WAIT_FAILED {
        return Err("could not wait for the activation".into());
    }
    if waited != WAIT_OBJECT_0 {
        return Err("activation without an answer".into());
    }
    let mut hr = windows::core::HRESULT(0);
    let mut iface = None;
    op.GetActivateResult(&mut hr, &mut iface).map_err(|e| e.message())?;
    if hr.is_err() {
        return Err(format!("activation refused 0x{:08X}", hr.0));
    }
    iface
        .ok_or_else(|| "activation vide".to_string())?
        .cast::<IAudioClient>()
        .map_err(|e| e.message())
}

/// Appends `frames` mono samples (average of the two channels) to `buf`. Without
/// data (`None`, silent or unreadable buffer), appends as many zeros.
fn push_mono(buf: &mut Vec<u8>, stereo: Option<&[i16]>, frames: usize) {
    for f in 0..frames {
        let v = match stereo {
            Some(s) if s.len() > f * 2 + 1 => {
                let mean = (i32::from(s[f * 2]) + i32::from(s[f * 2 + 1])) / 2;
                i16::try_from(mean).unwrap_or(0)
            }
            _ => 0,
        };
        buf.extend_from_slice(&v.to_le_bytes());
    }
}

/// Reads every available packet and appends them to `buf` in mono.
///
/// # Safety
/// `capture` must come from a started audio client, in 16-bit stereo format.
unsafe fn drain(capture: &IAudioCaptureClient, buf: &mut Vec<u8>) -> std::result::Result<(), String> {
    loop {
        // An error here (e.g. invalidated device) is not "no data": pass it up.
        let pending = capture.GetNextPacketSize().map_err(|e| e.message())?;
        if pending == 0 {
            return Ok(());
        }
        let mut data = std::ptr::null_mut();
        let mut frames = 0u32;
        let mut flags = 0u32;
        capture
            .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
            .map_err(|e| e.message())?;
        if frames == 0 {
            // Nothing to read (AUDCLNT_S_BUFFER_EMPTY): not an error.
            let _ = capture.ReleaseBuffer(0);
            return Ok(());
        }
        let n = frames as usize;
        let typed = data.cast::<i16>();
        let silent = flags & SILENT != 0;
        let samples = if silent || data.is_null() || !typed.is_aligned() {
            None
        } else {
            // SAFETY: GetBuffer returned a non-null buffer of `frames` 16-bit stereo frames
            // (2 × i16 per frame), aligned (checked), valid until the ReleaseBuffer below.
            Some(std::slice::from_raw_parts(typed.cast_const(), n * 2))
        };
        push_mono(buf, samples, n);
        capture.ReleaseBuffer(frames).map_err(|e| e.message())?;
    }
}

/// Accepted program name: "something.exe", without a path or special character.
fn valid_exe_name(exe: &str) -> bool {
    exe.len() > 4
        && exe.to_ascii_lowercase().ends_with(".exe")
        && exe.chars().all(|c| c.is_alphanumeric() || "._- ".contains(c))
}

/// Thread that reads the input until its end, then raises `gone` and wakes the capture loop.
fn watch_parent(gone: Arc<AtomicBool>, wake: Arc<OwnedHandle>) {
    std::thread::spawn(move || {
        wait_end_of_input(std::io::stdin().lock());
        gone.store(true, Ordering::Relaxed);
        // SAFETY: the handle stays valid as long as the Arc exists.
        unsafe {
            let _ = SetEvent(wake.0);
        }
    });
}

/// Reads and throws away everything that arrives, until the end of the stream (or an error).
fn wait_end_of_input<R: Read>(mut input: R) {
    let mut sink = [0u8; 64];
    while matches!(input.read(&mut sink), Ok(n) if n > 0) {}
}

pub fn run(exe: &str) -> i32 {
    if !valid_exe_name(exe) {
        return fail(4, "program name refused");
    }
    let Some(pid) = process::root_of(exe) else {
        return fail(4, &format!("{exe} is not running"));
    };
    if let Err(e) = process::init_com() {
        return fail(2, &e);
    }

    // SAFETY: COM is initialized; the interfaces stay on this thread.
    unsafe {
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
        let Ok(ready) = OwnedHandle::event().map(Arc::new) else {
            return fail(2, "event");
        };
        if client.SetEventHandle(ready.0).is_err() || client.Start().is_err() {
            return fail(2, "start refused");
        }

        // Sillon is the only one writing to our input (a pipe, never anything on it):
        // its end means Sillon is closed or dead, so we stop without staying orphaned.
        let parent_gone = Arc::new(AtomicBool::new(false));
        watch_parent(Arc::clone(&parent_gone), Arc::clone(&ready));

        let target = process::Watch::new(pid);
        if target.is_none() {
            crate::log("warning: could not follow the process, polling every second");
        }
        let mut out = std::io::stdout().lock();
        let mut buf: Vec<u8> = Vec::with_capacity(RATE as usize * 2);
        let mut last_check = Instant::now();
        let code = loop {
            if WaitForSingleObject(ready.0, 100) == WAIT_FAILED {
                break fail(7, "audio device lost: could not wait");
            }
            if parent_gone.load(Ordering::Relaxed) {
                break 0; // Sillon a disparu : fin normale
            }
            buf.clear();
            if let Err(e) = drain(&capture, &mut buf) {
                break fail(7, &format!("audio device lost: {e}"));
            }
            if !buf.is_empty() && (out.write_all(&buf).is_err() || out.flush().is_err()) {
                break 0; // Sillon closed the pipe: normal end
            }
            if last_check.elapsed() >= Duration::from_secs(1) {
                last_check = Instant::now();
                if process::has_exited(target.as_ref(), pid) {
                    break fail(3, "application closed");
                }
            }
        };
        let _ = client.Stop();
        code
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_exe_name_accepted() {
        assert!(valid_exe_name("Spotify.exe"));
        assert!(valid_exe_name("chrome.EXE"));
        assert!(valid_exe_name("my app-1_2.exe"));
        assert!(valid_exe_name("é.exe"));
    }

    #[test]
    fn invalid_exe_name_refused() {
        assert!(!valid_exe_name(""));
        assert!(!valid_exe_name(".exe"));
        assert!(!valid_exe_name("Spotify"));
        assert!(!valid_exe_name("Spotify.dll"));
        assert!(!valid_exe_name("C:\\x\\a.exe"));
        assert!(!valid_exe_name("a/b.exe"));
        assert!(!valid_exe_name("a&b.exe"));
        assert!(!valid_exe_name("a\nb.exe"));
    }

    fn samples_of(buf: &[u8]) -> Vec<i16> {
        buf.chunks(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect()
    }

    #[test]
    fn mono_averages_both_channels() {
        let mut buf = Vec::new();
        push_mono(&mut buf, Some(&[100, 200, -50, 50, i16::MAX, i16::MAX]), 3);
        assert_eq!(samples_of(&buf), vec![150, 0, i16::MAX]);
    }

    #[test]
    fn mono_without_data_gives_zeros() {
        let mut buf = Vec::new();
        push_mono(&mut buf, None, 4);
        assert_eq!(buf, vec![0u8; 8]);
    }

    #[test]
    fn mono_short_buffer_padded_with_zeros() {
        let mut buf = Vec::new();
        push_mono(&mut buf, Some(&[10, 20]), 2);
        assert_eq!(samples_of(&buf), vec![15, 0]);
    }

    #[test]
    fn end_of_input_detected() {
        // Some bytes then the end: the reading finishes (otherwise this test would not end).
        wait_end_of_input(std::io::Cursor::new(
            b"du bruit
encore"
                .to_vec(),
        ));
        wait_end_of_input(std::io::empty());
    }

    #[test]
    fn mono_zero_frames() {
        let mut buf = Vec::new();
        push_mono(&mut buf, Some(&[]), 0);
        assert!(buf.is_empty());
    }
}
