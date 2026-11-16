# AGENTS.md - gst-graph-ref

Working guide for any agent (or person) in this repo. Read this first.

Project: **gst-graph-ref**  ·  Org: **Personal**  ·  Repo: https://github.com/gak4u/gst-graph  ·  Scaffolded 2026-11-16
GStreamer graph reference (remote gst-graph)

## Documentation lives in this repo

`docs/` is the source of truth. Keep it current as the code changes.

- `docs/README.md` - the living overview. What this is, how to run it, current state. Update it whenever that changes.
- `docs/architecture.md` - how it is built: components, data flow, the decisions that shaped it.
- `docs/decisions.md` - a dated log. Append new decisions with a date; do not rewrite old ones.
- `docs/wiki/` - topic pages for cross-cutting notes and gotchas. One topic per file, kebab-case. Link pages with `[[page-name]]`.

Rule: when you change something the docs record (a feature ships or is withdrawn, config or a rail changes, a known issue is fixed or found), edit the matching section and its "Last updated" date before you finish. Do not keep a parallel Notion wiki for this project - Notion indexes, the repo holds the truth.

## Wider context: the global glossary

Every durable operator memory across all machines is indexed in Notion as **Knowledge Base -> Memory Index**:

  https://app.notion.com/p/41a4549d8bef8163bf07f26771aa6c54

Use it when you need context beyond this repo - how another project, org or host works, a shared convention, a gotcha already learned elsewhere. Filter by **Org** (jQode / Tesseract / IXG / SKWAD / Personal) or **Area**, read the rows; each row carries its **Repo**, **Project folder** and **Source path**.

Pull only what you need - do not drag unrelated context in.

Local fallbacks when Notion is not reachable (e.g. inside a sandboxed engine):
- the per-project memory store `~/.claude/projects/<dir>/memory/*.md` (each file is one fact, frontmatter: name, description, type)
- the Hermes wiki `~/HermesDrive/wiki`

## Feeding the glossary back

When you learn a durable, non-obvious fact about this project that a future session would want (a constraint, a gotcha, where something lives), write it as a memory file under this machine's `~/.claude/projects/<dir>/memory/` with `name` / `description` / `type` frontmatter. It flows into the Notion index on the next machine sync. Keep it one fact per file; link related facts with `[[name]]`.

## House rules (operator conventions)

- Secrets never raw: reference locations (`~/secrets/...`, `.env`), never paste a credential; scan before anything leaves the machine.
- Writing in Anil's voice (emails, outreach, anything outward-facing): plain human tone, no em-dashes, no AI-tell arrow bullets.
- Never reset, restart or deploy a live/production instance without checking it is idle and backed up. Workers never deploy; the controller deploys after review.
- Commit in small logical steps and stage by explicit path (`git add src/x`), not `git add -A`, so stray untracked files are never swept in.
- Resolve ambiguity with the most reasonable reading and list what you assumed, rather than stalling.
