using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

internal static class Program
{
    private const string RuntimeExecutableName = "Codex Workbench CLI Runtime.exe";

    private static int Main(string[] args)
    {
        try
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            var runtimePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, RuntimeExecutableName);
            if (!File.Exists(runtimePath))
            {
                WriteFailure(args, "NOT_FOUND", "找不到官方 CLI 运行时。", "verify_target");
                return 1;
            }

            var stdoutPath = Path.Combine(Path.GetTempPath(), "codex-workbench-cli-" + Guid.NewGuid().ToString("N") + ".stdout");
            var stderrPath = Path.Combine(Path.GetTempPath(), "codex-workbench-cli-" + Guid.NewGuid().ToString("N") + ".stderr");

            try
            {
                var exitCode = RunRuntime(runtimePath, BuildArguments(args, stdoutPath, stderrPath));
                var stdout = ReadOutputFile(stdoutPath);
                var stderr = ReadOutputFile(stderrPath);
                if (!string.IsNullOrEmpty(stdout)) Console.Out.Write(stdout);
                if (!string.IsNullOrEmpty(stderr)) Console.Error.Write(stderr);
                Console.Out.Flush();
                Console.Error.Flush();
                return exitCode;
            }
            finally
            {
                TryDelete(stdoutPath);
                TryDelete(stderrPath);
            }
        }
        catch (Exception)
        {
            WriteFailure(args, "INTERNAL_ERROR", "官方 CLI 运行时启动失败。", "inspect_diagnostics");
            return 1;
        }
    }

    private static string ReadOutputFile(string path)
    {
        try { return File.Exists(path) ? File.ReadAllText(path, new UTF8Encoding(false)) : string.Empty; }
        catch (IOException) { return string.Empty; }
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch (IOException) { }
    }

    private static void WriteFailure(string[] args, string code, string message, string userAction)
    {
        if (Array.IndexOf(args, "--json") >= 0)
        {
            var json = "{\"version\":1,\"requestId\":\"" + Guid.NewGuid().ToString() + "\",\"ok\":false,\"command\":\"webgpt\",\"error\":{\"code\":\"" + JsonEscape(code) + "\",\"message\":\"" + JsonEscape(message) + "\",\"retryable\":false,\"userAction\":\"" + JsonEscape(userAction) + "\"}}\n";
            Console.Out.Write(json);
            Console.Out.Flush();
            return;
        }
        Console.Error.WriteLine("webgpt: ERROR [" + code + "] " + message);
    }

    private static string JsonEscape(string value)
    {
        var builder = new StringBuilder();
        foreach (var character in value)
        {
            switch (character)
            {
                case '\\': builder.Append("\\\\"); break;
                case '"': builder.Append("\\\""); break;
                case '\n': builder.Append("\\n"); break;
                case '\r': builder.Append("\\r"); break;
                case '\t': builder.Append("\\t"); break;
                default: builder.Append(character); break;
            }
        }
        return builder.ToString();
    }

    private static string BuildArguments(string[] userArgs, string stdoutPath, string stderrPath)
    {
        var builder = new StringBuilder();
        for (var index = 0; index < userArgs.Length; index++)
        {
            var value = userArgs[index];
            if (value == "--disable-gpu" || value.StartsWith("--user-data-dir=", StringComparison.Ordinal))
            {
                builder.Append(Quote(value));
                builder.Append(' ');
            }
        }
        builder.Append(Quote("--workbench-cli-stdout=" + stdoutPath));
        builder.Append(' ');
        builder.Append(Quote("--workbench-cli-stderr=" + stderrPath));
        builder.Append(' ');
        builder.Append(Quote("--workbench-official-cli"));
        builder.Append(' ');
        builder.Append(Quote("--"));
        for (var index = 0; index < userArgs.Length; index++)
        {
            if (userArgs[index] == "--disable-gpu" || userArgs[index].StartsWith("--user-data-dir=", StringComparison.Ordinal)) continue;
            builder.Append(' ');
            builder.Append(Quote(userArgs[index]));
        }
        return builder.ToString();
    }

    private static int RunRuntime(string runtimePath, string runtimeArguments)
    {
        var security = new SecurityAttributes
        {
            Length = Marshal.SizeOf(typeof(SecurityAttributes)),
            InheritHandle = 1,
        };
        var nulInput = CreateFile("NUL", GenericRead, FileShareRead | FileShareWrite, ref security, OpenExisting, 0, IntPtr.Zero);
        var nulOutput = CreateFile("NUL", GenericWrite, FileShareRead | FileShareWrite, ref security, OpenExisting, 0, IntPtr.Zero);
        var nulError = CreateFile("NUL", GenericWrite, FileShareRead | FileShareWrite, ref security, OpenExisting, 0, IntPtr.Zero);
        if (IsInvalidHandle(nulInput) || IsInvalidHandle(nulOutput) || IsInvalidHandle(nulError))
        {
            CloseHandle(nulInput);
            CloseHandle(nulOutput);
            CloseHandle(nulError);
            throw new Win32Exception(Marshal.GetLastWin32Error(), "无法打开 NUL 标准句柄。");
        }

        try
        {
            DisableStandardHandleInheritance();
            var startup = new StartupInfo
            {
                Size = Marshal.SizeOf(typeof(StartupInfo)),
                Flags = StartfUseStdHandles,
                StandardInput = nulInput,
                StandardOutput = nulOutput,
                StandardError = nulError,
            };
            var commandLine = new StringBuilder(Quote(runtimePath) + " " + runtimeArguments);
            ProcessInformation process;
            if (!CreateProcess(runtimePath, commandLine, IntPtr.Zero, IntPtr.Zero, true, CreateNoWindow, IntPtr.Zero, AppDomain.CurrentDomain.BaseDirectory, ref startup, out process))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "官方 CLI 运行时启动失败。");
            }
            try
            {
                WaitForSingleObject(process.ProcessHandle, Infinite);
                uint exitCode;
                if (!GetExitCodeProcess(process.ProcessHandle, out exitCode)) throw new Win32Exception(Marshal.GetLastWin32Error(), "无法读取官方 CLI 退出码。");
                return unchecked((int)exitCode);
            }
            finally
            {
                CloseHandle(process.ThreadHandle);
                CloseHandle(process.ProcessHandle);
            }
        }
        finally
        {
            CloseHandle(nulInput);
            CloseHandle(nulOutput);
            CloseHandle(nulError);
        }
    }

    private static bool IsInvalidHandle(IntPtr handle) { return handle == IntPtr.Zero || handle == new IntPtr(-1); }

    private static void DisableStandardHandleInheritance()
    {
        foreach (var handle in new[] { GetStdHandle(StandardInputHandle), GetStdHandle(StandardOutputHandle), GetStdHandle(StandardErrorHandle) })
        {
            if (!IsInvalidHandle(handle)) SetHandleInformation(handle, HandleFlagInherit, 0);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes
    {
        public int Length;
        public IntPtr SecurityDescriptor;
        public int InheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int Size;
        public string Reserved;
        public string Desktop;
        public string Title;
        public int X;
        public int Y;
        public int XSize;
        public int YSize;
        public int XCountChars;
        public int YCountChars;
        public int FillAttribute;
        public int Flags;
        public short ShowWindow;
        public short Reserved2;
        public IntPtr Reserved2Pointer;
        public IntPtr StandardInput;
        public IntPtr StandardOutput;
        public IntPtr StandardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr ProcessHandle;
        public IntPtr ThreadHandle;
        public uint ProcessId;
        public uint ThreadId;
    }

    private const uint GenericRead = 0x80000000;
    private const uint GenericWrite = 0x40000000;
    private const uint FileShareRead = 0x00000001;
    private const uint FileShareWrite = 0x00000002;
    private const uint OpenExisting = 3;
    private const int StartfUseStdHandles = 0x00000100;
    private const uint CreateNoWindow = 0x08000000;
    private const uint Infinite = 0xFFFFFFFF;
    private const int StandardInputHandle = -10;
    private const int StandardOutputHandle = -11;
    private const int StandardErrorHandle = -12;
    private const uint HandleFlagInherit = 0x00000001;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFile(string name, uint desiredAccess, uint shareMode, ref SecurityAttributes securityAttributes, uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CreateProcess(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref StartupInfo startupInfo, out ProcessInformation processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int standardHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

    private static string Quote(string value)
    {
        if (value.Length == 0) return "\"\"";
        var builder = new StringBuilder();
        builder.Append('"');
        var backslashes = 0;
        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];
            if (character == '\\')
            {
                backslashes++;
                continue;
            }
            if (character == '"')
            {
                builder.Append(new string('\\', backslashes * 2 + 1));
                builder.Append('"');
                backslashes = 0;
                continue;
            }
            if (backslashes > 0) builder.Append(new string('\\', backslashes));
            builder.Append(character);
            backslashes = 0;
        }
        if (backslashes > 0) builder.Append(new string('\\', backslashes * 2));
        builder.Append('"');
        return builder.ToString();
    }
}
