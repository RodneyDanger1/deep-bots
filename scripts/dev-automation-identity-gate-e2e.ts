// The gate `dev:automation` uses to decide that the browser behind a
// debugging port is this worktree's app. Two shapes must be refused:
//
//   - a page served on another renderer port: another worktree's app, or any
//     Chromium reached through a port that was not this instance's;
//   - a window on the right port that has no preload bridge. A visited site
//     cannot expose `window.openbot`, so a blank preload is a page that
//     OpenBot's main process did not start, even when the URL looks like the
//     renderer's.
//
// `openDevBrowser` accepts a browser whose User-Agent has no `Electron/` only
// when `findRendererPages` returns a window, so this is the check that decides
// the refusal. The live acceptance path is exercised by
// `bun run dev:automation pages/snapshot` against a running stack; this test
// covers the refusal side without a browser.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type RendererCandidate, findRendererPages } from "./dev-automation/cdp-client";
import { findMainPages, isMainAppUrl } from "./dev-automation/page-url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const reportDirectory = join(projectRoot, ".openbot-build");

const RENDERER_PORT = 5_173;
const OTHER_PORT = 5_199;

function fakePage(url: string, bridge: string | Error): RendererCandidate & { label: string } {
  return {
    label: `${url} bridge=${bridge instanceof Error ? "throws" : bridge}`,
    url: () => url,
    evaluate: async () => {
      if (bridge instanceof Error) throw bridge;
      return bridge;
    },
  };
}

async function main(): Promise<void> {
  mkdirSync(reportDirectory, { recursive: true });
  const checks: Array<{ name: string; pass: boolean; detail: string }> = [];
  const check = (name: string, pass: boolean, detail: string): void => {
    checks.push({ name, pass, detail });
  };

  const urlCases: Array<{ url: string; port: number | null; expected: boolean; why: string }> = [
    { url: `http://localhost:${RENDERER_PORT}/`, port: RENDERER_PORT, expected: true, why: "recorded renderer" },
    { url: `http://127.0.0.1:${RENDERER_PORT}/index.html`, port: RENDERER_PORT, expected: true, why: "recorded index" },
    { url: `http://localhost:${OTHER_PORT}/`, port: RENDERER_PORT, expected: false, why: "another renderer port" },
    { url: `http://localhost:${RENDERER_PORT}/`, port: null, expected: true, why: "no published port" },
    { url: "https://example.com/", port: RENDERER_PORT, expected: false, why: "external site" },
    { url: `http://localhost:${RENDERER_PORT}/?surface=island`, port: RENDERER_PORT, expected: false, why: "helper surface" },
    { url: "not a url", port: RENDERER_PORT, expected: false, why: "unparseable" },
  ];
  for (const item of urlCases) {
    check(
      `isMainAppUrl ${item.why}`,
      isMainAppUrl(item.url, item.port) === item.expected,
      `${item.url} port=${String(item.port)} expected=${String(item.expected)}`,
    );
  }

  const appWindow = fakePage(`http://localhost:${RENDERER_PORT}/`, "object");
  const foreignWindow = fakePage(`http://localhost:${OTHER_PORT}/`, "object");
  const blankPreload = fakePage(`http://localhost:${RENDERER_PORT}/`, "undefined");
  const navigating = fakePage(`http://localhost:${RENDERER_PORT}/`, new Error("Target closed"));
  const pages = [appWindow, foreignWindow, blankPreload, navigating];

  check(
    "findMainPages drops the foreign renderer port",
    findMainPages(pages, RENDERER_PORT).every((page) => page !== foreignWindow) &&
      findMainPages(pages, RENDERER_PORT).includes(appWindow),
    `kept ${findMainPages(pages, RENDERER_PORT).length} of ${pages.length}`,
  );

  const confirmed = await findRendererPages(pages, RENDERER_PORT);
  check("blank preload refused", !confirmed.includes(blankPreload), blankPreload.label);
  check("foreign port refused even with a forged bridge", !confirmed.includes(foreignWindow), foreignWindow.label);
  check("a page that closes while probed is refused", !confirmed.includes(navigating), navigating.label);
  check(
    "only the app window is confirmed",
    confirmed.length === 1 && confirmed[0] === appWindow,
    confirmed.map((page) => page.url()).join(", ") || "(none)",
  );

  const reportPath = join(reportDirectory, `f5-cdp-identity-gate-${Date.now()}.json`);
  writeFileSync(
    reportPath,
    `${JSON.stringify(
      { test: "dev-automation-identity-gate", checks, pass: checks.every((entry) => entry.pass) },
      null,
      2,
    )}\n`,
    "utf8",
  );
  for (const entry of checks) process.stderr.write(`${entry.pass ? "PASS" : "FAIL"} ${entry.name}: ${entry.detail}\n`);
  process.stderr.write(`report: ${reportPath}\n`);
  if (!checks.every((entry) => entry.pass)) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
