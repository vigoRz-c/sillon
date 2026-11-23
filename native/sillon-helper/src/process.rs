//! Petits outils sur les processus de Windows.

use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
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
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
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
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(h);
        if !ok {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.rsplit('\\').next().map(str::to_string)
    }
}

/// Poignée pour savoir si un processus s'est terminé.
pub struct Watch(HANDLE);

impl Watch {
    pub fn new(pid: u32) -> Option<Watch> {
        unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid).ok().map(Watch) }
    }
    pub fn exited(&self) -> bool {
        unsafe { WaitForSingleObject(self.0, 0) == WAIT_OBJECT_0 }
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
