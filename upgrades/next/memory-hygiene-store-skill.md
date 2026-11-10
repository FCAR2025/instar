# Upgrade Guide — vNEXT

<!-- bump: patch -->

## What Changed

The memory-hygiene job now cleans the memory store and then regenerates MEMORY.md. Before, it edited MEMORY.md by hand, but that file is rebuilt from the store on every export, so its cleanups were overwritten. The job now finds duplicate and stale entries in the store, merges each group into one entry, retires the old copies in a way that can be undone, and regenerates the file. Existing agents get the new skill on update. A skill you have customized is left as it is.

## What to Tell Your User

No action is needed. The memory cleanup job now keeps its changes instead of losing them at the next memory export.

## Summary of New Capabilities

| Capability | How to Use |
|-----------|-----------|
| Memory cleanup that lasts | Runs with the memory-hygiene job; it changes the memory store, then regenerates MEMORY.md. |

## Evidence

Unit tests check that the installed skill matches the shipped text, uses the agent's port in every command, and tells the agent never to edit MEMORY.md directly. They also check that the update replaces the old skill once, leaves a second run unchanged, and leaves a customized skill alone.
