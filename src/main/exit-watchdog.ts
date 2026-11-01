// Node ends the process only after every libuv request has finished. A file request that the kernel
// never answers holds every exit path in `node::FreeEnvironment` for ever, `app.exit` of the shutdown
// deadline included: an `open` that waits for a macOS privacy approval that nobody answers is one.
// No JavaScript timer runs there, and Node stops worker threads before it waits. The process then
// keeps the single-instance lock, so every later launch exits without opening anything.
//
// One independent watchdog process covers that state on every platform. It is spawned from the
// `exit` event, waits the limit, and ends the main process only when that process is still there and
// its start time is the one recorded here: a process id the system gave to another process since is
// never stopped.
import { spawn } from "node:child_process";
import { join } from "node:path";

/** How long the process may stay after its exit event before the watchdog ends it. */
export const EXIT_LIMIT_SECONDS = 10;
const FILE_REQUESTS = new Set(["FSReqCallback", "FSReqPromise"]);
/**
 * `performance.timeOrigin` is a little later than the kernel's creation time of the same process,
 * and a little earlier on a step where the clock moved. A process id that the system reused belongs
 * to a process that was created after this run's exit, which the upper bound rejects exactly.
 */
const START_TIME_EARLY_MS = 2_000;
const START_TIME_LATE_MS = 1_000;

/**
 * $0 is the process id, $1 the limit, $2 the main log and $3 the open file requests at exit. The start
 * time makes sure that a process id the system gave to another process since is not stopped. The kill
 * comes before the log write: the write can wait for the same approval as the stuck request.
 */
const POSIX_WATCHDOG_SCRIPT = [
  'start=$(ps -o lstart= -p "$0") || exit 0',
  'sleep "$1"',
  '[ "$(ps -o lstart= -p "$0" 2>/dev/null)" = "$start" ] || exit 0',
  'kill -9 "$0"',
  'mkdir -p "$(dirname "$2")"',
  'printf \'%s WARN [main] OpenBot did not exit within %s s with %s open file requests and was stopped.\\n\' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$3" >> "$2"',
].join("\n");

export interface ExitWatchdogRequest {
  platform: NodeJS.Platform;
  /** The process to end when it is still there after the limit. */
  pid: number;
  /** `performance.timeOrigin` of that process, in whole Unix milliseconds. */
  startTimeUnixMs: number;
  /** `Date.now()` of that process at its `exit` event, in Unix milliseconds. */
  exitTimeUnixMs: number;
  limitSeconds: number;
  /** The main log file, written only when the watchdog actually ends a process. */
  logPath: string;
  /** The open file requests at exit, which the log line reports. */
  fileRequests: number;
}

/**
 * Starts a detached watchdog when Node exits. It stops the process after the limit only when the
 * process is still there and its start time matches, and adds one line to the main log. `exit` comes
 * on `app.quit`, `app.exit` and `process.exit`.
 */
export function stopStuckExitAfterLimit(logsDirectory: string): void {
  process.once("exit", () => {
    const fileRequests = process.getActiveResourcesInfo().filter((name) => FILE_REQUESTS.has(name)).length;
    startExitWatchdog({
      platform: process.platform,
      pid: process.pid,
      startTimeUnixMs: Math.floor(performance.timeOrigin),
      exitTimeUnixMs: Date.now(),
      limitSeconds: EXIT_LIMIT_SECONDS,
      logPath: join(logsDirectory, "main", "main.log"),
      fileRequests,
    });
  });
}

/**
 * Runs the watchdog once for one process. Exported so the fault-injection gate can point it at a
 * process it started, with the start and exit times it read itself. A failure to start the watchdog
 * is swallowed on purpose: a throw here would be an uncaught exception during exit, and the exit it
 * watches is already under way.
 */
export function startExitWatchdog(request: ExitWatchdogRequest): void {
  try {
    const command = request.platform === "win32" ? windowsWatchdog(request) : posixWatchdog(request);
    spawn(command.executable, command.arguments, { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {
    // The exit proceeds without a watchdog, as it did before this module existed.
  }
}

function posixWatchdog(request: ExitWatchdogRequest): { executable: string; arguments: string[] } {
  return {
    executable: "/bin/sh",
    arguments: [
      "-c",
      POSIX_WATCHDOG_SCRIPT,
      String(request.pid),
      String(request.limitSeconds),
      request.logPath,
      String(request.fileRequests),
    ],
  };
}

/**
 * Windows has no `/bin/sh`. `-EncodedCommand` takes the values as one UTF-16LE string, so a path
 * with a quote, a space or a non-ASCII character needs no shell quoting. `Get-Process` is the only
 * reader of a process start time that Windows PowerShell 5.1 has without WMI.
 *
 * `cmd.exe` launches it because PowerShell exits at once when Windows creates it detached: its
 * `-Command`, and every argument of it, is skipped. `cmd` runs the same command line and waits for
 * PowerShell. Its own process is the one the app leaves behind, so a `cmd` that a policy refuses
 * still leaves the quit exactly as it was before this module existed.
 */
function windowsWatchdog(request: ExitWatchdogRequest): { executable: string; arguments: string[] } {
  const encoded = Buffer.from(windowsWatchdogScript(request), "utf16le").toString("base64");
  return {
    executable: "cmd.exe",
    arguments: [
      "/d",
      "/s",
      "/c",
      `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand ${encoded}`,
    ],
  };
}

/** The PowerShell the Windows watchdog runs. Exported for the fault-injection gate. */
export function windowsWatchdogScript(request: ExitWatchdogRequest): string {
  const logPath = quotePowerShell(request.logPath);
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$watchPid = ${request.pid}`,
    `$expectedStartMs = ${request.startTimeUnixMs}`,
    `$exitedAtMs = ${request.exitTimeUnixMs}`,
    `Start-Sleep -Seconds ${request.limitSeconds}`,
    "$watchProcess = Get-Process -Id $watchPid",
    "if ($null -eq $watchProcess) { exit 0 }",
    "$actualStartMs = ([DateTimeOffset]($watchProcess.StartTime.ToUniversalTime())).ToUnixTimeMilliseconds()",
    `if ($actualStartMs -lt ($expectedStartMs - ${START_TIME_EARLY_MS})) { exit 0 }`,
    `if ($actualStartMs -gt ($exitedAtMs + ${START_TIME_LATE_MS})) { exit 0 }`,
    "Stop-Process -Id $watchPid -Force",
    `$logDirectory = [System.IO.Path]::GetDirectoryName(${logPath})`,
    "if (-not (Test-Path -LiteralPath $logDirectory)) { New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null }",
    `Add-Content -LiteralPath ${logPath} -Value ((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') + ${quotePowerShell(
      ` WARN [main] OpenBot did not exit within ${request.limitSeconds} s with ${request.fileRequests} open file requests and was stopped.`,
    )})`,
  ].join("\n");
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
