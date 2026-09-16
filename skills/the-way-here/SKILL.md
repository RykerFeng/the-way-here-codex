---
name: the-way-here
description: Explicitly connect the user's chosen personal website, Yuque site, GitHub source, ZIP, file, or folder to the current Codex task as their evidence-backed personal history. Use only when the user invokes $the-way-here.
---

# The Way Here

Bring the user's chosen past into this task without turning old records into a fixed identity.

## Enter

Resolve the CLI once:

```bash
node <skill-directory>/scripts/resolve-cli.mjs
```

The script prints the absolute CLI path. Use that path for later commands.

- With an input after `$the-way-here`, run `node <cli> enter <input>`.
- Without an input, run `node <cli> enter`; it reuses the default profile immediately and refreshes its connections in the background.
- Treat an explicitly supplied personal homepage, Yuque space, ZIP, file, or folder as `memory / user / personal`; the user's choice to call it their “way here” is the scope declaration. GitHub defaults to `reference / other / sourced` unless the user clearly says it contains their own personal record. Still inspect quotes, fiction, team writing, and hypothetical passages instead of attributing every sentence to the user.
- Report the Here Card and sync coverage in one short paragraph. Say when coverage is partial.
- Remote sources sync in the background. If `sync.state` is `pending` or `running`, keep working with the existing snapshot and use `sync-status <job-id>` before the first recall that depends on newly added material. Do not block ordinary conversation on a full-site crawl.
- If a job is `failed`, report the short error and keep using the existing snapshot. Retry only when it is useful with `sync <connection-id> --restart --start`; content IDs and hashes make the retry idempotent.

This activation applies to the current conversation workflow. Do not modify `AGENTS.md`, Codex memory, config, shell startup files, or other automatic-loading settings.

## Recall

Use the current message to choose `moment`, `change`, `relationship`, `pattern`, or `quote`. Expand the question into 2–4 short searches that may cross work, life, relationships, and ideas, then call `recall` once.

Read at most three strong pieces of evidence. For changes, use different event times. A document edit time is not an event time.

Only say the user experienced, decided, or believed something when the evidence identifies the user as the subject and is personal in scope. Being the document author is insufficient: the content may be a quote, book note, team document, fictional writing, or hypothetical example.

If a relevant source is `unknown`, present it as unconfirmed. When the user clearly confirms that the source contains their own experience, use `mark <source-id> --as memory --authorship user --content-scope personal`; do not infer or persist that confirmation silently.

Separate current user statements, source facts, and your interpretation. Cite the source title, event date or “日期未知”, lines, and origin. If evidence is insufficient, say so.

After recall returns and before writing the user-facing answer, read `references/narrative-voice.md`. Apply it only to this recall answer; it does not change global Codex style or any other task.

## Remember

Ordinary conversation is never saved automatically. Run `remember` only after the user clearly asks to save something. Store the user's confirmed words or decision as personal/user evidence; keep Codex-written context separate.

## Stop

When the user invokes `$the-way-here off` or asks to stop using it, do not call the CLI again in this task. Explain that passages already shown in the conversation cannot be removed from its existing context.
