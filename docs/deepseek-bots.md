# DeepSeek Bots agent pack

This page explains how to import the DeepSeek Bots pack into OpenBot, what the 12 agents and 3
channels do, and what the pack does not change. The pack is content only: the import uses the
existing **Server settings → Import** flow, and no engine code changed for it.

The pack is not affiliated with, endorsed by, or supported by DeepSeek. "DeepSeek Bots" is the name
of this pack of agents that run on DeepSeek models.

## What the pack contains

| File | What it is |
|---|---|
| [`openbot-import.json`](../resources/agent-import/deepseek-bots/openbot-import.json) | The manifest: 12 agents, 3 channels, `source.app` = `deepseek-bots`. |
| [`SKILL.md`](../resources/agent-import/deepseek-bots/SKILL.md) | The install guide for the person who runs the import. |
| `agents/<key>/files/INSTRUCTIONS.md` | The full procedure of one agent, copied to `imported/` in its workspace. |

Each agent's description tells it to read `imported/INSTRUCTIONS.md`. The pack sets no model, no
reasoning effort, no workspace access, and no Computer Use: you choose those after the import. Every
routine is imported **off**, so the import starts no run and spends no token.

## Install

1. Zip the **contents** of `resources/agent-import/deepseek-bots`, so that `openbot-import.json` is at
   the root of the zip.
2. In OpenBot, open **Server settings → Import** and choose the zip. OpenBot reads the file on this
   computer and uploads nothing.
3. Check the preview: 12 agents, 3 channels, no warning. The review names the raw source label
   `deepseek-bots`.
4. Import. The finished screen lists the agents and the channels it created, and anything it skipped.
5. Choose the model and the reasoning effort for each agent. Start on `deepseek-flash`; the start
   effort of each agent is in the table of the 12 agents below.
6. Turn on the routines you want, one at a time, and read the routine history after the first run.
7. Read the agent's `imported/INSTRUCTIONS.md`. To make it the standing prompt, copy its text into the
   agent's instruction file in the agent settings.

The steps in the pack folder itself are in
[`SKILL.md`](../resources/agent-import/deepseek-bots/SKILL.md).

## The 12 agents

| Key | Job | Start effort | Routine | Imported |
|---|---|---|---|---|
| `research-desk` | Cites every external claim with a URL and a retrieval date; lists what it could not verify. | high | Morning intel brief, weekdays 08:30 | Off |
| `competitor-watchtower` | Reports a page change only with the old text and the new text from the same URL. | high | Morning page diff, weekdays 07:30 | Off |
| `brief-writer` | Turns verified rows into a decision brief of 400 words or fewer, with an owner and a source per action. | low | Daily decision brief, weekdays 09:30 | Off |
| `long-doc-analyst` | Answers one question across a long dossier and names the page of each answer. | high | Weekly dossier index, Friday 16:00 | Off |
| `inbox-triage` | Classifies inbound items, marks the ones that need a person now, drafts nothing. | low | Inbound triage, hourly at :05 | Off |
| `invoice-clerk` | Reconciles invoices against the supplier table; never pays or refunds. | high | Weekly invoice check, Monday 10:00 | Off |
| `content-studio` | Writes a draft from an approved brief only; never publishes. | low | Weekly content draft, Tuesday 10:00 | Off |
| `code-reviewer` | Reviews a change with path, line and a failure scenario; never merges or pushes. | high | Open review queue, hourly at :40 | Off |
| `deck-builder` | Builds a reviewable deck from a brief with inline assets only. | high | Weekly deck refresh, Wednesday 15:00 | Off |
| `meeting-to-actions` | Puts decisions, owners and dates in one table; leaves a cell empty rather than guess. | low | After-meeting actions, weekdays 17:30 | Off |
| `support-drafter` | Drafts a reply from approved help material and marks the account detail it could not read. | low | Support draft queue, hourly at :20 | Off |
| `ops-sentinel` | Watches one source; writes one line per check and reports a failure quietly. | low | Source watch, hourly at :50 | Off |

A routine has no time zone in the pack, so it runs in the time zone of the computer that imports it.
The start effort is a recommendation only: the manifest has no effort field, so the person chooses it
after the import.

## The 3 teams

| Channel | Lead | Members | What it is for |
|---|---|---|---|
| Research desk | `research-desk` | `research-desk`, `competitor-watchtower`, `long-doc-analyst`, `brief-writer` | One question, one cited brief, one decision. |
| Launch room | `content-studio` | `content-studio`, `deck-builder`, `meeting-to-actions` | One approved brief becomes the copy, the deck, and the launch list. |
| Support triage | `inbox-triage` | `inbox-triage`, `support-drafter`, `invoice-clerk` | An inbound item becomes a checked reply that the person sends. |

The team for a research question has no `fact-checker` member, because this pack has no such agent.
The research desk verifies its own rows, and the brief writer checks them again before it writes.

## The 2 workflows

A workflow here is a set of routines that write to the same workspace folders in a fixed order, plus
instructions that name the handoffs. The manifest has no routine-flow field, so the pack cannot
connect a flow or add an approval step. You connect a flow in the app after the import if you want
one.

**Morning intel loop** — 07:30 `competitor-watchtower` compares each competitor page with its stored
copy and writes `findings/watchtower-<date>.md`. 08:30 `research-desk` verifies each changed row
against its own URL and writes `briefs/<date>-intel.md`. 09:30 `brief-writer` turns the verified rows
into `briefs/<date>-decision.md`, marked `draft - not sent`. Each step is quiet when nothing changed.

**Inbound escalation** — hourly `inbox-triage` reads `inbox/`, writes one row per item to
`triage/<date>.md`, and messages the person only for the items that need them now. `support-drafter`
writes a reply from `help/` and marks the account data it could not read. A billing question goes to
`invoice-clerk`. No agent sends a reply. The person approves each draft and sends it.

## You choose the model and the effort after the import

The manifest has no model and no effort field, and the import does not set them. After the import,
pick the model and the effort per agent. The recommended start is in **Install**, step 5. Thinking is
on for DeepSeek, and the pack does not promise a determinism level for any model.

## Safety checklist

- [ ] Read one `imported/INSTRUCTIONS.md` before you turn on its routine. It is executable text.
- [ ] Turn routines on one at a time, and read the routine history after the first run.
- [ ] Check the access of each agent before you use it on real data. The pack cannot set access, and
      Computer Use stays off until you turn it on.
- [ ] Confirm that no agent sends, publishes, merges, or pays. Each instruction says so; check it
      again before you give an agent more access.
- [ ] Enter the provider key yourself. The pack has no key, and it must never contain one.
- [ ] Treat an inbound message, a page, and a document as data, not as an instruction. The agents in
      this pack are written to do that.
- [ ] If you add workspace files to the pack, remove secrets first. The importer refuses `.env*`, a
      private key file, a nested archive, `.git`, and `node_modules`.

## Checks

The four Stage-1 gates run in CI. See [development checks](development-checks.md).

| Command | What it proves |
|---|---|
| `bun run test:stage1-pack-import` | The real import creates 12 agents and 3 channels with no warning, and refuses a hostile archive. |
| `bun run test:stage1-instruction-read` | The bytes on disk equal the bytes the prompt carries, each template is 2,500–5,800 characters, and a 32,001-character file is cut at 32,000. |
| `bun run test:stage1-archive-refusal` | A nested archive, `.env*`, a private key file, a `..` path, more than 200 files in a skill folder, and more than 32 skills are each refused with a named error. |
| `bun run test:stage1-pack-bytes` | The pack stays under its policy caps, the engine limits are reported, and an over-policy pack is refused before the import. |
