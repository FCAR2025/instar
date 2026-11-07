# Side-effects review: memory-hygiene works on SemanticMemory, not MEMORY.md

**Version / slug:** `memory-hygiene-store-skill`
**Date:** `2026-11-07`
**Author:** `instar (evolution-proposal-implement job, EVO-001)`
**Second-pass reviewer:** `not required` (skill text plus a content migration; no sentinel, guard, gate, session lifecycle or messaging decision)

**Summary.** Tier 1: a skill wording change plus its update step. Files: `src/data/builtinSkillContent.ts` (new `MEMORY_HYGIENE_SKILL_CONTENT`), `src/commands/init.ts` (the `memory-hygiene` entry uses it and applies the agent port to every occurrence), `src/core/PostUpdateMigrator.ts` (`migrateMemoryHygieneStoreSkill`, run after `migrateSkillPortHardcoding`), one test file and two fixtures. Size: 3 source files, about 230 lines, most of it the skill text. Effort: one build pass, one commit attempt round for the instar-dev artifacts.

**Decision points.** None added or changed in runtime code. The migration has one structural condition: it rewrites the installed skill only when the file still holds the stock old text (`name: memory-hygiene` and the exact line `Fix duplicates and minor cleanups directly (edit the file)`) and lacks the new marker `Never edit MEMORY.md directly`.

1. **Over-block** — No block/allow surface. The migration skips a stock skill whose old line was reworded by hand; that agent keeps its own text, which is the intended rule for customized skills.
2. **Under-block** — No block/allow surface. An agent that customized the skill keeps the old hand-edit instruction; the fresh-install path and every stock copy get the new text.
3. **Level of abstraction** — The fix is in the skill, the layer that gave the wrong instruction. MEMORY.md stays a generated artifact owned by `POST /semantic/export-memory`; the skill now drives the store through the existing `/semantic/remember`, `/semantic/supersede`, `/semantic/verify/:id` and `/semantic/export-memory` routes. No new route.
4. **Signal vs authority** — No change holds blocking authority. See `docs/signal-vs-authority.md`.
4b. **Judgment-point check** — No new static heuristic at a competing-signals decision point. Which entries are duplicates is left to the running agent's judgment, read from content, with every change logged and reversible.
5. **Interactions** — Runs after `migrateSkillPortHardcoding`, which also touches this skill; the new content already carries `${INSTAR_PORT:-<port>}`, so the two never fight, and a second run changes nothing (test d). `installBuiltinSkills` stays install-if-missing. The memory-export job still owns MEMORY.md; the skill calls the same export.
6. **External surfaces** — The installed `.claude/skills/memory-hygiene/SKILL.md` changes on existing agents with the stock copy. The skill now writes to the store through existing routes and keeps backups and an action log under `.instar/state/memory-hygiene/`. It never calls `DELETE /semantic/forget`.
6b. **Operator-surface quality** — No operator surface — not applicable.
7. **Multi-machine posture** — Machine-local by design: the skill file and the store each live on one machine, and the job runs where it is scheduled. The skill writes through the local server's routes, so any replication those routes already perform applies unchanged. No notices, no URLs.
8. **Rollback** — Revert and ship a patch. Agents that already migrated keep the new skill text; it uses only existing routes, so it keeps working. Retired entries are kept and restorable one by one from the action log.

## Conclusion

Clear to ship. The review changed nothing in the design.

## Evidence pointers

- `tests/unit/memory-hygiene-store-skill.test.ts`: 6 tests (rendered content equals the reviewed text; fresh install has the new text and the agent port in every place and no backslash-backtick pair; migration of the real old installed skill; second run unchanged; customized skill untouched; missing file no-op).
- Live: one agent on 2026-11-07 ran this method by hand: 211 of 228 entities retired, MEMORY.md 7,498 to 2,586 words.

## Class-Closure Declaration (display-only mirror)

This fixes a defect in an agent-authored skill: its instruction edited a generated file instead of that file's source of truth. No class in `docs/defect-classes.json` matches it closely, and this change adds no new class entry, so the commit carries no machine-readable declaration; the report-only class-closure lint will log it as missing.
