# Capture du son d'une seule application (et de ses sous-processus).
#
# Windows 10 (version 2004 et plus) et Windows 11 savent enregistrer la sortie
# audio d'un seul processus (« process loopback »). Sillon s'en sert pour
# n'analyser que le lecteur suivi (Spotify, navigateur…) et ignorer le reste :
# chat vocal (Discord, TeamSpeak), notifications, jeux.
#
# Sortie standard : son brut, mono, 48 000 Hz, entiers 16 bits (petit-boutiste).
# Erreur standard : une ligne « ERR <code> <message> » en cas d'échec.
# Codes de sortie : 2 = capture impossible (Windows trop ancien…),
#                   3 = l'application suivie s'est fermée,
#                   4 = application introuvable.

param([Parameter(Mandatory = $true)][string]$Name)

$ErrorActionPreference = 'Stop'

if ($Name -notmatch '^[\w.\- ]+\.exe$') {
    [Console]::Error.WriteLine("ERR 4 nom de programme refusé")
    exit 4
}

# Processus racine de l'application : celui dont le parent ne porte pas le même
# nom (Spotify et les navigateurs lancent plusieurs processus).
$procs = @(Get-CimInstance Win32_Process -Filter "Name='$Name'")
if (-not $procs.Count) {
    [Console]::Error.WriteLine("ERR 4 $Name n'est pas lancé")
    exit 4
}
$ids = $procs | ForEach-Object { $_.ProcessId }
$root = $procs | Where-Object { $ids -notcontains $_.ParentProcessId } | Select-Object -First 1
if (-not $root) { $root = $procs[0] }

$code = @'
using System;
using System.IO;
using System.Diagnostics;
using System.Threading;
using System.Runtime.InteropServices;

public static class SillonAppLoopback
{
    [StructLayout(LayoutKind.Sequential)]
    struct ActivationParams { public int ActivationType; public uint TargetProcessId; public int ProcessLoopbackMode; }

    [StructLayout(LayoutKind.Sequential)]
    struct Blob { public int cbSize; public IntPtr pBlobData; }

    [StructLayout(LayoutKind.Explicit)]
    struct PropVariant { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public Blob blob; }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    struct WaveFormatEx
    {
        public ushort wFormatTag; public ushort nChannels; public uint nSamplesPerSec; public uint nAvgBytesPerSec;
        public ushort nBlockAlign; public ushort wBitsPerSample; public ushort cbSize;
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        void Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, [In] ref WaveFormatEx format, IntPtr sessionGuid);
        void GetBufferSize(out uint frames);
        void GetStreamLatency(out long latency);
        void GetCurrentPadding(out uint padding);
        void IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
        void GetMixFormat(out IntPtr format);
        void GetDevicePeriod(out long def, out long min);
        void Start();
        void Stop();
        void Reset();
        void SetEventHandle(IntPtr handle);
        void GetService([MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        void GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        void ReleaseBuffer(uint frames);
        void GetNextPacketSize(out uint frames);
    }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceAsyncOperation
    {
        void GetActivateResult(out int hr, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceCompletionHandler
    {
        void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op);
    }

    [ComImport, Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAgileObject { }

    class Handler : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public readonly ManualResetEvent Done = new ManualResetEvent(false);
        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op) { Done.Set(); }
    }

    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
    static extern void ActivateAudioInterfaceAsync([MarshalAs(UnmanagedType.LPWStr)] string path,
        [MarshalAs(UnmanagedType.LPStruct)] Guid riid, IntPtr activationParams,
        IActivateAudioInterfaceCompletionHandler handler, out IActivateAudioInterfaceAsyncOperation op);

    const int RATE = 48000;
    static int exitCode = 0;

    public static int Run(uint pid)
    {
        // Les objets audio de Windows préfèrent un thread MTA.
        var t = new Thread(() => { exitCode = Capture(pid); });
        t.SetApartmentState(ApartmentState.MTA);
        t.Start();
        t.Join();
        return exitCode;
    }

    static void Fail(int code, string msg) { Console.Error.WriteLine("ERR " + code + " " + msg); Console.Error.Flush(); }

    static int Capture(uint pid)
    {
        IAudioClient client;
        try
        {
            var p = new ActivationParams { ActivationType = 1, TargetProcessId = pid, ProcessLoopbackMode = 0 }; // 1 = loopback d'un processus, 0 = lui et ses enfants
            IntPtr pParams = Marshal.AllocHGlobal(Marshal.SizeOf(p));
            Marshal.StructureToPtr(p, pParams, false);
            var pv = new PropVariant { vt = 65, blob = new Blob { cbSize = Marshal.SizeOf(p), pBlobData = pParams } }; // VT_BLOB
            IntPtr pPv = Marshal.AllocHGlobal(Marshal.SizeOf(pv));
            Marshal.StructureToPtr(pv, pPv, false);

            var handler = new Handler();
            IActivateAudioInterfaceAsyncOperation op;
            ActivateAudioInterfaceAsync("VAD\\Process_Loopback", typeof(IAudioClient).GUID, pPv, handler, out op);
            if (!handler.Done.WaitOne(5000)) { Fail(2, "activation sans réponse"); return 2; }
            int hr; object iface;
            op.GetActivateResult(out hr, out iface);
            if (hr != 0 || iface == null) { Fail(2, "activation refusée 0x" + hr.ToString("X8")); return 2; }
            client = (IAudioClient)iface;

            var fmt = new WaveFormatEx { wFormatTag = 1, nChannels = 2, nSamplesPerSec = RATE, wBitsPerSample = 16, nBlockAlign = 4, nAvgBytesPerSec = RATE * 4, cbSize = 0 };
            // LOOPBACK | EVENTCALLBACK | AUTOCONVERTPCM | SRC_DEFAULT_QUALITY
            uint flags = 0x00020000 | 0x00040000 | 0x80000000 | 0x08000000;
            client.Initialize(0, flags, 200000, 0, ref fmt, IntPtr.Zero);
        }
        catch (Exception e) { Fail(2, e.Message); return 2; }

        object svc;
        client.GetService(typeof(IAudioCaptureClient).GUID, out svc);
        var capture = (IAudioCaptureClient)svc;
        var ready = new AutoResetEvent(false);
        client.SetEventHandle(ready.SafeWaitHandle.DangerousGetHandle());
        client.Start();

        Process target = null;
        try { target = Process.GetProcessById((int)pid); } catch { }
        Stream output = Console.OpenStandardOutput();
        byte[] outBuf = new byte[RATE * 2]; // une seconde de mono 16 bits, largement assez
        var lastCheck = DateTime.UtcNow;
        try
        {
            while (true)
            {
                ready.WaitOne(100);
                uint packet;
                capture.GetNextPacketSize(out packet);
                int n = 0;
                while (packet > 0)
                {
                    IntPtr data; uint frames, bufFlags; ulong a, b;
                    capture.GetBuffer(out data, out frames, out bufFlags, out a, out b);
                    bool silent = (bufFlags & 2) != 0;
                    for (int i = 0; i < frames && n + 2 <= outBuf.Length; i++)
                    {
                        int v = 0;
                        if (!silent)
                        {
                            short l = Marshal.ReadInt16(data, i * 4), r = Marshal.ReadInt16(data, i * 4 + 2);
                            v = (l + r) / 2;
                        }
                        outBuf[n++] = (byte)(v & 0xFF);
                        outBuf[n++] = (byte)((v >> 8) & 0xFF);
                    }
                    capture.ReleaseBuffer(frames);
                    capture.GetNextPacketSize(out packet);
                }
                if (n > 0) { output.Write(outBuf, 0, n); output.Flush(); }
                if ((DateTime.UtcNow - lastCheck).TotalSeconds > 1)
                {
                    lastCheck = DateTime.UtcNow;
                    if (target != null && target.HasExited) { Fail(3, "application fermée"); return 3; }
                }
            }
        }
        catch (IOException) { return 0; } // Sillon a fermé le tuyau : fin normale
        finally { try { client.Stop(); } catch { } }
    }
}
'@

try {
    Add-Type -TypeDefinition $code -Language CSharp
} catch {
    [Console]::Error.WriteLine("ERR 2 compilation : $($_.Exception.Message)")
    exit 2
}
exit [SillonAppLoopback]::Run([uint32]$root.ProcessId)
