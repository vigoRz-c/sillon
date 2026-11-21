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
Emit @{ type = 'ready' }

while ($true) {
    # Commandes en attente (non bloquant)
    while ($readTask.IsCompleted) {
        $line = $readTask.Result
        if ($null -eq $line) { exit 0 }  # le process parent est parti
        try { Invoke-MediaCommand $line.Trim() } catch {}
        $readTask = $stdin.ReadLineAsync()
    }

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
    Start-Sleep -Milliseconds 400
}
