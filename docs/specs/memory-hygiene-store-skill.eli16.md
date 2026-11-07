# Memory hygiene that sticks, in plain words

> The one-line version: the memory-hygiene job now cleans the memory store and rebuilds MEMORY.md from it, instead of editing a file that gets rebuilt anyway.

## The problem in one breath

Every agent keeps its long-term memory in a store (SemanticMemory). The file MEMORY.md is not written by hand: the memory-export job rebuilds it from the store, keeping the 200 most trusted entries and dropping anything below a trust floor of 0.2. The memory-hygiene job was told to "fix duplicates directly (edit the file)", so every cleanup it made was thrown away at the next export, and the duplicates came straight back.

## What already exists

- **The memory store** keeps every entry with a trust score (confidence), and can mark one entry as replaced by another (supersede) or set a new trust score (verify).
- **The export** rebuilds MEMORY.md from the store and leaves out low-trust entries.
- **The hygiene job** runs on a schedule and reviews memory quality.

## What this adds

The hygiene skill now works on the store. It backs up the store and the file, groups entries that say the same thing in different words, writes one clear entry per group, and retires each copy: it marks the copy as replaced and lowers its trust to 0.1, so the copy stays in the store (and can be restored) but no longer reaches MEMORY.md. Then it rebuilds MEMORY.md and records the word count before and after. An agent with no store keeps the old hand-edit path, because there the file really is hand-maintained. On one agent on 2026-11-07 this method retired 211 of 228 entries and cut MEMORY.md from 7,498 to 2,586 words.

## The safeguards

**Nothing is deleted.** Copies are retired, not forgotten; every change is logged with its old trust score so it can be undone in one call.

**Customized skills are left alone.** Existing agents get the new skill on update only if their copy is still the stock old text. A skill someone has edited is not touched, and running the update twice changes nothing the second time.

## What ships when

One change: the new skill text, the update step for existing agents, and tests for both.

## What you actually need to decide

Nothing new: this carries out the approved proposal EVO-001.
