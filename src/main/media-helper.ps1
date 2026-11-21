# Spoti-View - lecteur des contrôles média de Windows (SMTC)
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
        $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
        $ms = New-Object System.IO.MemoryStream
        $net.CopyTo($ms)
        $net.Dispose()
        $mime = if ($stream.ContentType) { $stream.ContentType } else { 'image/png' }
        return "data:$mime;base64," + [Convert]::ToBase64String($ms.ToArray())
    } catch { return $null }
}

function Invoke-MediaCommand($cmd) {
    if ($cmd -like 'prefer:*') { $script:prefer = $cmd.Substring(7).Trim().ToLower(); $script:lastKey = ''; return }
    $s = Get-Session
    if (-not $s) { return }
    switch ($cmd) {
        'playpause' { [void](Await ($s.TryTogglePlayPauseAsync()) ([bool])) }
        'play'      { [void](Await ($s.TryPlayAsync()) ([bool])) }
        'pause'     { [void](Await ($s.TryPauseAsync()) ([bool])) }
        'next'      { [void](Await ($s.TrySkipNextAsync()) ([bool])) }
        'previous'  { [void](Await ($s.TrySkipPreviousAsync()) ([bool])) }
    }
}

$stdin = [Console]::In
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
            $state = "$status|$pos|$dur"

            $trackChanged = $key -ne $lastKey
            if ($trackChanged) { $lastCover = Read-Cover $props }

            if ($trackChanged -or $state -ne $lastState) {
                $msg = @{
                    type     = 'media'
                    active   = $true
                    app      = "$($s.SourceAppUserModelId)"
                    title    = "$($props.Title)"
                    artist   = "$($props.Artist)"
                    album    = "$($props.AlbumTitle)"
                    status   = $status
                    position = $pos
                    duration = $dur
                    updated  = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
                }
                if ($trackChanged) { $msg.cover = $lastCover; $msg.newTrack = $true }
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
