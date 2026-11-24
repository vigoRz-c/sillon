//! Small tools on Windows processes.

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

/// Every process: (pid, parent pid, program name).
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

/// Root process of a program: the one whose parent does not have the same
/// name (Spotify and the browsers start several processes).
pub fn root_of(exe: &str) -> Option<u32> {
    let all = list();
    let same: Vec<&(u32, u32, String)> = all.iter().filter(|p| p.2.eq_ignore_ascii_case(exe)).collect();
    let ids: Vec<u32> = same.iter().map(|p| p.0).collect();
    same.iter().find(|p| !ids.contains(&p.1)).or(same.first()).map(|p| p.0)
}

/// Program name of a process ("Spotify.exe"), or None.
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

/// Initializes COM for the current thread. S_OK and S_FALSE (already initialized) are
/// accepted; any other value (e.g. a different apartment mode) is an error.
pub fn init_com() -> Result<(), String> {
    // SAFETY: call without a pointer; the result is checked.
    let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    hr.ok()
        .map_err(|e| format!("COM initialization refused: {}", e.message()))
}

/// True if a process with this number still exists (polling the process list).
pub fn exists(pid: u32) -> bool {
    list().iter().any(|p| p.0 == pid)
}

/// Handle to know whether a process has ended.
pub struct Watch {
    handle: HANDLE,
    pid: u32,
}

impl Watch {
    pub fn new(pid: u32) -> Option<Watch> {
        // SAFETY: OpenProcess reads no pointer; the handle is closed in Drop.
        unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid).ok() }.map(|handle| Watch { handle, pid })
    }

    pub fn exited(&self) -> bool {
        // SAFETY: the handle is valid as long as `self` exists.
        let r = unsafe { WaitForSingleObject(self.handle, 0) };
        if r == WAIT_FAILED {
            // We do not assume the process is alive: trace, then polling.
            crate::log("avertissement : attente du processus suivi impossible, sondage de secours");
            return !exists(self.pid);
        }
        r == WAIT_OBJECT_0
    }
}

/// Has the followed process ended? Without a handle (OpenProcess refused), the
/// existence of the process is polled.
pub fn has_exited(watch: Option<&Watch>, pid: u32) -> bool {
    match watch {
        Some(w) => w.exited(),
        None => !exists(pid),
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        // SAFETY: handle opened by `new`, closed only once here.
        unsafe {
            let _ = CloseHandle(self.handle);
        }
    }
}
