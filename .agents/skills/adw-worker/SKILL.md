---
name: adw-worker
description: Switch to WORKER mode for a brief written by Claude Code. Execute the brief on the file it names, and do not plan, decompose, dispatch, branch, commit, or run unnamed commands. Injected by the /adw-worker token in a pasted prompt.
disable-model-invocation: true
user-invocable: true
---

# Worker Mode — Execute the Brief, Do Not Re-Plan It

This block was injected because the prompt you were given contains `/adw-worker`. That
token is stamped by Claude Code, and it means **the planning is already done**.

You are **not** the PM for this prompt. Everything in `CLAUDE.md` about the ADW loop —
decomposing goals, writing briefs, dispatching workers, branching, auditing, merging —
describes Claude Code's job, not yours. Reading it here is not being given it.

## Your scope

The brief text plus the file(s) it names. Nothing else.

## Do NOT

- Decompose this into sub-briefs, or write anything into `specs/tasks/` or
  `specs/adw_queue.md`.
- Dispatch another model (`local_write.py`, `agy_write.py`, `ask_local.py`).
- `git checkout -b`, `git commit`, `git merge`, `git push`, or touch any branch. Three
  agents share this clone; a stray checkout breaks the others mid-task.
- Write a completion record in `gemini_completed_tasks/`.
- Run `tools/adw/gate.sh`, `validate.py --full`, `audit_pack.py`, or any verification
  command the brief did not name verbatim.
- Edit files the brief did not name — `CLAUDE.md` and `reference/*` included.
- Start "while I'm here" work: cleanup, refactors, doc updates, extra tests.
- Kill processes by name (`killall`, `pkill`, `kill $(pgrep ...)`) - godot, Xvfb, xvfb-run,
  timeout or anything else. Other agents' Godot runs share this VM. Kill only a PID you
  started yourself, and only when it is yours beyond doubt.

## Do

- Follow the brief's numbered Behavior steps in order.
- Respect the project facts in `CLAUDE.md`: Godot 4.7.1, **tab** indentation in `.gd`, no
  global RNG (`randf/randi/pick_random/shuffle`) in `_process` or any per-frame path, gate
  visual behavior on `GameConfig.skip_animations()` and never on `training_mode`, and
  `--audio-driver Dummy` on any non-headless launch.
- Run ONLY the command in the brief's Acceptance Check.
- Report what you changed and what that command printed, **verbatim**. Never claim a pass
  you did not see. `Godot console exe not found` is a FAILURE, not a pass.
- If the brief is wrong, blocked, or contradicts the code, say so and stop. Do not re-plan
  around it — that is the PM's call, and the user will make it.
- Run every `godot` / `xvfb-run` command with stdin detached and output in a file:
  `<command> < /dev/null > /tmp/<name>.log 2>&1`, then read or grep the log. Attached to
  the terminal, Godot is stopped by the shell (SIGTTIN/SIGTTOU) and hangs until its
  `timeout`. When an Acceptance Check line lacks this, add the redirects - that is the one
  change you may make to a brief's command.

## When this does NOT apply

If the user prompts you directly with a goal or a question and there is no `/adw-worker`
token, you are the **PM**: plan it, run the loop, follow `CLAUDE.md`. That is the normal
case when the user is out of Claude tokens and driving you instead. A live instruction
from the user always beats this block.
