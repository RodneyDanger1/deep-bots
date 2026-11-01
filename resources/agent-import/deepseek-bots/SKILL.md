---
name: deepseek-bots-pack
description: How to install the DeepSeek Bots agent pack into OpenBot, and what the pack does and does not set. Covers the one .zip import file, the 12 agents and 3 channels it adds, what it cannot set, and the safety rules to check before you enable anything. Use when a person asks how to import this pack, or what the pack changes.
---

# Install the DeepSeek Bots pack

This folder is a **static import pack**. It holds the manifest `openbot-import.json`, the workspace
files of 12 agents under `agents/<key>/files/`, and this guide. OpenBot reads the pack through its
normal **Server settings → Import** flow. Nothing is uploaded and nothing runs on install.

This is not an export skill. It does not read anything from another product, and it cannot make an
export. The 12 agents are written content, not a conversion of an existing account.

## Steps

1. **Make the file.** Zip the **contents** of this folder, so that `openbot-import.json` is at the
   root of the zip and not inside a folder. Name it `deepseek-bots.zip`.
2. **Import it.** Open OpenBot and go to **Server settings → Import**. Choose the zip. OpenBot reads
   it on this computer.
3. **Review the preview.** It lists 12 agents and 3 channels, with no warnings. The review shows the
   raw source label `deepseek-bots`.
4. **Import.** Each agent gets its name, title, description, memories, routines, and its files under
   `imported/` in its workspace. Each channel gets its members, its lead, and its instructions.
5. **Read the procedure.** Each agent's description tells it to read `imported/INSTRUCTIONS.md`. That
   file is the full procedure. To make it the standing prompt, copy its text into the agent's
   instruction file (`AGENTS.md`) in the agent settings. The pack cannot do that for you.
6. **Choose the model and the effort.** The pack sets neither. Pick the model and the effort for each
   agent after the import.
7. **Switch on the routines you want.** Every routine is imported **off**. Nothing runs and nothing
   costs anything until you turn a routine on.

## What the pack sets

| Item | Set by the pack |
|---|---|
| Agent name, title, description | Yes |
| Workspace files, at `imported/` | Yes, including `INSTRUCTIONS.md` |
| Routines, with a schedule | Yes, imported **inactive** |
| Memories | Yes |
| Channels, members, lead, instructions | Yes |

## What the pack cannot set

- **Model and reasoning effort.** You choose both after the import. The pack has no such field.
- **Workspace access and Computer Use.** An imported agent gets the host defaults. The manifest has no
  access field, so only you can widen access. Computer Use stays off until you turn it on.
- **The provider key.** Enter it yourself in **Settings → Providers**. The pack has no credential and
  must never contain one.
- **Routine flows, webhooks, and approval steps.** The pack carries routines only. A workflow in this
  pack is a set of routines that write to the same folder in order, plus instructions that tell the
  agent to ask you before it sends, publishes, or pays. It is not a configured flow.
- **Skills.** This pack ships no skill folder. Install the skill packs separately.

## Safety

- An agent can read and write this computer and run commands, under the access the host grants after
  first-launch consent. Treat every instruction file as executable text: read it before you enable a
  routine.
- A routine that is on spends tokens on its schedule. Turn on one routine at a time and read its
  history.
- No agent in this pack pays, refunds, sends mail, publishes, or merges. The routines and the
  instructions say this. Check it again before you give an agent more access.
- The pack has no secret: no key, token, password, cookie, or private key. If you add a file to it,
  remove secrets first. OpenBot refuses an archive with a `.env*` file, a private key file, a nested
  archive, `.git`, or `node_modules`.
- Nothing here is affiliated with, endorsed by, or supported by DeepSeek. "DeepSeek Bots" names this
  pack of agents for DeepSeek models.

## If something fails

- **The import refuses the file.** Check that `openbot-import.json` is at the root of the zip, and
  that the zip has no nested archive, `.env*` file, private key file, or `..` path.
- **An agent has no instructions.** Look for `imported/INSTRUCTIONS.md` in its workspace. The files
  are copied by the import; the instruction file at the workspace root is yours to write.
- **A routine does not run.** It is imported off. Turn it on, then read the routine history, not the
  conversation.
