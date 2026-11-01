import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppTranslate } from "@openbot/i18n";

/**
 * The main process's record of how the last run ended, the recovery decision for a renderer that
 * stopped, and the small pieces of text the two native notices share.
 *
 * This module has no Electron import, so the fault-injection gate runs it under a plain `node` and
 * the entry point can call it before `app.whenReady()`. It holds no service and no timer.
 */

export const RUN_STATE_FILE = "openbot-run-state-v1.json";

/**
 * The state file of one running process. It is written before any service exists and rewritten
 * when the quit starts and after the teardown finishes, so the next run can tell a requested exit
 * from a crash, a power loss or a kill. It holds no path, no message and no user text: the pid and
 * the start time make a code, and the code is what a log line and a notice quote.
 */
export interface RunRecord {
  version: 1;
  pid: number;
  /** ISO 8601, from the clock of this computer. */
  startedAt: string;
  /** True only after the teardown finished, or after a requested exit that has nothing to tear down. */
  cleanExit: boolean;
  /** Why the last run asked to quit, when it got as far as asking. */
  exitReason: string | null;
}

export type PreviousRun =
  | { kind: "first-run" }
  | { kind: "clean"; record: RunRecord }
  | { kind: "unexpected"; record: RunRecord }
  | { kind: "unreadable"; reason: string };

/**
 * The previous run when it did not finish its own shutdown. A run that records no exit reason and
 * no clean exit was stopped from outside: a crash, a power loss, or the task manager.
 */
export function readPreviousRun(path: string): PreviousRun {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return isMissingFile(error) ? { kind: "first-run" } : { kind: "unreadable", reason: describeFileError(error) };
  }
  const record = parseRunRecord(text);
  if (!record) return { kind: "unreadable", reason: "invalid-record" };
  return record.cleanExit ? { kind: "clean", record } : { kind: "unexpected", record };
}

/**
 * Reads how the previous run ended and writes this run's record. The returned value is the state
 * before this run, which is what the notices use. A caller that cannot write still starts: an
 * unrecorded run only makes the next notice less certain, and never stops the app.
 */
export function beginRun(path: string, run: { pid: number; startedAt: string }): PreviousRun {
  const previous = readPreviousRun(path);
  writeRunRecord(path, { version: 1, pid: run.pid, startedAt: run.startedAt, cleanExit: false, exitReason: null });
  return previous;
}

/** Records why the run is quitting, without marking it complete: a stuck quit must stay visible. */
export function recordRunExit(path: string, pid: number, reason: string): void {
  const record = readRunRecord(path);
  if (!record || record.pid !== pid || record.exitReason !== null) return;
  writeRunRecord(path, { ...record, exitReason: reason });
}

/** Marks the run as complete. Only a run that reached this point has a clean exit. */
export function markRunComplete(path: string, pid: number, reason: string): void {
  const record = readRunRecord(path);
  if (!record || record.pid !== pid || record.cleanExit) return;
  writeRunRecord(path, { ...record, cleanExit: true, exitReason: reason });
}

/** The code a notice and a log line quote for one crashed run. Stable for one record. */
export function runStateCode(record: RunRecord): string {
  return `RUN-${shortHash(`${record.pid}:${record.startedAt}`)}`;
}

/** The code a startup failure quotes. It names the error, and never its text or a path. */
export function startupFailureCode(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  return `STARTUP-${shortHash(`${name}:${message}`)}`;
}

/** Replaces the control characters a Windows error box would cut the text at. */
export function sanitizeFailureMessage(text: string): string {
  return text.replace(/[^\P{Cc}\n\t]/gu, "\uFFFD");
}

/** The one label both native notices use for the action that shows the log file. */
export function openLogsLabel(translate: AppTranslate): string {
  return `${translate("common.open")} ${translate("files.category.logs")}`;
}

/** The file `startMainLog` writes, so a notice opens the log itself rather than a folder. */
export function mainLogFile(logsDirectory: string): string {
  return join(logsDirectory, "main", "main.log");
}

export type RendererFaultKind = "render-process-gone" | "unresponsive";
export type RendererPhase = "healthy" | "recovering" | "crashed";

export interface RendererRecoveryState {
  phase: RendererPhase;
  fault: RendererFaultKind | null;
  /** The automatic reloads since the page last stayed up for the reset interval. */
  reloads: number;
  lastFaultAt: number | null;
}

export type RendererRecoveryAction = "reload" | "force-and-reload" | "give-up";

export interface RendererRecoveryDecision {
  action: RendererRecoveryAction;
  state: RendererRecoveryState;
}

export interface RendererRecoveryOptions {
  /** One automatic reload. A second fault before the page stays up is the named state. */
  maxReloads?: number;
  /** A page that stayed up this long starts again with a full budget. */
  resetAfterMs?: number;
  now?: () => number;
}

export interface RendererRecovery {
  /** Decides what to do about one fault. The caller performs the action and reports the load. */
  fault(kind: RendererFaultKind): RendererRecoveryDecision;
  /** The page loaded. Its automatic-reload budget is full again after the reset interval. */
  loaded(): void;
  state(): RendererRecoveryState;
}

export const RENDERER_RECOVERY_MAX_RELOADS = 1;
export const RENDERER_RECOVERY_RESET_MS = 5 * 60_000;

/**
 * The reload-once policy. One page gets one automatic reload; a second fault before the page stays
 * up for `resetAfterMs` is a named state rather than a reload loop. An unresponsive page is ended
 * first, because a page that never returns to its event loop cannot load itself.
 */
export function createRendererRecovery(options: RendererRecoveryOptions = {}): RendererRecovery {
  const maxReloads = options.maxReloads ?? RENDERER_RECOVERY_MAX_RELOADS;
  const resetAfterMs = options.resetAfterMs ?? RENDERER_RECOVERY_RESET_MS;
  const now = options.now ?? Date.now;
  let phase: RendererPhase = "healthy";
  let fault: RendererFaultKind | null = null;
  let reloads = 0;
  let lastFaultAt: number | null = null;
  let lastStableAt: number | null = null;

  return {
    fault(kind) {
      const at = now();
      if (lastStableAt !== null && at - lastStableAt >= resetAfterMs) {
        reloads = 0;
        lastStableAt = null;
      }
      lastFaultAt = at;
      fault = kind;
      if (reloads >= maxReloads) {
        phase = "crashed";
        return { action: "give-up", state: { phase, fault, reloads, lastFaultAt } };
      }
      reloads += 1;
      phase = "recovering";
      return {
        action: kind === "unresponsive" ? "force-and-reload" : "reload",
        state: { phase, fault, reloads, lastFaultAt },
      };
    },
    loaded() {
      phase = "healthy";
      lastStableAt = now();
    },
    state() {
      return { phase, fault, reloads, lastFaultAt };
    },
  };
}

/**
 * A renderer that ended on its own is worth one reload. A clean exit is the renderer doing what the
 * window asked, and a reload would fight the close or the navigation that caused it.
 */
export function isRecoverableRendererGone(reason: string): boolean {
  return reason !== "clean-exit";
}

/** A fixed name for the state a log line and a notice quote. */
export function rendererStateCode(
  state: RendererRecoveryState,
): "RENDERER-UNRECOVERED" | "RENDERER-RECOVERING" | "RENDERER-HEALTHY" {
  if (state.phase === "crashed") return "RENDERER-UNRECOVERED";
  if (state.phase === "recovering") return "RENDERER-RECOVERING";
  return "RENDERER-HEALTHY";
}

function readRunRecord(path: string): RunRecord | null {
  try {
    return parseRunRecord(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Writes through a temporary file, so a power loss leaves the old record, never half a record. */
function writeRunRecord(path: string, record: RunRecord): void {
  const temporary = `${path}.${record.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function parseRunRecord(text: string): RunRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== 1) return null;
  if (typeof parsed.pid !== "number" || !Number.isSafeInteger(parsed.pid) || parsed.pid <= 0) return null;
  if (typeof parsed.startedAt !== "string" || parsed.startedAt.length === 0 || parsed.startedAt.length > 64)
    return null;
  if (typeof parsed.cleanExit !== "boolean") return null;
  const exitReason = parsed.exitReason;
  if (!(exitReason === null || (typeof exitReason === "string" && exitReason.length <= 64))) return null;
  return { version: 1, pid: parsed.pid, startedAt: parsed.startedAt, cleanExit: parsed.cleanExit, exitReason };
}

interface RunRecordFields {
  version?: unknown;
  pid?: unknown;
  startedAt?: unknown;
  cleanExit?: unknown;
  exitReason?: unknown;
}

function isRecord(value: unknown): value is RunRecordFields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function describeFileError(error: unknown): string {
  return error instanceof Error ? error.name : "unknown-error";
}

/** FNV-1a, 32 bits, eight uppercase hex digits. Not a security hash: a stable, short label. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (const character of text) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}
