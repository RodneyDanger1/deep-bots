// Two registries share one temporary directory: the instance registry a
// `dev:automation` command reads to find a worktree's app, and the stack
// registry `bun run dev` publishes its ports and pids to. Both are written by
// one developer's dev processes and read by their tooling, so both need the
// same three things, and neither can afford its own version of them:
//
//   - a directory no other account can write, because a planted record names a
//     pid and a port that a mutation command would then treat as this
//     worktree's app;
//   - a write a concurrent reader cannot catch half-finished, because a reader
//     deletes what it cannot parse and would drop a record that was still
//     being written;
//   - a way to tell a live process from a recycled pid, because a record
//     outlives a process killed with SIGKILL.

import { execFileSync } from "node:child_process";
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";

export interface DirectoryOwnership {
  uid: number;
  mode: number;
  symbolicLink: boolean;
}

// Publishing into a directory somebody else controls is worse than not
// publishing at all: they could replace a record with a forged one naming this
// worktree, a live pid and a CDP port of their choosing, and a mutation command
// would treat that port as the named instance it is allowed to drive. So this
// fails closed rather than trusting that `chmod` worked.
export function assertOwnerOnlyDirectory(
  directory: string,
  stats: DirectoryOwnership,
  owner = process.getuid?.(),
): void {
  if (stats.symbolicLink || (owner !== undefined && stats.uid !== owner)) {
    throw new Error(
      `${directory} is not owned by this user, so dev instances will not be published there. ` +
        "Remove it and start `bun run dev` again.",
    );
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new Error(
      `${directory} is accessible to other accounts (mode ${(stats.mode & 0o777).toString(8)}). ` +
        "Remove it and start `bun run dev` again: a registry another account can write lets it choose " +
        "which app an automation command drives.",
    );
  }
}

// SIDs that may own or write the registry on Windows besides this user:
// BUILTIN\Administrators, which owns what an elevated shell creates, and
// LocalSystem, both in the default %LOCALAPPDATA% ACL; and CREATOR OWNER, which
// a record inherits as this user, because this user creates every record.
const WINDOWS_ADMINISTRATORS_SID = "S-1-5-32-544";
const WINDOWS_TRUSTED_WRITER_SIDS = [WINDOWS_ADMINISTRATORS_SID, "S-1-5-18", "S-1-3-0"];

// Rights that let an account replace a record: write and append data, write
// attributes, delete, change permissions, take ownership, and the generic
// write and all bits.
const WINDOWS_WRITE_RIGHTS = "0x500D0156";

// The Windows form of the uid and mode checks: the owner, then every allow
// entry that grants write rights, inherit-only ones too, because a record
// gets its permissions from the entries of this directory. SIDs, not account
// names: names are localized. The path goes through the environment, so
// PowerShell never parses it. An ACL that cannot be read fails closed, like a
// foreign one.
// One PowerShell spawn can be starved by other work on the machine, and a
// timeout there says nothing about the question being asked - a stop that
// cannot read the registry ACL after it already signalled the stack would fail
// with the wrong reason and leave the record behind. Two attempts, each with
// its own budget, keep a transient stall from deciding that answer.
function runPowerShell(args: string[], timeoutMs: number, environment: NodeJS.ProcessEnv = process.env): string {
  let failure: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return execFileSync("powershell.exe", args, {
        encoding: "utf8",
        env: environment,
        timeout: timeoutMs,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

function assertWindowsOwnerOnlyDirectory(directory: string): void {
  let lines: string[];
  try {
    lines = runPowerShell(
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$sid = [System.Security.Principal.SecurityIdentifier]; " +
          "$acl = Get-Acl -LiteralPath $env:OPENBOT_REGISTRY_DIRECTORY; " +
          "$acl.GetOwner($sid).Value; " +
          "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; " +
          "$acl.GetAccessRules($true, $true, $sid) | Where-Object { " +
          "$_.AccessControlType -eq 'Allow' -and " +
          `([int]$_.FileSystemRights -band ${WINDOWS_WRITE_RIGHTS}) } | ForEach-Object { $_.IdentityReference.Value }`,
      ],
      15_000,
      { ...process.env, OPENBOT_REGISTRY_DIRECTORY: directory },
    )
      .trim()
      .split(/\s+/);
  } catch (error) {
    throw new Error(
      `Could not read the permissions of ${directory}, so dev instances will not be published there. ` +
        "Remove it and start `bun run dev` again.",
      { cause: error },
    );
  }
  const [owner, currentUser, ...writers] = lines;
  if (!owner || !currentUser || (owner !== currentUser && owner !== WINDOWS_ADMINISTRATORS_SID)) {
    throw new Error(
      `${directory} is not owned by this user, so dev instances will not be published there. ` +
        "Remove it and start `bun run dev` again.",
    );
  }
  const otherWriters = writers.filter((sid) => sid !== currentUser && !WINDOWS_TRUSTED_WRITER_SIDS.includes(sid));
  if (otherWriters.length > 0) {
    throw new Error(
      `${directory} is writable by other accounts (${otherWriters.join(", ")}). ` +
        "Remove it and start `bun run dev` again: a registry another account can write lets it choose " +
        "which app an automation command drives.",
    );
  }
}

export function assertRegistryDirectoryOwnership(directory: string): void {
  const stats = lstatSync(directory);
  if (process.platform === "win32") {
    if (stats.isSymbolicLink()) {
      throw new Error(
        `${directory} is not owned by this user, so dev instances will not be published there. ` +
          "Remove it and start `bun run dev` again.",
      );
    }
    assertWindowsOwnerOnlyDirectory(directory);
    return;
  }
  assertOwnerOnlyDirectory(directory, {
    uid: stats.uid,
    mode: stats.mode,
    symbolicLink: stats.isSymbolicLink(),
  });
}

// Owner-only, because the path is predictable and shared: on a multi-account
// Linux box the default 0755/0644 would let any local user read which worktree
// and profile a developer has open. `chmod` after `mkdir` covers a directory
// that already existed with wider modes; it can only fail when the directory
// belongs to someone else, and then the assertion below fails anyway.
export function ensureOwnerOnlyDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    chmodSync(directory, 0o700);
  } catch {
    // Not ours to tighten - asserted below, which is what fails closed.
  }
  assertRegistryDirectoryOwnership(directory);
}

// Written through a sibling and renamed into place. A plain write truncates
// first, and a reader that hits that window sees an unparseable file and
// deletes it as corrupt - which would leave a dev process that just started
// undiscoverable until it restarts. `rename` within one directory is atomic, so
// a reader sees either the old record or the whole new one.
//
// Unlink first, then create exclusively: `wx` refuses to follow a pre-created
// symlink, so a leftover or planted staging path cannot redirect this write
// outside the registry. Unlinking a symlink removes the link, not its target.
export function writeRegistryFile(target: string, contents: string): void {
  const staging = `${target}.${process.pid}.tmp`;
  rmSync(staging, { force: true });
  const handle = openSync(staging, "wx", 0o600);
  try {
    writeFileSync(handle, contents, "utf8");
  } finally {
    closeSync(handle);
  }
  renameSync(staging, target);
}

export function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 checks for the process without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// `startedAt` is `Date.now()` taken right after `spawn`, so the process behind
// an honest record always started at or before it. `ps` reports whole seconds,
// which can only round downwards, and the grace covers a clock the developer
// nudged between the two readings.
const PROCESS_START_GRACE_MS = 2_000;

// Signal 0 proves only that *something* holds that pid. A dev process killed
// with SIGKILL leaves its record behind, pids get recycled, and an unrelated
// process inheriting 4242 would keep that record - and the ports beside it -
// looking like this worktree's live dev stack. Comparing when the process
// actually started separates them: a recycled pid always started after the
// record was written.
export function isRecordedProcess(record: { startedAt: number }, processStartedAt: number | null): boolean {
  // Unverifiable, so this cannot be the fail-closed check on its own: `ps` is
  // absent on Windows and can be denied. Each registry carries a second check
  // that still refuses a stale claim when the start time is unknown.
  if (processStartedAt === null) return true;
  return processStartedAt <= record.startedAt + PROCESS_START_GRACE_MS;
}

// Wall-clock start of a live process, or null when it cannot be read. `lstart`
// is a full local timestamp on both macOS and Linux; Windows has no `ps` of
// this kind, so PowerShell answers the same question there. A stop command
// refuses to signal a pid this cannot date, so returning null is safe but not
// free: it costs the developer the command.
export function readProcessStartedAt(pid: number): number | null {
  if (process.platform === "win32") return readWindowsProcessStartedAt(pid);
  try {
    const reported = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const parsed = Date.parse(reported);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

export function isLiveRecordedProcess(entry: { pid: number; startedAt: number }): boolean {
  if (!isProcessAlive(entry.pid)) return false;
  return isRecordedProcess(entry, readProcessStartedAt(entry.pid));
}

function readWindowsProcessStartedAt(pid: number): number | null {
  try {
    const reported = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`,
      ],
      { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const parsed = Date.parse(reported);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

export type RecordedProcessState = "live" | "gone" | "unverified";

// The fail-closed half of `isRecordedProcess`, for the caller that is about to
// *signal* the pid rather than read it. Discovery can accept an unknown start
// time and be wrong about which app it drives; a stop command cannot, because
// being wrong there means sending SIGTERM to whatever unrelated program
// inherited that pid. "unverified" is not "live": it is the answer the caller
// has to handle, by leaving the process alone and saying so.
export function verifyRecordedProcess(
  entry: { pid: number; startedAt: number },
  readStartedAt: (pid: number) => number | null = readProcessStartedAt,
): RecordedProcessState {
  if (!isProcessAlive(entry.pid)) return "gone";
  const startedAt = readStartedAt(entry.pid);
  if (startedAt === null) return "unverified";
  return isRecordedProcess(entry, startedAt) ? "live" : "gone";
}

// Windows has no process groups. An orphan keeps its ParentProcessId, so the
// nearest question is whether a process the leader started still runs. Windows
// reuses pids soon: when another process holds the pid now, only children
// older than that process can be the leader's.
function hasWindowsChildProcess(pid: number): boolean {
  try {
    const reported = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$parent = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; ` +
          `$children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = ${pid}"); ` +
          "if ($parent) { $children = @($children | Where-Object { $_.CreationDate -lt $parent.CreationDate }) }; " +
          "$children.Count",
      ],
      { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return Number(reported) > 0;
  } catch {
    return false;
  }
}

// Whether *anything* is left in the process group a detached child leads. A
// group outlives its leader: electron-vite exits, and the Electron it started
// keeps the renderer port. Signal 0 to the negated pid asks about the group,
// and EPERM is a yes - the group exists and belongs to somebody else.
export function isProcessGroupAlive(pid: number, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === "win32") return hasWindowsChildProcess(pid);
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

// The descendants a dead leader left behind, by pid. Windows cannot signal a
// group, so `dev:stop` can only stop the app it started if it can name the
// pids, and the recorded leader is gone by the time the Electron behind
// electron-vite still holds the renderer port. Parent links are what is left:
// Windows keeps `ParentProcessId` after the parent dies, so the tree below the
// recorded pid still describes what that pid started.
//
// Attribution, not a pattern. A pid is ours only when it descends from the
// recorded leader *and* started at or after that leader did; a recycled pid's
// children predate the record when the record is the newer claim, and those
// stay untouched. `leaderVerified` says the caller has matched this pid to the
// record by start time, so the tree below it is the tree that leader started
// even while the leader is still alive. Without that proof the pid may name a
// stranger now, and only a dead leader can vouch for its own children: a
// process cannot create one after it exited.
// `null` is "could not read", which is not the same answer as "nothing is
// left": a stop command that treats a starved `Get-CimInstance` as an empty
// process tree leaves a port held and reports success.
export function attributableDescendantPids(
  entry: { pid: number; startedAt: number },
  leaderVerified = false,
  platform: NodeJS.Platform = process.platform,
): number[] | null {
  if (platform !== "win32") return [];
  if (!leaderVerified && isProcessAlive(entry.pid)) return [];
  let reported: string;
  try {
    reported = runPowerShell(
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$root = " +
          String(entry.pid) +
          "; $queue = [System.Collections.Generic.Queue[int]]::new(); $queue.Enqueue($root); " +
          "$seen = [System.Collections.Generic.HashSet[int]]::new(); $out = @(); " +
          "while ($queue.Count -gt 0) { $p = $queue.Dequeue(); " +
          "if (-not $seen.Add($p)) { continue }; " +
          "$kids = @(Get-CimInstance Win32_Process -Filter \"ParentProcessId = $p\"); " +
          "foreach ($k in $kids) { $id = [int]$k.ProcessId; if ($seen.Contains($id)) { continue }; " +
          "$ms = [int64]($k.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds; " +
          "$out += \"$id $ms\"; $queue.Enqueue($id) } }; $out -join \"`n\"",
      ],
      20_000,
    ).trim();
  } catch {
    // Unreadable: the caller keeps its refusal rather than guessing at pids.
    return null;
  }
  const pids: number[] = [];
  for (const line of reported.split(/\r?\n/u)) {
    const match = /^(\d+)\s+(\d+)$/u.exec(line.trim());
    if (!match) continue;
    const pid = Number(match[1]);
    const createdAt = Number(match[2]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (!Number.isFinite(createdAt)) continue;
    if (createdAt + PROCESS_START_GRACE_MS < entry.startedAt) continue;
    pids.push(pid);
  }
  return pids;
}
