// `bun run dev:stop` must free a port that a descendant of a recorded service
// still holds after the process between them has exited.
//
// The window this reproduces is the one the api service produces: the recorded
// `api` pid is a `bun run` wrapper, and the port holder is three hops below it,
// behind two intermediates. On Windows a signal reaches one pid and no group,
// so `dev:stop` has to name every descendant it will stop. It used to name them
// by walking the live process table from the recorded pid *after* the
// supervisor was gone: by then the intermediate had died with its parent, its
// child was unreachable from the record, and the port stayed held while the
// command reported success.
//
// This test plants that shape with real processes and runs the real command:
//
//   supervisor  - the pid the stack record names as the runner
//   service     - the pid the record names as `api`, a child of the supervisor
//                 that exits when the supervisor does (as bun's wrapper does)
//   intermediate- a child of the service that exits shortly after the service
//                 (as the `run-development` wrapper does)
//   holder      - a child of the intermediate that keeps listening, the way the
//                 Vite dev server does after its parent is signalled
//
// PASS means: `dev-stack.ts stop` exits 0, every planted process is gone, the
// port is free, the record is removed, and an unrelated process started before
// the stop is still running.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type DevStackRecord, writeDevStackRecord } from "./dev-automation/stack-registry";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const scriptPath = fileURLToPath(import.meta.url);
const reportDirectory = join(projectRoot, ".openbot-build");

function flag(name: string): string | null {
  const match = process.argv.slice(2).find((argument) => argument.startsWith(`--${name}=`));
  return match === undefined ? null : match.slice(name.length + 3);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${label}.`);
}

function readPid(path: string): number | null {
  try {
    const value = Number(readFileSync(path, "utf8").trim());
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const server = createServer();
    server.once("error", () => resolveProbe(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolveProbe(true)));
  });
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolveProbe(true);
    });
    socket.once("error", () => resolveProbe(false));
  });
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        server.close(() => reject(new Error("No port was assigned.")));
        return;
      }
      const { port } = address;
      server.close(() => resolvePort(port));
    });
  });
}

function spawnRole(role: string, extra: string[]): ReturnType<typeof spawn> {
  const child = spawn(process.execPath, [scriptPath, `--role=${role}`, ...extra], {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false,
  });
  return child;
}

// Each planted process writes its own pid where the test can read it, because
// only the record names the service pid; the two below it are discovered by the
// command under test, not by the test.
async function runRole(): Promise<void> {
  const role = flag("role");
  if (role === "supervisor") {
    // The real runner stops its services itself when it is signalled, so this
    // one does too: the point of the shape below is that the intermediate dies
    // with the service and the holder does not.
    const servicePidFile = flag("service-pid-file");
    process.on("SIGTERM", () => {
      const servicePid = servicePidFile === null ? null : readPid(servicePidFile);
      if (servicePid !== null) {
        try {
          process.kill(servicePid, "SIGTERM");
        } catch {
          // Already gone.
        }
      }
      setTimeout(() => process.exit(0), 250);
    });
    setInterval(() => undefined, 1_000);
    return;
  }
  if (role === "holder") {
    const port = Number(flag("port"));
    const marker = flag("marker");
    const server = Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response("held") });
    if (marker) writeFileSync(marker, String(process.pid), "utf8");
    process.on("SIGTERM", () => {
      void server.stop(true);
      process.exit(0);
    });
    setInterval(() => undefined, 1_000);
    return;
  }
  if (role === "intermediate") {
    const servicePid = Number(flag("service-pid"));
    const marker = flag("marker");
    // The holder is started behind `cmd.exe`, which is the shape Windows leaves
    // behind: the launcher exits with its own parent, the holder keeps the
    // port, and the parent link from the record no longer reaches it. A bun
    // child would be killed with this process, so the launcher hop is what
    // makes the surviving holder realistic.
    spawn("cmd.exe", ["/c", process.execPath, scriptPath, "--role=holder", `--port=${flag("port")}`, `--marker=${flag("holder-marker")}`], {
      cwd: projectRoot,
      stdio: "ignore",
      shell: false,
    }).unref();
    if (marker) writeFileSync(marker, String(process.pid), "utf8");
    // A wrapper whose parent dies stops writing to the inherited console and
    // exits; the process behind the launcher keeps its port. This is the
    // interval the stop command cannot see after the fact.
    await waitFor(() => !isAlive(servicePid), 60_000, "the service to exit");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    process.exit(0);
  }
  if (role === "service") {
    const supervisorPid = Number(flag("supervisor-pid"));
    const marker = flag("marker");
    spawnRole("intermediate", [
      `--service-pid=${process.pid}`,
      `--port=${flag("port")}`,
      `--marker=${flag("intermediate-marker")}`,
      `--holder-marker=${flag("holder-marker")}`,
    ]).unref();
    if (marker) writeFileSync(marker, String(process.pid), "utf8");
    await waitFor(() => !isAlive(supervisorPid), 60_000, "the supervisor to exit");
    process.exit(0);
  }
  throw new Error(`Unknown role: ${String(role)}`);
}

function killQuietly(pid: number | null): void {
  if (pid === null) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone, which is the expected outcome.
  }
}

async function main(): Promise<void> {
  if (flag("role") !== null) {
    await runRole();
    return;
  }

  mkdirSync(reportDirectory, { recursive: true });
  const registryDirectory = mkdtempSync(join(tmpdir(), "openbot-f5-registry-"));
  const pidDirectory = mkdtempSync(join(tmpdir(), "openbot-f5-pids-"));
  const reportPath = join(reportDirectory, `f5-dev-stack-orphan-${Date.now()}.json`);
  const port = await freePort();
  const pidPath = (name: string): string => join(pidDirectory, `${name}.pid`);

  const checks: Array<{ name: string; pass: boolean; detail: string }> = [];
  const check = (name: string, pass: boolean, detail: string): void => {
    checks.push({ name, pass, detail });
  };

  let supervisorPid: number | null = null;
  let servicePid: number | null = null;
  let intermediatePid: number | null = null;
  let holderPid: number | null = null;
  let sentinelPid: number | null = null;
  let stopExitCode: number | null = null;
  let stopOutput = "";

  try {
    const sentinel = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], {
      cwd: projectRoot,
      stdio: "ignore",
      shell: false,
    });
    sentinel.unref();
    sentinelPid = sentinel.pid ?? null;

    const supervisor = spawnRole("supervisor", [`--service-pid-file=${pidPath("service")}`]);
    supervisor.unref();
    supervisorPid = supervisor.pid ?? null;
    const supervisorStartedAt = Date.now();
    if (supervisorPid === null) throw new Error("The planted supervisor did not start.");

    const service = spawnRole("service", [
      `--supervisor-pid=${supervisorPid}`,
      `--port=${port}`,
      `--marker=${pidPath("service")}`,
      `--intermediate-marker=${pidPath("intermediate")}`,
      `--holder-marker=${pidPath("holder")}`,
    ]);
    service.unref();
    servicePid = service.pid ?? null;
    const serviceStartedAt = Date.now();
    if (servicePid === null) throw new Error("The planted service did not start.");

    await waitFor(() => readPid(pidPath("holder")) !== null, 30_000, "the holder to publish its pid");
    await waitFor(() => canConnect(port), 30_000, "the holder to listen");
    intermediatePid = readPid(pidPath("intermediate"));
    holderPid = readPid(pidPath("holder"));
    check(
      "planted tree is live",
      holderPid !== null && intermediatePid !== null && isAlive(holderPid) && isAlive(intermediatePid),
      `supervisor=${supervisorPid} service=${servicePid} intermediate=${intermediatePid} holder=${holderPid} port=${port}`,
    );

    const record: DevStackRecord = {
      services: ["api"],
      projectRoot,
      supervisorPid,
      startedAt: supervisorStartedAt,
      ports: [{ name: "api", port }],
      processes: [{ name: "api", pid: servicePid, startedAt: serviceStartedAt }],
    };
    // The record goes where the spawned command will look for it: the stop
    // command reads the registry named by OPENBOT_DEV_REGISTRY_DIR, so this
    // process writes there too and the developer's real registry stays out of
    // the test.
    process.env.OPENBOT_DEV_REGISTRY_DIR = registryDirectory;
    writeDevStackRecord(record);

    const stop = spawn(process.execPath, [join(projectRoot, "scripts", "dev-stack.ts"), "stop"], {
      cwd: projectRoot,
      env: { ...process.env, OPENBOT_DEV_REGISTRY_DIR: registryDirectory },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    stop.stdout?.on("data", (chunk: Buffer | string) => {
      stopOutput += String(chunk);
    });
    stop.stderr?.on("data", (chunk: Buffer | string) => {
      stopOutput += String(chunk);
    });
    stopExitCode = await new Promise<number | null>((resolveExit) => {
      stop.once("exit", (code) => resolveExit(code));
    });

    await waitFor(() => !canConnect(port), 20_000, "the port to be free").catch(() => undefined);
    await new Promise((resolveSettle) => setTimeout(resolveSettle, 1_000));

    check("dev:stop exit code", stopExitCode === 0, `exit=${String(stopExitCode)}`);
    check("port is free", await portIsFree(port), `port ${port} answered=${await canConnect(port)}`);
    check(
      "port holder is gone",
      holderPid !== null && !isAlive(holderPid),
      `holder pid ${String(holderPid)} alive=${holderPid !== null && isAlive(holderPid)}`,
    );
    check(
      "recorded service is gone",
      servicePid !== null && !isAlive(servicePid),
      `service pid ${String(servicePid)} alive=${servicePid !== null && isAlive(servicePid)}`,
    );
    check(
      "intermediate is gone",
      intermediatePid !== null && !isAlive(intermediatePid),
      `intermediate pid ${String(intermediatePid)} alive=${intermediatePid !== null && isAlive(intermediatePid)}`,
    );
    check(
      "supervisor is gone",
      supervisorPid !== null && !isAlive(supervisorPid),
      `supervisor pid ${String(supervisorPid)} alive=${supervisorPid !== null && isAlive(supervisorPid)}`,
    );
    check(
      "record was dropped",
      !existsSync(join(registryDirectory, "stacks")) ||
        readdirSync(join(registryDirectory, "stacks")).length === 0,
      `stacks dir entries: ${
        existsSync(join(registryDirectory, "stacks")) ? readdirSync(join(registryDirectory, "stacks")).join(", ") : "(absent)"
      }`,
    );
    check(
      "unrelated process untouched",
      sentinelPid !== null && isAlive(sentinelPid),
      `sentinel pid ${String(sentinelPid)} alive=${sentinelPid !== null && isAlive(sentinelPid)}`,
    );
  } finally {
    // Only pids this test planted, and only if the command under test left them.
    for (const pid of [holderPid, intermediatePid, servicePid, supervisorPid, sentinelPid]) {
      if (pid !== null && isAlive(pid)) killQuietly(pid);
    }
    rmSync(pidDirectory, { recursive: true, force: true });
    rmSync(registryDirectory, { recursive: true, force: true });
    writeFileSync(
      reportPath,
      `${JSON.stringify(
        {
          test: "dev-stack-orphan-descendants-e2e",
          platform: process.platform,
          port,
          stopExitCode,
          stopOutput,
          checks,
          pass: checks.length > 0 && checks.every((entry) => entry.pass),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  const failed = checks.filter((entry) => !entry.pass);
  for (const entry of checks) process.stderr.write(`${entry.pass ? "PASS" : "FAIL"} ${entry.name}: ${entry.detail}\n`);
  process.stderr.write(`report: ${reportPath}\n`);
  if (failed.length > 0) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
