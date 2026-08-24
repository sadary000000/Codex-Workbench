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
        // The runtime writes the public result to the explicit temp files above.
        // Do not inherit the CLI process' stdout/stderr handles here: Electron
        // creates a process tree, and an inherited execFile pipe can remain open
        // after the command has already produced its result.
        var startup = new StartupInfo
        {
            Size = Marshal.SizeOf(typeof(StartupInfo)),
        };
        var commandLine = new StringBuilder(Quote(runtimePath) + " " + runtimeArguments);
        ProcessInformation process;
        if (!CreateProcess(runtimePath, commandLine, IntPtr.Zero, IntPtr.Zero, false, CreateNoWindow, IntPtr.Zero, AppDomain.CurrentDomain.BaseDirectory, ref startup, out process))
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

    private const uint CreateNoWindow = 0x08000000;
    private const uint Infinite = 0xFFFFFFFF;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CreateProcess(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref StartupInfo startupInfo, out ProcessInformation processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

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
