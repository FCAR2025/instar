---
name: memory-hygiene
description: Clean the memory store (SemanticMemory) — retire duplicate and stale entities, then regenerate MEMORY.md
metadata:
  user_invocable: "false"
---

# Memory Hygiene — clean the store, then regenerate MEMORY.md

## Why this skill works on the store

`.instar/MEMORY.md` is generated. The memory-export job rebuilds it from SemanticMemory with `POST /semantic/export-memory`: the top 200 entities by confidence, then lastVerified, and nothing under confidence 0.2. A hand edit to MEMORY.md is overwritten on the next export.

**Never edit MEMORY.md directly when the store is on.** Change the store, then regenerate the file.

## Procedure

Set up:

```
AUTH="${INSTAR_AUTH_TOKEN:-$(python3 -c "import json; v=json.load(open('.instar/config.json')).get('authToken',''); print(v if isinstance(v, str) else '')" 2>/dev/null)}"
AGENT=$(python3 -c "import json; print(json.load(open('.instar/config.json')).get('agentName','Agent'))" 2>/dev/null)
STAMP=$(date -u +%Y%m%dT%H%MZ)
DIR=.instar/state/memory-hygiene
mkdir -p "$DIR"
```

### 0. Is the store on?

```
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $AUTH" http://localhost:${INSTAR_PORT:-4040}/semantic/stats
```

- `200`: the store is on. Follow steps 1 to 6.
- `503`: this agent has no store, and MEMORY.md is maintained by hand. Review the file against the checks in step 5 and edit it directly. Then write the handoff and stop.

### 1. Back up and measure

```
curl -s -H "Authorization: Bearer $AUTH" http://localhost:${INSTAR_PORT:-4040}/semantic/export > "$DIR/pre-hygiene-export-$STAMP.json"
cp .instar/MEMORY.md "$DIR/pre-hygiene-MEMORY-$STAMP.md"
wc -w < .instar/MEMORY.md
```

Record the word count as "before".

### 2. List duplicate clusters from the store

Read `entities` in the export (`id`, `type`, `name`, `content`, `confidence`, `source`, `sourceSession`). Only entities at confidence 0.2 or more reach MEMORY.md, so work on those.

- **Duplicates.** Group entities that state the same fact in different words, for example "Stop-event authority drift", "stop authorization drift" and "authority-check drift". Compare content, not names.
- **Stale.** An entity is stale when the path, URL, API or feature it cites no longer exists. Check with `ls` or `curl` before you call it stale.

Write the clusters and the stale list to `$DIR/clusters-$STAMP.json` before you change anything.

### 3. One canonical entity per cluster

For each cluster, write one entity that keeps every concrete fact the copies held: paths, numbers, commands and dates.

```
curl -s -X POST http://localhost:${INSTAR_PORT:-4040}/semantic/remember \
  -H "Authorization: Bearer $AUTH" -H 'Content-Type: application/json' \
  -d '{"type":"fact","name":"NAME","content":"CONTENT","confidence":0.8,"source":"memory-hygiene STAMP","tags":["memory-hygiene"]}'
```

Record the returned `id` as the canonical id.

### 4. Retire each copy (kept, reversible)

For each copy, supersede it, then set its confidence to 0.1. That keeps the copy in the store and drops it below the export floor.

```
curl -s -X POST http://localhost:${INSTAR_PORT:-4040}/semantic/supersede \
  -H "Authorization: Bearer $AUTH" -H 'Content-Type: application/json' \
  -d '{"oldId":"OLD_ID","newId":"CANONICAL_ID","reason":"memory-hygiene STAMP: duplicate of CANONICAL_ID"}'
curl -s -X POST http://localhost:${INSTAR_PORT:-4040}/semantic/verify/OLD_ID \
  -H "Authorization: Bearer $AUTH" -H 'Content-Type: application/json' \
  -d '{"confidence":0.1}'
```

- Both calls are required. Supersede alone only halves confidence: 0.7 becomes 0.35, which is still exported.
- A stale entity with no replacement gets only the verify call.
- Never use `DELETE /semantic/forget`. It cannot be undone.

Log every change as one JSON line in `$DIR/actions-$STAMP.jsonl`:

```
{"op":"retire","oldId":"...","oldName":"...","oldConfidence":0.7,"newId":"...","setConfidence":0.1,"reason":"..."}
```

To undo one change, call `POST /semantic/verify/<oldId>` with its `oldConfidence`.

### 5. Regenerate MEMORY.md and check it

```
curl -s -X POST http://localhost:${INSTAR_PORT:-4040}/semantic/export-memory \
  -H "Authorization: Bearer $AUTH" -H 'Content-Type: application/json' \
  -d "{\"filePath\":\".instar/MEMORY.md\",\"agentName\":\"$AGENT\"}"
wc -w < .instar/MEMORY.md
```

Record the word count as "after". If the response has `skipped` or `fallback`, stop and report it. Do not hand-edit the file.

Then read the regenerated file:

- **No substance.** An entity that says nothing concrete ("Remember to check caching behavior") is retired through step 4, or rewritten as a new canonical entity through step 3.
- **Size.** Over 5000 words: retire the bottom 20% by usefulness through step 4.
- **Unsure.** Do not retire an entity you are unsure about. List it under "Flagged" in the handoff.

### 6. Duplicates that came back

If a cluster has copies created after the last hygiene run, something keeps writing them. Log a learning:

```
curl -s -X POST http://localhost:${INSTAR_PORT:-4040}/evolution/learnings \
  -H "Authorization: Bearer $AUTH" -H 'Content-Type: application/json' \
  -d '{"category":"memory","insight":"...","confidence":"high"}'
```

## Handoff

```
echo "Last hygiene: $(date -u). Words: BEFORE before, AFTER after. Clusters: N. Retired: N (superseded and set to confidence 0.1, kept in store). Flagged: N. Actions: $DIR/actions-$STAMP.jsonl" > .instar/state/job-handoff-memory-hygiene.md
```

If you found no cluster and no stale entity, exit silently.
