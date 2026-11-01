/**
 * Runtime fault-injection gate for §23.4 of the plan (F1–F10).
 *
 * F1–F10 each name the behaviour the plan requires and its negative control. The parts that need
 * only this repository run here under a plain `node`, with no Electron and no installed packages:
 *
 *   F2  the reload-once policy and the clean-exit filter (the Electron event wiring is read-only)
 *   F3  a kill of a real main-like process leaves a record the next start reports
 *   F4  the Windows stuck-exit watchdog kills by process id and start time, and only then
 *   F8  a startup failure has one stable, quotable code and a log path
 *   F9  a power-loss-like kill is detected and the next clean start repairs the record
 *   F1  runs when `effect` is installed (CI), with a real host process speaking the protocol
 *
 * F5, F6, F7, F10 need the installed app, a full disk or provider fakes. They are reported as
 * `unavailable` with the reason, never as passed. `--require-all` turns any unavailable item into a
 * non-zero result, for a lane that has the pieces.
 *
 *   node scripts/runtime-fault-injection-e2e.ts [--require-all] [--limit=<seconds>]
 *
 * Writes `.openbot-build/runtime-faults/report.json`.
 */
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startExitWatchdog } from "../src/main/exit-watchdog";
import {
  beginRun,
  createRendererRecovery,
  isRecoverableRendererGone,
  mainLogFile,
  markRunComplete,
  readPreviousRun,
  rendererStateCode,
  runStateCode,
  sanitizeFailureMessage,
  startupFailureCode,
} from "../src/main/runtime-health";
import type { AgentDatabaseHostStatus } from "../src/backend/agent-data/agent-database-supervisor";
import type {
  AgentDatabaseHostProcess,
  AgentDatabaseRequest,
  AgentDatabaseResponse,
} from "../src/backend/agent-data/agent-database-protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/runtime-faults");
const HEALTH_URL = pathToFileURL(join(import.meta.dirname, "../src/main/runtime-health.ts")).href;
const args = process.argv.slice(2);
const requireAll = args.includes("--require-all");
const limitArg = args.find((argument) => argument.startsWith("--limit="));
const requestedLimit = limitArg ? Number(limitArg.slice("--limit=".length)) : 2;
const watchdogLimitSeconds = Number.isFinite(requestedLimit) && requestedLimit >= 1 ? Math.floor(requestedLimit) : 2;

type CaseStatus = "passed" | "failed" | "unavailable";

interface FaultCase {
  id: string;
  name: string;
  status: CaseStatus;
  /** What actually ran: a policy, a real process, a helper. */
  level: string;
  expected: string;
  observed: string;
  error?: string;
}

const report: {
  gate: string;
  startedAt: string;
  passed: boolean;
  complete: boolean;
  requireAll: boolean;
  cases: FaultCase[];
  unavailable: { id: string; reason: string }[];
} = {
  gate: "runtime-fault-injection-e2e",
  startedAt: new Date().toISOString(),
  passed: false,
  complete: false,
  requireAll,
  cases: [],
  unavailable: [],
};

async function runCase(
  id: string,
  name: string,
  level: string,
  expected: string,
  body: () => Promise<string>,
): Promise<void> {
  try {
    const observed = await body();
    report.cases.push({ id, name, status: "passed", level, expected, observed });
    process.stdout.write(`PASS ${id} ${name}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.cases.push({ id, name, status: "failed", level, expected, observed: "see error", error: message });
    process.stdout.write(`FAIL ${id} ${name}: ${message}\n`);
  }
}

function unavailable(id: string, reason: string): void {
  report.unavailable.push({ id, reason });
  process.stdout.write(`SKIP ${id}: ${reason}\n`);
}

function wait(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

async function waitFor(condition: () => boolean, label: string, deadlineMs = 10_000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > deadlineMs) throw new Error(`Timed out waiting for ${label}.`);
    await wait(20);
  }
}

/** A child process that uses the production run-state writer, then either exits or is killed. */
const RUN_CHILD = `
(async () => {
  const health = await import(process.env.OPENBOT_HEALTH_URL);
  health.beginRun(process.env.OPENBOT_RUN_STATE, { pid: process.pid, startedAt: new Date().toISOString() });
  if (process.env.OPENBOT_RUN_MODE === "clean") {
    health.markRunComplete(process.env.OPENBOT_RUN_STATE, process.pid, "test-clean");
    process.exit(0);
    return;
  }
  process.kill(process.pid, "SIGKILL");
})().catch((error) => { console.error(error); process.exit(1); });
`;

/** A database host that speaks the supervisor's protocol, in one of two behaviours. */
const DB_HOST = `
const readline = require("node:readline");
const mode = process.env.OPENBOT_DB_HOST_MODE || "echo";
const empty = { columns: [], rows: [], truncated: false, changes: 0, lastInsertRowid: null };
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (mode === "stall") return;
  send({ id: request.id, ok: true, result: empty });
});
`;

async function spawnRunChild(fixture: string, statePath: string, mode: "crash" | "clean"): Promise<number> {
  const child = spawn(process.execPath, [fixture], {
    env: { ...process.env, OPENBOT_HEALTH_URL: HEALTH_URL, OPENBOT_RUN_STATE: statePath, OPENBOT_RUN_MODE: mode },
    stdio: "ignore",
    windowsHide: true,
  });
  const code = await new Promise<number>((done) => child.on("exit", (exitCode) => done(exitCode ?? -1)));
  return code;
}

function windowsStartTimeMs(pid: number): number {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$p = Get-Process -Id ${pid}; ([DateTimeOffset]$p.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()`,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`Could not read the start time of ${pid}: ${result.stderr.trim()}`);
  const value = Number(result.stdout.trim());
  if (!Number.isFinite(value)) throw new Error(`The start time of ${pid} was not a number.`);
  return value;
}

/**
 * Reads the start time of a victim that was just spawned. `Get-Process` can run before the child is
 * visible to the process table, so this retries; a process that never appears is a fixture failure,
 * not a watchdog result.
 */
async function startTimeFor(pid: number): Promise<number> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return windowsStartTimeMs(pid);
    } catch (error) {
      lastError = error;
      await wait(100);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`No start time for ${pid}.`);
}

function victim(code: string): ChildProcess {
  return spawn(process.execPath, ["-e", code], { stdio: "ignore", windowsHide: true });
}

/** The renderer policy, the only part of F2 that does not need a live BrowserWindow. */
function f2Policy(): void {
  let now = 0;
  const recovery = createRendererRecovery({ now: () => now, resetAfterMs: 60_000 });
  recovery.loaded();
  assert.equal(recovery.state().phase, "healthy", "A loaded page is healthy.");
  const first = recovery.fault("render-process-gone");
  assert.equal(first.action, "reload", "The first crash reloads once.");
  assert.equal(first.state.phase, "recovering");
  const second = recovery.fault("render-process-gone");
  assert.equal(second.action, "give-up", "A second crash before a stable page is the named state.");
  assert.equal(rendererStateCode(second.state), "RENDERER-UNRECOVERED");

  const hang = createRendererRecovery({ now: () => now });
  hang.loaded();
  assert.equal(hang.fault("unresponsive").action, "force-and-reload", "A hung page is ended before it reloads.");

  const later = createRendererRecovery({ now: () => now, resetAfterMs: 60_000 });
  later.loaded();
  assert.equal(later.fault("render-process-gone").action, "reload");
  now += 1_000;
  later.loaded();
  now += 61_000;
  assert.equal(later.fault("render-process-gone").action, "reload", "A page stable for a minute gets a reload again.");

  assert.equal(isRecoverableRendererGone("clean-exit"), false, "A clean renderer exit is not a crash.");
  assert.equal(isRecoverableRendererGone("crashed"), true);
  assert.equal(isRecoverableRendererGone("oom"), true);
  assert.equal(createRendererRecovery().state().phase, "healthy", "No fault means no recovery.");
}

async function f4Windows(workRoot: string): Promise<void> {
  const directory = join(workRoot, "watchdog");
  await mkdir(directory, { recursive: true });
  const caseLog = (name: string): string => join(directory, name, "main", "main.log");

  const stuck = victim("setInterval(()=>{},1000)");
  const stuckPid = stuck.pid;
  assert.ok(stuckPid, "The victim has a pid.");
  await wait(400);
  const stuckStart = await startTimeFor(stuckPid);
  const stuckLog = caseLog("stuck");
  startExitWatchdog({
    platform: "win32",
    pid: stuckPid,
    startTimeUnixMs: stuckStart,
    exitTimeUnixMs: Date.now(),
    limitSeconds: watchdogLimitSeconds,
    logPath: stuckLog,
    fileRequests: 3,
  });
  const killed = await Promise.race([
    new Promise<boolean>((done) => stuck.once("exit", () => done(true))),
    wait(watchdogLimitSeconds * 1_000 + 6_000).then(() => false),
  ]);
  assert.equal(killed, true, "A stuck process is ended after the limit.");
  await wait(1_200);
  const logged = existsSync(stuckLog) ? await readFile(stuckLog, "utf8") : "";
  assert.match(logged, /did not exit within \d+ s with 3 open file requests and was stopped\./, logged);
  if (stuck.exitCode === null) stuck.kill("SIGKILL");

  // Negative control: a start time in the future is another process with this id, so no kill.
  const future = victim("setInterval(()=>{},1000)");
  const futurePid = future.pid;
  assert.ok(futurePid);
  await wait(400);
  const futureLog = caseLog("future-start");
  const futureStart = await startTimeFor(futurePid);
  startExitWatchdog({
    platform: "win32",
    pid: futurePid,
    startTimeUnixMs: futureStart + 60_000,
    exitTimeUnixMs: Date.now(),
    limitSeconds: watchdogLimitSeconds,
    logPath: futureLog,
    fileRequests: 0,
  });
  await wait(watchdogLimitSeconds * 1_000 + 2_000);
  assert.equal(future.exitCode, null, "A mismatched start time is not killed.");
  assert.equal(existsSync(futureLog), false, "A mismatched start time writes no watchdog line.");
  future.kill("SIGKILL");

  // Negative control: the process id was reused after this run exited, so the id is not ours.
  const reused = victim("setInterval(()=>{},1000)");
  const reusedPid = reused.pid;
  assert.ok(reusedPid);
  await wait(400);
  const reusedLog = caseLog("reused-id");
  const reusedStart = await startTimeFor(reusedPid);
  startExitWatchdog({
    platform: "win32",
    pid: reusedPid,
    startTimeUnixMs: reusedStart,
    exitTimeUnixMs: Date.now() - 60_000,
    limitSeconds: watchdogLimitSeconds,
    logPath: reusedLog,
    fileRequests: 0,
  });
  await wait(watchdogLimitSeconds * 1_000 + 2_000);
  assert.equal(reused.exitCode, null, "A process created after the exit is not killed.");
  assert.equal(existsSync(reusedLog), false, "A reused id writes no watchdog line.");
  reused.kill("SIGKILL");

  // Negative control: the normal path leaves the process and the log alone. The victim exits before
  // the watchdog's limit, so its exact start time is irrelevant; using the spawn instant avoids a
  // PowerShell start-time read racing that exit.
  const normal = victim("setTimeout(()=>process.exit(0),1500)");
  const normalPid = normal.pid;
  assert.ok(normalPid);
  const normalLog = caseLog("normal-exit");
  startExitWatchdog({
    platform: "win32",
    pid: normalPid,
    startTimeUnixMs: Date.now(),
    exitTimeUnixMs: Date.now(),
    limitSeconds: watchdogLimitSeconds,
    logPath: normalLog,
    fileRequests: 0,
  });
  await wait(watchdogLimitSeconds * 1_000 + 2_000);
  assert.equal(existsSync(normalLog), false, "A normal exit is not stopped and writes nothing.");
  if (normal.exitCode === null) normal.kill("SIGKILL");
}

function dbHostDouble(fixture: string, mode: string): AgentDatabaseHostProcess {
  const child = spawn(process.execPath, [fixture], {
    env: { ...process.env, OPENBOT_DB_HOST_MODE: mode },
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  if (!child.stdin || !child.stdout) throw new Error("The database host fixture has no stdio pipes.");
  const stdin = child.stdin;
  const stdout = child.stdout;
  let response: ((value: AgentDatabaseResponse) => void) | null = null;
  let exitListener: (() => void) | null = null;
  let exited = false;
  const callExit = (): void => {
    if (exited) return;
    exited = true;
    exitListener?.();
  };
  let pending = "";
  stdout.setEncoding("utf8");
  stdout.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof parsed !== "object" || parsed === null || !("id" in parsed) || typeof parsed.id !== "number") continue;
      if ("ok" in parsed && parsed.ok === true) {
        response?.({
          id: parsed.id,
          ok: true,
          result: { columns: [], rows: [], truncated: false, changes: 0, lastInsertRowid: null },
        });
      } else {
        response?.({ id: parsed.id, ok: false, failure: { kind: "internal", message: "The fixture failed." } });
      }
    }
  });
  child.on("exit", callExit);
  child.on("error", callExit);
  return {
    send: (request: AgentDatabaseRequest) => stdin.write(`${JSON.stringify(request)}\n`),
    onExit: (listener) => {
      exitListener = listener;
      if (exited) listener();
    },
    onResponse: (listener) => {
      response = listener;
    },
    kill: () => child.kill("SIGKILL"),
  };
}

interface DbHostModules {
  effect: typeof import("effect");
  supervisor: typeof import("../src/backend/agent-data/agent-database-supervisor");
  protocol: typeof import("../src/backend/agent-data/agent-database-protocol");
}

async function loadDbHostModules(): Promise<DbHostModules | null> {
  try {
    const [effect, supervisor, protocol] = await Promise.all([
      import("effect"),
      import("../src/backend/agent-data/agent-database-supervisor"),
      import("../src/backend/agent-data/agent-database-protocol"),
    ]);
    return { effect, supervisor, protocol };
  } catch {
    return null;
  }
}

/** F1: a real statement call dies and the queued call is dispatched to the fresh host. */
async function f1DbHost(modules: DbHostModules, fixture: string): Promise<void> {
  const { Effect } = modules.effect;
  const hosts: AgentDatabaseHostProcess[] = [];
  const statuses: AgentDatabaseHostStatus[] = [];
  const supervisor = new modules.supervisor.AgentDatabaseSupervisor({
    spawnHost: () => {
      const host = dbHostDouble(fixture, hosts.length === 0 ? "stall" : "echo");
      hosts.push(host);
      return host;
    },
    statementDeadlineMs: 5_000,
    onStatus: (status) => statuses.push(status),
  });
  const limits = modules.protocol.AGENT_DATABASE_LIMITS;
  const request = {
    kind: "statement" as const,
    databasePath: join(tmpdir(), "openbot-runtime-faults.db"),
    mode: "read" as const,
    provision: false,
    protectedTables: [],
    sql: "SELECT 1",
    parameters: [],
    limits: {
      maxRows: limits.maxRows,
      maxResultBytes: limits.maxResultBytes,
      maxCellChars: limits.maxCellChars,
      maxPageCount: limits.maxPageCount,
      busyTimeoutMs: limits.busyTimeoutMs,
    },
  };
  try {
    const killed = Effect.runPromise(supervisor.send(request));
    await waitFor(() => supervisor.status().host === "running", "the first database host");
    const queued = Effect.runPromise(supervisor.send(request));
    await waitFor(() => supervisor.status().pending === 2, "two database statements");
    hosts[0]?.kill();
    const killedOutcome = await killed;
    assert.equal(killedOutcome.ok, false, "The killed statement fails.");
    if (killedOutcome.ok) throw new Error("unreachable");
    assert.match(killedOutcome.failure.message, /stopped unexpectedly/);
    const queuedOutcome = await queued;
    assert.equal(queuedOutcome.ok, true, "The queued statement runs on the fresh host.");
    const status = supervisor.status();
    assert.equal(status.hostExits, 1);
    assert.equal(status.redispatches, 1);
    const kinds = statuses.map((entry) => entry.lastEvent?.kind);
    assert.ok(kinds.includes("host-exited") && kinds.includes("host-started"), `events: ${kinds}`);
  } finally {
    supervisor.dispose();
  }
}

const root = await mkdtemp(join(tmpdir(), "openbot-runtime-faults-"));
const runFixture = join(root, "run-child.cjs");
const dbFixture = join(root, "db-host.cjs");
await writeFile(runFixture, RUN_CHILD);
await writeFile(dbFixture, DB_HOST);
try {
  await runCase(
    "F2",
    "renderer crash/hang reloads once, then names the state",
    "policy",
    "first fault reloads, second gives up with a named code, clean exit is not a fault",
    async () => {
      f2Policy();
      return "policy decisions and clean-exit filter hold";
    },
  );
  unavailable(
    "F2 (BrowserWindow wiring)",
    "Needs a live Electron renderer. Read-only evidence: src/main/main-window.ts wires render-process-gone, unresponsive, did-finish-load and did-fail-load; isQuitting() returns before any reload.",
  );

  await runCase("F3", "a killed run is reported at the next start", "process", "the next start reads an unexpected record", async () => {
    const statePath = join(root, "f3", "run.json");
    await mkdir(join(root, "f3"), { recursive: true });
    const exitCode = await spawnRunChild(runFixture, statePath, "crash");
    assert.notEqual(exitCode, 0, "The child was killed, not exited.");
    const previous = readPreviousRun(statePath);
    assert.equal(previous.kind, "unexpected", "The record says the run did not finish.");
    if (previous.kind !== "unexpected") throw new Error("unreachable");
    assert.equal(previous.record.exitReason, null);
    assert.match(runStateCode(previous.record), /^RUN-[0-9A-F]{8}$/);
    return `unexpected ${runStateCode(previous.record)}`;
  });

  await runCase(
    "F3 (negative control)",
    "a clean quit leaves no notice",
    "process",
    "the next start reads a clean record",
    async () => {
      const statePath = join(root, "f3-clean", "run.json");
      await mkdir(join(root, "f3-clean"), { recursive: true });
      const exitCode = await spawnRunChild(runFixture, statePath, "clean");
      assert.equal(exitCode, 0, "The child exited on its own.");
      const previous = readPreviousRun(statePath);
      assert.equal(previous.kind, "clean", "A clean record is not a crash notice.");
      return "clean record";
    },
  );

  if (process.platform === "win32") {
    await runCase(
      "F4",
      "a stuck exit is ended by process id and start time; a normal exit and a reused id are not",
      "process",
      "the stuck process is killed, and all three negative controls survive",
      async () => {
        await f4Windows(root);
        return `limit ${watchdogLimitSeconds}s; three negative controls passed`;
      },
    );
  } else {
    unavailable("F4", "The Windows watchdog uses powershell.exe; this host is not Windows.");
  }

  await runCase(
    "F8",
    "a failed start has one stable code, a log line and a log file",
    "helper",
    "the same error gives the same code, a different error a different one, and no message text",
    async () => {
      const first = startupFailureCode(new Error("disk I/O error at /tmp/openbot.db"));
      const again = startupFailureCode(new Error("disk I/O error at /tmp/openbot.db"));
      const other = startupFailureCode(new Error("a different failure"));
      const named = startupFailureCode(Object.assign(new Error("x"), { name: "AgentLifecycleFailed" }));
      assert.match(first, /^STARTUP-[0-9A-F]{8}$/);
      assert.equal(first, again, "The same failure names the same code.");
      assert.notEqual(first, other, "A different failure names a different code.");
      assert.notEqual(first, named, "The error name is part of the code.");
      assert.equal(first.includes("openbot"), false, "The code carries no message text.");
      assert.equal(first.includes("/"), false, "The code carries no path.");
      const sanitized = sanitizeFailureMessage("bad\u0000text\nkept\ttab");
      assert.equal(sanitized, "bad\uFFFDtext\nkept\ttab", "A NUL becomes a visible replacement.");
      const logFile = mainLogFile("/home/user/openbot/logs");
      assert.equal(basename(logFile), "main.log");
      assert.equal(basename(dirname(logFile)), "main");
      return `${first}; log target ${logFile}`;
    },
  );
  unavailable(
    "F8 (native error box)",
    "Needs a live Electron app that fails its own start. Read-only evidence: src/main/index.ts builds the box from startupFailureCode plus localizeSourceText, has an Open Logs button and logs the same code.",
  );

  await runCase(
    "F9",
    "a power-loss-like kill is detected, and the next clean start repairs the record",
    "process",
    "the next start sees the unexpected run, then writes a clean record",
    async () => {
      const statePath = join(root, "f9", "run.json");
      await mkdir(join(root, "f9"), { recursive: true });
      await spawnRunChild(runFixture, statePath, "crash");
      const nextStart = beginRun(statePath, { pid: process.pid, startedAt: new Date().toISOString() });
      assert.equal(nextStart.kind, "unexpected", "The next start reports the killed run.");
      if (nextStart.kind !== "unexpected") throw new Error("unreachable");
      assert.equal(nextStart.record.exitReason, null, "A power loss records no exit reason.");
      markRunComplete(statePath, process.pid, "quit");
      const afterRepair = readPreviousRun(statePath);
      assert.equal(afterRepair.kind, "clean", "The next clean quit repairs the record.");
      return `detected ${runStateCode(nextStart.record)} and repaired`;
    },
  );

  const dbModules = await loadDbHostModules();
  if (dbModules) {
    await runCase(
      "F1",
      "a database host killed mid-statement re-dispatches queued work",
      "process",
      "one sentence, then the queued call succeeds on a fresh host",
      async () => {
        await f1DbHost(dbModules, dbFixture);
        return "killed statement failed once; queued statement succeeded";
      },
    );
  } else {
    unavailable("F1", "The supervisor needs the installed packages (`effect`); this checkout has no node_modules.");
  }

  unavailable("F5", "Needs a full disk. The refusal key `error.provider.diskSpace` is read in src/backend and has no injectable boundary in this script.");
  unavailable("F6", "Needs the provider-fakes lane and a configured provider; 429/503 mapping runs inside the Pi client.");
  unavailable("F7", "Needs a reasoning_content replay 400 from a provider; no local seam injects it without the installed app.");
  unavailable(
    "F10",
    "Needs a diagnostics export from a crashed installed app. The redaction path is covered by its own checks; this script cannot produce the export.",
  );
} finally {
  await rm(root, { recursive: true, force: true });
  const failures = report.cases.filter((entry) => entry.status === "failed");
  report.complete = report.unavailable.length === 0;
  report.passed = failures.length === 0 && (!requireAll || report.complete);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({
      passed: report.passed,
      complete: report.complete,
      executed: report.cases.length,
      unavailable: report.unavailable.length,
      report: join(OUT, "report.json"),
    })}\n`,
  );
  process.exitCode = report.passed ? 0 : 1;
}
