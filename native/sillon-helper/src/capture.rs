//! Capture du son d'un seul programme (et de ses sous-processus).
//!
//! Windows 10 (version 2004 et plus) et Windows 11 savent enregistrer la sortie
//! audio d'un seul processus (« process loopback »). Sillon s'en sert pour
//! n'analyser que le lecteur suivi et ignorer le chat vocal, les notifications
//! et les jeux.

use std::io::Write;
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

/// Drapeau « silence » d'un paquet WASAPI (la valeur est un petit entier positif).
#[allow(clippy::cast_sign_loss)]
const SILENT: u32 = AUDCLNT_BUFFERFLAGS_SILENT.0 as u32;

fn fail(code: i32, msg: &str) -> i32 {
    crate::log(&format!("ERR {code} {msg}"));
    code
}

/// Poignée Windows fermée automatiquement (aucune fuite sur les chemins d'erreur).
struct OwnedHandle(HANDLE);

// SAFETY: une poignée d'événement Windows peut être signalée et fermée depuis n'importe quel fil.
unsafe impl Send for OwnedHandle {}
// SAFETY: idem ; SetEvent et WaitForSingleObject sont sûrs en accès concurrent.
unsafe impl Sync for OwnedHandle {}

impl OwnedHandle {
    /// Événement à réarmement automatique, non signalé.
    fn event() -> WinResult<OwnedHandle> {
        // SAFETY: aucun pointeur fourni ; la poignée est fermée dans Drop.
        unsafe { CreateEventW(None, false, false, None) }.map(OwnedHandle)
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        // SAFETY: poignée ouverte par `event`, fermée une seule fois ici.
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

/// Signale l'événement à la fin de l'activation. Le gestionnaire garde sa propre
/// référence (Arc) : si l'attente a expiré, Windows peut encore le signaler sans
/// toucher une poignée déjà fermée.
#[implement(IActivateAudioInterfaceCompletionHandler, IAgileObject)]
struct Done(Arc<OwnedHandle>);

impl IActivateAudioInterfaceCompletionHandler_Impl for Done_Impl {
    fn ActivateCompleted(&self, _op: Ref<IActivateAudioInterfaceAsyncOperation>) -> WinResult<()> {
        // SAFETY: la poignée est valide tant que l'Arc existe.
        unsafe { SetEvent(self.0 .0) }
    }
}

// Objet « agile » : Windows peut l'appeler depuis n'importe quel fil.
impl IAgileObject_Impl for Done_Impl {}

/// Client audio branché sur la sortie du processus `pid` et de ses enfants.
///
/// # Safety
/// COM doit être initialisé sur le fil appelant.
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
    // ManuallyDrop : sinon Rust « libère » à la fin les paramètres, qui sont
    // sur la pile (PropVariantClear) et le programme plante.
    let pv = std::mem::ManuallyDrop::new(PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_BLOB,
                Anonymous: PROPVARIANT_0_0_0 {
                    blob: BLOB {
                        cbSize: size,
                        // `params` vit jusqu'à la fin de la fonction, donc pendant tout
                        // l'appel à ActivateAudioInterfaceAsync qui le copie.
                        pBlobData: std::ptr::addr_of_mut!(params).cast::<u8>(),
                    },
                },
                ..Default::default()
            }),
        },
    });
    let event = Arc::new(OwnedHandle::event().map_err(|e| e.message())?);
    let handler: IActivateAudioInterfaceCompletionHandler = Done(Arc::clone(&event)).into();
    // SAFETY: `pv` et `handler` sont valides pour la durée de l'appel ; en cas d'échec,
    // l'événement est fermé par Drop (aucune fuite).
    let op = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        &IAudioClient::IID,
        Some(&*pv),
        &handler,
    )
    .map_err(|e| format!("activation refusée : {}", e.message()))?;
    // Si l'attente expire, l'événement reste ouvert tant que le gestionnaire (Arc) existe.
    let waited = WaitForSingleObject(event.0, 5000);
    if waited == WAIT_FAILED {
        return Err("attente de l'activation impossible".into());
    }
    if waited != WAIT_OBJECT_0 {
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

/// Ajoute `frames` échantillons mono (moyenne des deux canaux) à `buf`. Sans
/// données (`None`, tampon silencieux ou illisible), ajoute autant de zéros.
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

/// Lit tous les paquets disponibles et les ajoute à `buf` en mono.
///
/// # Safety
/// `capture` doit provenir d'un client audio démarré, au format 16 bits stéréo.
unsafe fn drain(capture: &IAudioCaptureClient, buf: &mut Vec<u8>) -> std::result::Result<(), String> {
    loop {
        // Une erreur ici (ex. périphérique invalidé) n'est pas « pas de données » : on la remonte.
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
            // Rien à lire (AUDCLNT_S_BUFFER_EMPTY) : pas une erreur.
            let _ = capture.ReleaseBuffer(0);
            return Ok(());
        }
        let n = frames as usize;
        let typed = data.cast::<i16>();
        let silent = flags & SILENT != 0;
        let samples = if silent || data.is_null() || !typed.is_aligned() {
            None
        } else {
            // SAFETY: GetBuffer a rendu un tampon non nul de `frames` trames stéréo 16 bits
            // (2 × i16 par trame), aligné (vérifié), valide jusqu'au ReleaseBuffer ci-dessous.
            Some(std::slice::from_raw_parts(typed.cast_const(), n * 2))
        };
        push_mono(buf, samples, n);
        capture.ReleaseBuffer(frames).map_err(|e| e.message())?;
    }
}

/// Nom de programme accepté : « quelquechose.exe », sans chemin ni caractère spécial.
fn valid_exe_name(exe: &str) -> bool {
    exe.len() > 4
        && exe.to_ascii_lowercase().ends_with(".exe")
        && exe.chars().all(|c| c.is_alphanumeric() || "._- ".contains(c))
}

pub fn run(exe: &str) -> i32 {
    if !valid_exe_name(exe) {
        return fail(4, "nom de programme refusé");
    }
    let Some(pid) = process::root_of(exe) else {
        return fail(4, &format!("{exe} n'est pas lancé"));
    };
    if let Err(e) = process::init_com() {
        return fail(2, &e);
    }

    // SAFETY: COM est initialisé ; les interfaces restent sur ce fil.
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
        let Ok(ready) = OwnedHandle::event() else {
            return fail(2, "événement");
        };
        if client.SetEventHandle(ready.0).is_err() || client.Start().is_err() {
            return fail(2, "démarrage refusé");
        }

        let target = process::Watch::new(pid);
        if target.is_none() {
            crate::log("avertissement : suivi du processus impossible, sondage toutes les secondes");
        }
        let mut out = std::io::stdout().lock();
        let mut buf: Vec<u8> = Vec::with_capacity(RATE as usize * 2);
        let mut last_check = Instant::now();
        let code = loop {
            if WaitForSingleObject(ready.0, 100) == WAIT_FAILED {
                break fail(7, "périphérique audio perdu : attente impossible");
            }
            buf.clear();
            if let Err(e) = drain(&capture, &mut buf) {
                break fail(7, &format!("périphérique audio perdu : {e}"));
            }
            if !buf.is_empty() && (out.write_all(&buf).is_err() || out.flush().is_err()) {
                break 0; // Sillon a fermé le tuyau : fin normale
            }
            if last_check.elapsed() >= Duration::from_secs(1) {
                last_check = Instant::now();
                if process::has_exited(target.as_ref(), pid) {
                    break fail(3, "application fermée");
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
    fn nom_exe_valide() {
        assert!(valid_exe_name("Spotify.exe"));
        assert!(valid_exe_name("chrome.EXE"));
        assert!(valid_exe_name("my app-1_2.exe"));
        assert!(valid_exe_name("é.exe"));
    }

    #[test]
    fn nom_exe_refuse() {
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
    fn mono_moyenne_des_deux_canaux() {
        let mut buf = Vec::new();
        push_mono(&mut buf, Some(&[100, 200, -50, 50, i16::MAX, i16::MAX]), 3);
        assert_eq!(samples_of(&buf), vec![150, 0, i16::MAX]);
    }

    #[test]
    fn mono_sans_donnees_donne_des_zeros() {
        let mut buf = Vec::new();
        push_mono(&mut buf, None, 4);
        assert_eq!(buf, vec![0u8; 8]);
    }

    #[test]
    fn mono_tampon_trop_court_complete_par_des_zeros() {
        let mut buf = Vec::new();
        push_mono(&mut buf, Some(&[10, 20]), 2);
        assert_eq!(samples_of(&buf), vec![15, 0]);
    }

    #[test]
    fn mono_zero_trame() {
        let mut buf = Vec::new();
        push_mono(&mut buf, Some(&[]), 0);
        assert!(buf.is_empty());
    }
}
