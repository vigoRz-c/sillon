# Sillon - lecteur des contrôles média de Windows (SMTC)
#
# Lit le morceau en cours via GlobalSystemMediaTransportControlsSessionManager :
# c'est la même source que le panneau média de Windows (volume), donc Spotify,
# un onglet YouTube, VLC... sans compte ni API.
#
# Sortie : une ligne JSON par changement sur stdout.
# Entrée : une commande par ligne sur stdin : playpause | next | previous | play | pause
#          prefer:<texte>  -> session préférée (ex. "prefer:spotify", "prefer:" pour aucune)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($op, [Type]$resultType) {
    $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
    if (-not $task.Wait(3000)) { return $null }
    return $task.Result
}

[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]

$MgrType   = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$PropsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$StreamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
$RepeatType = [Windows.Media.MediaPlaybackAutoRepeatMode, Windows.Media, ContentType = WindowsRuntime]
$AsStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))
$ContentTypeProp = [Windows.Storage.Streams.IContentTypeProvider].GetProperty('ContentType')

# Volume du lecteur seul (mélangeur de volume de Windows, par application) :
# ne touche ni au volume général de Windows ni aux autres applications.
$volumeCode = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class SillonAppVolume
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        void EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        void GetCount(out uint count);
        void Item(uint index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        void Activate([MarshalAs(UnmanagedType.LPStruct)] Guid iid, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        void GetAudioSessionControl(IntPtr guid, int flags, out IntPtr control);
        void GetSimpleAudioVolume(IntPtr guid, int flags, out IntPtr volume);
        void GetSessionEnumerator(out IAudioSessionEnumerator sessions);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        void GetCount(out int count);
        void GetSession(int index, out IAudioSessionControl2 session);
    }

    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        void GetState(out int state);
        void GetDisplayName(out IntPtr name);
        void SetDisplayName(IntPtr name, IntPtr ctx);
        void GetIconPath(out IntPtr path);
        void SetIconPath(IntPtr path, IntPtr ctx);
        void GetGroupingParam(out Guid g);
        void SetGroupingParam(IntPtr g, IntPtr ctx);
        void RegisterAudioSessionNotification(IntPtr n);
        void UnregisterAudioSessionNotification(IntPtr n);
        void GetSessionIdentifier(out IntPtr id);
        void GetSessionInstanceIdentifier(out IntPtr id);
        void GetProcessId(out uint pid);
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISimpleAudioVolume
    {
        void SetMasterVolume(float level, IntPtr ctx);
        void GetMasterVolume(out float level);
        void SetMute(bool mute, IntPtr ctx);
        void GetMute(out bool mute);
    }

    static System.Collections.Generic.List<ISimpleAudioVolume> Find(string exe)
    {
        var found = new System.Collections.Generic.List<ISimpleAudioVolume>();
        string name = exe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? exe.Substring(0, exe.Length - 4) : exe;
        var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        IMMDeviceCollection devices;
        en.EnumAudioEndpoints(0, 1, out devices); // sorties actives
        uint n; devices.GetCount(out n);
        for (uint d = 0; d < n; d++)
        {
            try
            {
                IMMDevice dev; devices.Item(d, out dev);
                object o; dev.Activate(typeof(IAudioSessionManager2).GUID, 23, IntPtr.Zero, out o);
                IAudioSessionEnumerator sessions; ((IAudioSessionManager2)o).GetSessionEnumerator(out sessions);
                int count; sessions.GetCount(out count);
                for (int i = 0; i < count; i++)
                {
                    try
                    {
                        IAudioSessionControl2 s; sessions.GetSession(i, out s);
                        uint pid; s.GetProcessId(out pid);
                        if (pid == 0) continue;
                        string pn;
                        try { pn = Process.GetProcessById((int)pid).ProcessName; } catch { continue; }
                        if (string.Equals(pn, name, StringComparison.OrdinalIgnoreCase)) found.Add((ISimpleAudioVolume)s);
                    }
                    catch { }
                }
            }
            catch { }
        }
        return found;
    }

    // Les objets audio de Windows ne se laissent pas interroger depuis le thread
    // de PowerShell (STA) : chaque appel passe par un thread MTA.
    static T Mta<T>(Func<T> f)
    {
        T result = default(T); Exception err = null;
        var t = new System.Threading.Thread(() => { try { result = f(); } catch (Exception e) { err = e; } });
        t.SetApartmentState(System.Threading.ApartmentState.MTA);
        t.Start(); t.Join();
        if (err != null) throw err;
        return result;
    }

    // Volume 0-100, -1 si l'application n'a pas de son ouvert.
    public static int Get(string exe)
    {
        return Mta(() =>
        {
            foreach (var v in Find(exe))
            {
                float level; v.GetMasterVolume(out level);
                bool mute; v.GetMute(out mute);
                return mute ? 0 : (int)Math.Round(level * 100);
            }
            return -1;
        });
    }

    public static bool Set(string exe, int percent)
    {
        float level = Math.Max(0, Math.Min(100, percent)) / 100f;
        return Mta(() =>
        {
            bool any = false;
            foreach (var v in Find(exe))
            {
                v.SetMasterVolume(level, IntPtr.Zero);
                if (level > 0) v.SetMute(false, IntPtr.Zero);
                any = true;
            }
            return any;
        });
    }
}
'@
$volumeOk = $true
try { Add-Type -TypeDefinition $volumeCode -Language CSharp } catch { $volumeOk = $false }
$volumeExe = ''
$volumeWanted = $null
$lastVolume = $null
$lastVolumeRead = [datetime]::MinValue

function Emit($obj) {
    [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4))
    [Console]::Out.Flush()
}

try {
    $manager = Await ($MgrType::RequestAsync()) $MgrType
} catch {
    Emit @{ type = 'error'; message = "SMTC indisponible : $($_.Exception.Message)" }
    exit 1
}

$prefer = 'spotify'
$lastKey = ''
$lastState = ''
$lastCover = $null
$coverChecks = $null

function Get-Session {
    $sessions = @($manager.GetSessions())
    if ($prefer) {
        $match = $sessions | Where-Object { $_.SourceAppUserModelId -like "*$prefer*" } | Select-Object -First 1
        if ($match) { return $match }
    }
    return $manager.GetCurrentSession()
}

function Read-Cover($props) {
    if (-not $props.Thumbnail) { return $null }
    try {
        $stream = Await ($props.Thumbnail.OpenReadAsync()) $StreamType
        if (-not $stream) { return $null }
        # PowerShell voit le flux comme un __ComObject et refuse de le convertir
        # lui-même : on passe par la réflexion, qui fait la conversion COM.
        $net = $AsStreamForRead.Invoke($null, @($stream))
        $ms = New-Object System.IO.MemoryStream
        $net.CopyTo($ms)
        $net.Dispose()
        $mime = try { $ContentTypeProp.GetValue($stream) } catch { $null }
        if (-not $mime) { $mime = 'image/png' }
        return "data:$mime;base64," + [Convert]::ToBase64String($ms.ToArray())
    } catch { return $null }
}

function Invoke-MediaCommand($cmd) {
    if ($cmd -like 'prefer:*') { $script:prefer = $cmd.Substring(7).Trim().ToLower(); $script:lastKey = ''; return }
    # Volume : on ne garde que la dernière valeur demandée (glissement continu).
    if ($cmd -like 'volume-target:*') { $script:volumeExe = $cmd.Substring(14).Trim(); $script:lastVolume = $null; $script:lastVolumeRead = [datetime]::MinValue; return }
    if ($cmd -like 'volume:*') { $script:volumeWanted = [int]$cmd.Substring(7); return }
    $s = Get-Session
    if (-not $s) { Emit @{ type = 'cmd'; cmd = $cmd; ok = $false; reason = 'aucune session média' }; return }
    # Réponse de Windows (pour le diagnostic) : true = acceptée par le lecteur.
    $ok = switch ($cmd) {
        'playpause' { Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
        'play'      { Await ($s.TryPlayAsync()) ([bool]) }
        'pause'     { Await ($s.TryPauseAsync()) ([bool]) }
        'next'      { Await ($s.TrySkipNextAsync()) ([bool]) }
        'previous'  { Await ($s.TrySkipPreviousAsync()) ([bool]) }
        'shuffle'   {
            $now = [bool]$s.GetPlaybackInfo().IsShuffleActive
            Await ($s.TryChangeShuffleActiveAsync(-not $now)) ([bool])
        }
        'repeat'    {
            # Aucune -> playlist -> morceau -> aucune
            $cur = "$($s.GetPlaybackInfo().AutoRepeatMode)"
            $next = switch ($cur) { 'List' { 'Track' } 'Track' { 'None' } default { 'List' } }
            Await ($s.TryChangeAutoRepeatModeAsync([Enum]::Parse($RepeatType, $next))) ([bool])
        }
    }
    Emit @{ type = 'cmd'; cmd = $cmd; ok = [bool]$ok; app = "$($s.SourceAppUserModelId)" }
}

# [Console]::In.ReadLineAsync() est en réalité bloquant sous Windows PowerShell 5.1
# (lecteur synchronisé) : la boucle restait figée en attendant une commande.
# Un StreamReader sur le flux brut lit vraiment en arrière-plan.
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
$readTask = $stdin.ReadLineAsync()
$lastPoll = [datetime]::MinValue
Emit @{ type = 'ready' }

while ($true) {
    # Commandes en attente (non bloquant)
    while ($readTask.IsCompleted) {
        $line = $readTask.Result
        if ($null -eq $line) { exit 0 }  # le process parent est parti
        try { Invoke-MediaCommand $line.Trim() } catch {}
        $readTask = $stdin.ReadLineAsync()
    }

    # Volume du lecteur : appliqué tout de suite, relu chaque seconde.
    if ($volumeOk -and $volumeExe) {
        try {
            if ($null -ne $volumeWanted) {
                $ok = [SillonAppVolume]::Set($volumeExe, $volumeWanted)
                $lastVolume = if ($ok) { $volumeWanted } else { -1 }
                $volumeWanted = $null
                $lastVolumeRead = Get-Date
                Emit @{ type = 'volume'; exe = $volumeExe; volume = $lastVolume }
            } elseif (((Get-Date) - $lastVolumeRead).TotalMilliseconds -ge 1000) {
                $lastVolumeRead = Get-Date
                $v = [SillonAppVolume]::Get($volumeExe)
                if ($v -ne $lastVolume) { $lastVolume = $v; Emit @{ type = 'volume'; exe = $volumeExe; volume = $v } }
            }
        } catch {}
    }

    # Lecture du morceau toutes les 400 ms (pas à chaque commande reçue).
    if (((Get-Date) - $lastPoll).TotalMilliseconds -lt 400) { [void]$readTask.Wait(50); continue }
    $lastPoll = Get-Date

    try {
        $s = Get-Session
        if (-not $s) {
            if ($lastKey -ne '<none>') { Emit @{ type = 'media'; active = $false }; $lastKey = '<none>'; $lastState = '' }
        } else {
            $props = Await ($s.TryGetMediaPropertiesAsync()) $PropsType
            $info = $s.GetPlaybackInfo()
            $tl = $s.GetTimelineProperties()
            $key = "$($s.SourceAppUserModelId)|$($props.Title)|$($props.Artist)"
            $status = "$($info.PlaybackStatus)"
            $pos = [math]::Round($tl.Position.TotalSeconds, 1)
            $dur = [math]::Round(($tl.EndTime - $tl.StartTime).TotalSeconds, 1)
            $shuffle = [bool]$info.IsShuffleActive
            $repeat = if ($info.AutoRepeatMode) { "$($info.AutoRepeatMode)" } else { 'None' }
            $state = "$status|$pos|$dur|$shuffle|$repeat"

            $trackChanged = $key -ne $lastKey
            $coverChanged = $false
            if ($trackChanged) {
                $lastCover = Read-Cover $props
                # Spotify publie le nouveau titre avant la nouvelle pochette : la
                # première lecture renvoie souvent l'image du morceau précédent.
                # On relit la pochette plusieurs fois dans les secondes qui suivent.
                $coverChecks = [System.Collections.Generic.List[datetime]]::new()
                foreach ($ms in 700, 1500, 3000, 6000, 12000) { $coverChecks.Add((Get-Date).AddMilliseconds($ms)) }
            } elseif ($coverChecks -and $coverChecks.Count -and (Get-Date) -ge $coverChecks[0]) {
                $coverChecks.RemoveAt(0)
                $fresh = Read-Cover $props
                if ($fresh -and $fresh -ne $lastCover) { $lastCover = $fresh; $coverChanged = $true }
            }

            if ($trackChanged -or $coverChanged -or $state -ne $lastState) {
                $msg = @{
                    type     = 'media'
                    active   = $true
                    app      = "$($s.SourceAppUserModelId)"
                    title    = "$($props.Title)"
                    artist   = "$($props.Artist)"
                    album    = "$($props.AlbumTitle)"
                    status   = $status
                    shuffle  = $shuffle
                    repeat   = $repeat
                    position = $pos
                    duration = $dur
                    updated  = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
                }
                if ($trackChanged) { $msg.cover = $lastCover; $msg.newTrack = $true }
                elseif ($coverChanged) { $msg.cover = $lastCover; $msg.coverUpdate = $true }
                Emit $msg
                $lastKey = $key
                $lastState = $state
            }
        }
    } catch {
        # Une session qui disparaît en plein milieu : on réessaie au tour suivant.
    }
    # Attente : une commande reçue (volume…) réveille la boucle tout de suite.
    [void]$readTask.Wait(400)
}
