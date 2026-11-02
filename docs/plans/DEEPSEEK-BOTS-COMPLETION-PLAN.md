# DeepSeek Bots — Completion Plan

Status: **planning / code freeze not reached**  
Baseline: `7e7ef95` on `main`  
Public repository: <https://github.com/RodneyDanger1/deep-bots>  
Upstream: <https://github.com/nightly-labs/openbot>

DeepSeek Bots is a source-available, DeepSeek-focused fork of OpenBot. The upstream application is a
local-first multi-agent desktop workspace. This plan lists the coding work still needed to make the
fork coherent on desktop and mobile, and the verification that starts only after that code is frozen.

## 1. Current verified state

| Item | State |
|---|---|
| Desktop application | Launches and renders; title is DeepSeek Bots |
| DeepSeek provider | Managed Pi CLI 1.4.0 installed; provider becomes available |
| Live model turn | Two real `deepseek-flash` turns completed; one returned dated citations; context reached 46% |
| Key handling | Entered only in the encrypted provider dialog; no key is stored in this repository |
| Clean close | `cleanExit:true`; no false crash notice |
| Import pack | 12 agents / 3 channels / 6 skill packs exist under `resources/agent-import/deepseek-bots/` and `content/deepseek-bots/` |
| Mobile app | Existing Expo/React Native client under `apps/mobile`; no rebuilt APK for this fork yet |
| Mobile pairing | Desktop QR is a valid `openbot://mobile-connect` sign-in code. The installed upstream APK was scanned in the server-invitation screen, which prints “This QR code is not an OpenBot invitation.” The mobile source fix exists; the installed APK cannot receive it until rebuilt |
| Public CI | The pushed commit references DeepSeek/runtime scripts that were not committed; public CI is not yet truthful |
| Licence | PolyForm Noncommercial 1.0.0; public source is not a commercial licence |

## 2. Code Freeze rule

**No full build, project-wide typecheck, full test suite, APK build, Linux build, VPS deployment,
GitHub CI run or acceptance gate until every coding task in §4 is complete and the Lead declares Code
Freeze.**

During coding, a seat may run only the minimum local RED/GREEN probe for the files it changed. It may
not use the final gates to discover unfinished work.

Code Freeze requires:

1. Every task in §4 is `DONE` or explicitly `DEFERRED` with a reason.
2. No `TODO`, `FIXME`, stub, placeholder, fake success path, dead alias or missing script remains.
3. The working tree is clean after local commits.
4. No generated binaries, keystores, logs or reports are staged.
5. The Lead has read the complete diff.

## 3. Decisions and defaults

| ID | Decision | Default |
|---|---|---|
| D1 | Commercial licence | Keep PolyForm NC; no paid launch without a separate licence |
| D2 | Desktop identity | Keep `productName`, `appId`, package name and userData path; change display copy only |
| D3 | Mobile package | New Android package `run.deepseekbots.mobile`; own signing; keep `openbot` URL scheme |
| D4 | Distribution | Sideload APK first; Play Store later |
| D5 | 24/7 access | PC-on plus Tailscale private route first; Linux host on a VPS second |
| D6 | Account service | `api.openbot.run`; no self-hosted Signal/Worker in this cycle |
| D7 | Signed-in pairing | Never replace a stored session automatically; offer sign-out or server invitation |
| D8 | Missing scripts | Fix and commit them; do not leave aliases pointing at absent files |
| D9 | Full rebrand | Deferred; changing product identity needs a userData migration |
| D10 | Admission gate / per-bot export | Not implemented in this cycle; remove claims |

## 4. Coding inventory

### 4.1 Repository, CI and tests

**R1 — Reconcile the working tree.**
Review the pending tracked and untracked changes. Keep formatter/lint fixes. Remove accidental edits.
Commit locally.

**R2 — Make public aliases real.**
Add or repair the missing DeepSeek and runtime E2E scripts and their aliases/CI steps:

- `scripts/deepseek-context-budget-e2e.ts`
- `scripts/deepseek-key-redaction-e2e.ts`
- `scripts/deepseek-reasoning-replay-e2e.ts`
- `scripts/deepseek-thinking-level-e2e.ts`
- `scripts/deepseek-pricing-e2e.ts`
- `scripts/deepseek-vision-gate-e2e.ts`
- `scripts/deepseek-error-mapping-e2e.ts`
- `scripts/deepseek-model-metadata-e2e.ts`
- `scripts/deepseek-json-blank-retry-e2e.ts`
- `scripts/deepseek-search-mcp-e2e.ts`
- `scripts/runtime-db-host-e2e.ts`
- supporting `scripts/deepseek-search-mcp.ts`, `scripts/provider-fakes/agents/deepseek-api.ts`,
  `scripts/provider-fakes/agents/deepseek.ts`, `scripts/provider-fakes/reasoning-strip-proxy.ts`
- `scripts/agent-persistence-e2e.ts` if retained.

Fix the blocked lint rules: unsafe type assertions, dictionary value types, assignment expressions,
optional chains, console calls, misleading return types. Wire every test into `package.json`,
`.github/workflows/ci.yml` and the appropriate check job. Do not leave a dead alias.

**R3 — E2E-only test policy.**
Convert or remove the new unit tests in `src/renderer/src/features/conversation/activity-store.test.tsx`
and `scripts/mobile-connect-preflight.test.ts`. Recreate the mobile pairing classifier proof as an E2E
script under `scripts/`.

**R4 — Public documentation placement.**
Add reviewed mobile research under `docs/mobile/`; keep internal logs, reports, wave sheets and evidence
out of the public tree.

### 4.2 Desktop runtime and engine

Write `docs/code-gap-register.md` first. For each item below, mark IMPLEMENTED, PARTIAL or MISSING with
file references; fix only the gaps.

| Item | Seam |
|---|---|
| Context budget and compaction | `src/backend/pi-client.ts`, `src/backend/agent/turn-lifecycle.ts`, `src/backend/agent/context-compaction.ts` |
| Reasoning replay proof | Fake Pi scripts; live G-T1 |
| Effort map low/high/max | `src/backend/pi-client.ts`, model catalog |
| Import pack | `resources/agent-import/deepseek-bots/`, `src/main/agent-template-service.ts` |
| Pricing/cost | `src/backend/agent/usage-pricing.ts` |
| Metadata and vision gate | `src/backend/pi-client.ts`, `packages/contracts/src/ipc-agent-identity.ts` |
| Default `deepseek-flash` | `packages/contracts/src/agent-providers.ts` |
| 429/503/422/500 mapping | `src/backend/pi-client.ts`, 13 `error/provider.ts` catalogs |
| 1M compaction threshold | `context-compaction.ts`, `turn-lifecycle.ts` |
| Key redaction | `pi-client.ts`, `packages/logging` |
| Team API v8 parity | `src/main/team-api/`, v8 adapter |
| Runtime health | `src/main/runtime-health.ts`, `src/main/exit-watchdog.ts`, `src/main/index.ts`, DB-host supervisor |

**Tool-failure event.** The current UI reduces a failed tool step to one generic sentence. Add an
optional, bounded failure payload to the local turn-progress event or a new local event, populate it
from the actual tool result with redaction, add the optional trace field, and render one concise error
card. Do not change frozen Team API protocols.

**Long reasoning frames.** Split long DeepSeek reasoning across conversation deltas below the 2 MiB
frame limit. Add a named `frame_too_large` refusal; do not silently truncate.

**Model fallback.** Add DeepSeek fallback model rows so the model route is never empty when Pi
discovery fails. Keep local-only metadata out of the Team API.

### 4.3 Desktop UI and truthfulness

- Make the composer “Complete agent CLI setup” message a control that opens **Settings → Providers**.
- Gate provider-update promotion on a runtime that can actually run; do not offer an update while a
  provider is `sign-in-required` or in error.
- Wire Mobile Connect reachability state into the dialog: exact `api` origin, Ready, Same Wi-Fi,
  Firewall may block, Blocked, and the server-invitation alternative.
- Fix the preflight default port; a dev stack can use a port other than 3100.
- Remove private reasoning from both the activity line and the timeline; keep legitimate tool/step
  summaries.
- Verify context meter states, cost honesty, error cards, thinking header and sources block.
- Apply display-only DeepSeek Bots branding in all 13 locale catalogs. Do not change product identity.
- Add `docs/mobile/connect-troubleshooting.md` copy only when the UI actually implements it.

### 4.4 Mobile protocol and correctness

Implement the eleven items from the mobile research, C1–C12:

| ID | Work |
|---|---|
| C1 | One-shot ticket re-mint, typed refusal, single-flight per host; stop after the second refusal |
| C2 | Account origin rules; use MagicDNS HTTPS for Tailscale; no silent widening of `100.64/10` |
| C3 | Refresh session before minting a ticket; 401 signs out but keeps outbox/cache |
| C4 | DeepSeek agent label and negotiated-protocol support log |
| C5 | Mobile long-frame guard plus host-side split |
| C6 | Verify approvals/needs-you; no force-tool UI; truncated request denies only |
| C7 | New FCM project for the new package id, or an explicit no-push build |
| C8 | Provider/model/effort sheet, empty-model explanation, effective-effort hint |
| C9 | Citations as markdown links; no invented source card |
| C10 | Named error key per Signal/host code in 13 catalogs |
| C11 | Cap cached message text; preserve the release rule |
| C12 | Reconnect hook from C1; background/resume behavior |

Key files: `packages/team-client/src/remote-peer.ts`,
`packages/team-client/src/remote-directory.ts`,
`apps/mobile/src/features/workspace/components/server-connection.tsx`,
`apps/mobile/src/features/auth/api/mobile-auth.ts`,
`apps/mobile/src/features/links/screens/incoming-link-screen.tsx`,
`apps/mobile/src/features/servers/screens/scan-invite-screen.tsx`,
`apps/mobile/src/features/support/model/support-log.ts`,
`apps/mobile/src/features/agents/components/agent-runtime-fields.tsx`.

No new Team API protocol version, no new event type and no model field on the wire.

### 4.5 Mobile v1 product surface

Implement the P0/P1 items from the mobile product research:

- Chat header shows `provider · model · effort`; the sheet changes them from the host catalog.
- Needs-you inbox on Home, app badge, deep link to the exact approval/question.
- Approval from a notification: focus, Allow/Deny, unlock required, answered-elsewhere, truncated
  request denies only.
- Context meter: known, estimated, compacting, not reported.
- Cost honesty: amount or “not reported”; never `$0.00`.
- Error cards: one action, request ID, no raw provider body.
- Pack install and review: agents, channels, skipped items, “sets no key, no Computer Use”.
- Four connection states with last-contact time.
- Thinking header (`Thinking · High`, `Working · N steps`).
- Sources block or “No sources given”; in-app browser.
- Vision pre-warning if metadata exists; otherwise actionable refusal.
- Privacy/consent screen and notification permission after explanation.

Deferred, named gaps: voice call, routine quiet-run copy, channel needs-you summary, offline read-only
cache, per-turn cost, spend cap and fallback model.

### 4.6 Mobile packaging and identity

- `apps/mobile/app.json`: name DeepSeek Bots, slug `deepseek-bots`, package
  `run.deepseekbots.mobile`, own iOS ids and App Group, own EAS project or local credentials, own
  update URL or disabled updates. Keep `scheme: "openbot"`.
- `apps/mobile/eas.json`: add an `apk` profile with `buildType: "apk"`; keep `production` as AAB.
- `apps/mobile/package.json`: add a Windows-safe local APK script. Prefer EAS local build; use Gradle
  prebuild only as a documented fallback.
- Own keystore outside the repository; own FCM project/file or explicit no-push build.
- Never use upstream signing, upstream OTA or upstream `google-services.json` as the fork’s identity.

### 4.7 Hosting and Linux packaging

- Add a fork-safe Linux AppImage build/artifact path using `electron-builder.yml` and the release
  workflow Linux job.
- Add a fork-safe installer option to `scripts/install-server.sh` or a separate fork installer. Keep
  manifest and checksum checks.
- Deploy the host on Ubuntu 24.04 with systemd, not the Docker image, when Computer Use parity matters.
- No self-hosted Signal/account Worker in this cycle.

### 4.8 Documentation and claims

- Update `README.md`, `docs/deepseek-bots.md`, `docs/audit-findings.md`,
  `docs/live-test-runbook.md` and this plan with the current evidence.
- Remove claims for admission gate, per-bot export, full rebrand, signed installers and competitor
  parity unless implemented and measured.
- Add a changelog fragment before release.

## 5. Order

1. Repository/CI/test cleanup.
2. Runtime gap register, tool-failure event, long-frame split, model fallback, runtime health.
3. Desktop UI and truthfulness.
4. Mobile packaging identity and build profiles.
5. Mobile C1–C12 and v1 product surface.
6. Linux/hosting packaging.
7. Documentation and claims.
8. Code Freeze.

Parallel work is allowed only with disjoint file scopes. One writer per file. The Lead owns
`package.json`, CI, git and the final diff.

## 6. Verification after Code Freeze

Run one gate at a time on a quiet tree:

- `bun run typecheck:node`
- `bun run typecheck:renderer`
- `bun run typecheck:mobile`
- `bun run build`
- `bun scripts/i18n-check.ts`
- `bun run check:staged`
- DeepSeek E2E gates, Stage-1 gates, runtime gates and Team API routes
- Live G-T1: three tool turns, restart, one more tool turn; pack import; persistence; clean close;
  key scan
- APK build/install and physical phone matrix: LAN, Tailscale, DeepSeek turn, long reasoning, model
  switch, errors, background/resume, push, upload and revocation
- Linux package verification and VPS host reboot/restore test if that route is selected
- GitHub Actions CI
- Public push to `deep-bots` only

Flaky gates need 3 quiet runs or 2-of-3. No parallel Electron/gates.

## 7. Research tickets

| ID | Question | Source |
|---|---|---|
| R1 | Exact Expo 58 / EAS local APK flow and prerequisites | Expo versioned docs; `apps/mobile/AGENTS.md` |
| R2 | Android signing, versionCode and ADB verification | Android developer docs; local SDK |
| R3 | Tailscale private route and account-origin rules | Tailscale docs; mobile research; host code |
| R4 | VPS systemd/Ubuntu/firewall/backup | Hostinger docs; `docs/self-hosted-server.md` |
| R5 | Signed-in pairing versus server invitation | `incoming-link-screen.tsx`, `mobile-auth.ts`, `ServerMembersSection.tsx` |
| R6 | Installed APK version/signing | `adb shell dumpsys package` |
| R7 | New FCM project for the new package id | Firebase/Expo docs |

No external claim enters this plan without a URL and a retrieval date.

## 8. Risks and rollback

- Broken public CI: fix before Code Freeze; follow up with commits, never force-push.
- Missing Android toolchain: install JDK/SDK with user approval; EAS cloud fallback.
- New package id: separate app; old app remains installable; own signing.
- Signed-in pairing: explicit sign-out confirmation; server-invitation path.
- Windows firewall: least-privilege rule; preflight names program and port.
- VPS rebuild: snapshot first; systemd host; restore test.
- Licence: PolyForm NC; no commercial launch; non-affiliation copy.
- Secrets: never commit keys, `.env`, keystores or logs.

## 9. Acceptance

- [ ] All coding tasks done or explicitly deferred.
- [ ] No stubs, dead aliases or missing scripts.
- [ ] Public CI resolves every alias.
- [ ] Live G-T1, pack import, persistence and clean close pass.
- [ ] New APK installs and pairs through the correct flow.
- [ ] Mobile v1 P0/P1 features exist and are verified on a phone.
- [ ] Linux/VPS route works if selected.
- [ ] README and plan match the real state.
- [ ] No secrets or internal artifacts in the public tree.

## 10. Deferred, named gaps

- Full product identity migration and 11,486-key rebrand.
- Admission gate and per-bot instruction export.
- Self-hosted Cloudflare Worker/Signal/TURN.
- iOS/TestFlight and Play Store production release.
- Mobile P2/P3 features and a measured competitor-parity claim.

## 11. Execution prompt

```text
You are the Lead engineer for DeepSeek Bots.

Repository: the public deep-bots fork of OpenBot. Work on main. Never push to origin.

Read first:
- docs/plans/DEEPSEEK-BOTS-COMPLETION-PLAN.md
- README.md
- docs/mobile/ research
- docs/audit-findings.md and docs/live-test-runbook.md
- AGENTS.md and the scoped AGENTS.md files

Rule zero:
Do not run a full build, project-wide typecheck, full test suite, APK build, Linux build, VPS deploy,
GitHub CI or acceptance gate until every coding task is DONE and Code Freeze is declared. Use only
narrow RED/GREEN probes while coding.

Hard rules:
- Never print, log or commit the DeepSeek key.
- One writer per file. The Lead owns package.json, CI, git and the final diff.
- No mocks, stubs, fake success or test weakening.
- Do not change productName, appId, userData, Team API wire meanings or SQLite schema without a user
  decision.
- Ask before a VPS rebuild, package-id change, store release or commercial launch.

Work through:
1. Repository/CI/test cleanup.
2. Runtime gap register and desktop engine fixes.
3. Desktop UI truthfulness.
4. Mobile packaging identity.
5. Mobile C1–C12 and v1 product surface.
6. Linux/hosting packaging.
7. Documentation and claims.
8. Code Freeze.

After Code Freeze, run the full verification matrix, the live G-T1 and phone tests, then push to
deep-bots. Report Done / Not done / Unverified with commands and paths.
```
