# Upgrade Guide — vNEXT

<!-- bump: patch -->

## What Changed

Recurring jobs now keep one memory entry per job and kind (fact, decision, pattern and so on), and update it on each run. Before, every run added a new entry whenever the model worded the same thing a little differently, so a daily health check could add dozens of near-copies. Entries already saved are not removed; the memory-hygiene job retires them. Conversations that are not scheduled jobs behave as before.

## What to Tell Your User

No action is needed. Your agent's memory will stop filling up with repeated notes from jobs that run on a schedule.

## Summary of New Capabilities

| Capability | How to Use |
|-----------|-----------|
| One memory entry per job and kind | Automatic: each job run refreshes its entry instead of adding a new one. |

## Evidence

Measured on one agent's store on 2026-11-07: 211 of 228 entries were such copies from job sessions. Unit tests run the same job 6 times with different wording, and 25 times with random wording, and find exactly one entry per job and kind, with the latest content, intact after a rebuild from the journal and found by search.
