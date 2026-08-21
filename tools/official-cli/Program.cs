using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

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
                Console.Error.WriteLine("webgpt: ERROR [CLI_RUNTIME_NOT_FOUND] 找不到官方 CLI 运行时。");
                return 1;
            }

            var child = new Process();
            child.StartInfo = new ProcessStartInfo
            {
                FileName = runtimePath,
                Arguments = BuildArguments(args),
                WorkingDirectory = AppDomain.CurrentDomain.BaseDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };

            var stdout = string.Empty;
            var stderr = string.Empty;
            var stdoutThread = new Thread(new ThreadStart(delegate { stdout = child.StandardOutput.ReadToEnd(); }));
            var stderrThread = new Thread(new ThreadStart(delegate { stderr = child.StandardError.ReadToEnd(); }));
            child.Start();
            stdoutThread.Start();
            stderrThread.Start();
            child.WaitForExit();
            stdoutThread.Join();
            stderrThread.Join();

            if (!string.IsNullOrEmpty(stdout)) Console.Out.Write(stdout);
            if (!string.IsNullOrEmpty(stderr)) Console.Error.Write(stderr);
            Console.Out.Flush();
            Console.Error.Flush();
            var exitCode = child.ExitCode;
            child.Dispose();
            return exitCode;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("webgpt: ERROR [CLI_LAUNCH_FAILED] " + error.Message);
            return 1;
        }
    }

    private static string BuildArguments(string[] userArgs)
    {
        var builder = new StringBuilder();
        builder.Append(Quote("--workbench-official-cli"));
        builder.Append(' ');
        builder.Append(Quote("--"));
        for (var index = 0; index < userArgs.Length; index++)
        {
            builder.Append(' ');
            builder.Append(Quote(userArgs[index]));
        }
        return builder.ToString();
    }

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
