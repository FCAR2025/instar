# One memory entry per job, in plain words

> The one-line version: a job that runs every day now keeps one memory entry per kind of note and updates it, instead of adding a fresh near-copy every run.

## The problem in one breath

After each work session, the activity sentinel asks a model to pull out facts, decisions and patterns, and saves them to the agent's memory store. To avoid saving the same thing twice it checks whether an entry with exactly the same name already exists. But the model words things a little differently every time ("Disk usage 56%", "disk health 57%", "Disk headroom"), so a job that runs daily adds new copies every day. On one agent, 211 of 228 memory entries were such copies from scheduled jobs.

## What already exists

- **The activity sentinel** turns each session into a digest and saves the entries it finds.
- **The memory store** can find an entry by its exact name, or by its source label.
- **The memory-hygiene job** cleans up copies after the fact (see the companion change).

## What this adds

For scheduled-job sessions, the entry is now found by a label the system writes itself, never by the model's wording: the job's name plus the kind of entry, for example "health-check, fact". If that entry exists, its text is replaced with this run's notes and its "last checked" time is refreshed; if not, it is created. So each job keeps at most one entry per kind, always holding the latest run. One run is sometimes saved in several pieces (its chat and its terminal output, or a mid-run check and the final summary); pieces of the same run are combined, never overwrite each other. When a new run replaces the entry, the links the old run attached to it are removed too, so the entry's links always match its text. Ordinary conversations work exactly as before.

## The new pieces

- **Update in place for memory entries** — the store can now replace one entry's text. The change is written to the store's recovery log, so rebuilding the store from that log keeps the latest text, and search finds the new words and stops finding the old ones.
- **Remove an entry's run links** — the store can now remove the links one entry got from session digests, leaving every other link alone. This is also written to the recovery log and replayed on rebuild.

## The safeguards

**Wording can no longer create copies on this path.** The match is on a label the system builds, so no rewording can miss it.

**Nothing old is removed.** Copies already saved stay until the hygiene job retires them.

## What ships when

One change: the update-in-place step, the job-keyed saving, and tests that run the same job many times with changing wording and find exactly one entry per kind.

## What you actually need to decide

Nothing new: this carries out the approved proposal EVO-002.
