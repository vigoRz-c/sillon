//! Petits outils sur les processus de Windows.

use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_FAILED, WAIT_OBJECT_0};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, WaitForSingleObject, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
};

fn wide_to_string(w: &[u16]) -> String {
    let end = w.iter().position(|&c| c == 0).unwrap_or(w.len());
    String::from_utf16_lossy(&w[..end])
}

/// Tous les processus : (pid, pid du parent, nom du programme).
pub fn list() -> Vec<(u32, u32, String)> {
    let mut out = Vec::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return out;
        };
        let mut e = PROCESSENTRY32W {
            dwSize: u32::try_from(std::mem::size_of::<PROCESSENTRY32W>()).unwrap_or(0),
            ..Default::default()
        };
        if Process32FirstW(snap, &mut e).is_ok() {
            loop {
                out.push((e.th32ProcessID, e.th32ParentProcessID, wide_to_string(&e.szExeFile)));
                if Process32NextW(snap, &mut e).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    out
}

/// Processus racine d'un programme : celui dont le parent ne porte pas le même
/// nom (Spotify et les navigateurs lancent plusieurs processus).
pub fn root_of(exe: &str) -> Option<u32> {
    let all = list();
    let same: Vec<&(u32, u32, String)> = all.iter().filter(|p| p.2.eq_ignore_ascii_case(exe)).collect();
    let ids: Vec<u32> = same.iter().map(|p| p.0).collect();
    same.iter().find(|p| !ids.contains(&p.1)).or(same.first()).map(|p| p.0)
}

/// Nom du programme d'un processus (« Spotify.exe »), ou None.
pub fn name_of(pid: u32) -> Option<String> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = u32::try_from(buf.len()).unwrap_or(0);
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(h);
        if !ok {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.rsplit('\\').next().map(str::to_string)
    }
}

/// Initialise COM pour le fil courant. S_OK et S_FALSE (déjà initialisé) sont
/// acceptés ; toute autre valeur (ex. mode de cloisonnement différent) est une erreur.
pub fn init_com() -> Result<(), String> {
    // SAFETY: appel sans pointeur ; le résultat est vérifié.
    let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    hr.ok()
        .map_err(|e| format!("initialisation COM refusée : {}", e.message()))
}

/// Vrai si un processus de ce numéro existe encore (sondage par liste des processus).
pub fn exists(pid: u32) -> bool {
    list().iter().any(|p| p.0 == pid)
}

/// Poignée pour savoir si un processus s'est terminé.
pub struct Watch {
    handle: HANDLE,
    pid: u32,
}

impl Watch {
    pub fn new(pid: u32) -> Option<Watch> {
        // SAFETY: OpenProcess ne lit aucun pointeur ; la poignée est fermée dans Drop.
        unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid).ok() }.map(|handle| Watch { handle, pid })
    }

    pub fn exited(&self) -> bool {
        // SAFETY: la poignée est valide tant que `self` existe.
        let r = unsafe { WaitForSingleObject(self.handle, 0) };
        if r == WAIT_FAILED {
            // On ne présume pas que le processus est vivant : trace, puis sondage.
            crate::log("avertissement : attente du processus suivi impossible, sondage de secours");
            return !exists(self.pid);
        }
        r == WAIT_OBJECT_0
    }
}

/// Le processus suivi s'est-il terminé ? Sans poignée (OpenProcess refusé), on
/// sonde l'existence du processus.
pub fn has_exited(watch: Option<&Watch>, pid: u32) -> bool {
    match watch {
        Some(w) => w.exited(),
        None => !exists(pid),
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        // SAFETY: poignée ouverte par `new`, fermée une seule fois ici.
        unsafe {
            let _ = CloseHandle(self.handle);
        }
    }
}
