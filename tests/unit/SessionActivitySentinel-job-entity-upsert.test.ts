/**
 * Property tests: a job session keeps one memory entity per (jobSlug, type),
 * keyed by a source string our builder writes, never by LLM-worded names.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Session, IntelligenceProvider } from '../../src/core/types.js';
import { SessionActivitySentinel } from '../../src/monitoring/SessionActivitySentinel.js';
import { SemanticMemory } from '../../src/memory/SemanticMemory.js';
import type { TelegramLogEntry } from '../../src/memory/ActivityPartitioner.js';
import { SafeFsExecutor } from '../../src/core/SafeFsExecutor.js';

type Ent = { type: string; name: string; content: string; relationships?: { to: string; relation: string }[] };

let dir: string;
let stateDir: string;
let sm: SemanticMemory;
let nextEntities: Ent[] = [];
let queue: Ent[][] = [];

function digestJson(entities: Ent[]): string {
  return JSON.stringify({
    summary: 'job run',
    actions: [],
    learnings: [],
    significance: 5,
    themes: [],
    entities: entities.map(e => ({ relationships: [], ...e })),
  });
}

function makeLog(): TelegramLogEntry[] {
  const base = Date.parse('2026-02-27T10:00:00Z');
  return Array.from({ length: 10 }, (_, i) => ({
    topicId: 1,
    type: 'text',
    from_user: i % 2 === 0 ? 0 : 1,
    text: `Message ${i}`,
    timestamp: new Date(base + i * 60_000).toISOString(),
  }));
}

function makeSession(jobSlug: string | undefined, runId: string): Session {
  return {
    id: `session-${runId}`,
    name: `sess-${runId}`,
    status: 'running',
    tmuxSession: 'job-tmux',
    startedAt: '2026-02-27T10:00:00Z',
    jobSlug,
    prompt: 'work',
  };
}

function makeSentinel(): SessionActivitySentinel {
  const intelligence: IntelligenceProvider = {
    async evaluate() {
      return digestJson(queue.length > 0 ? queue.shift()! : nextEntities);
    },
  };
  return new SessionActivitySentinel({
    stateDir,
    intelligence,
    getActiveSessions: () => [],
    captureSessionOutput: () => 'agent did some work for a few minutes',
    getTelegramMessages: () => makeLog(),
    getTopicForSession: () => 1,
    semanticMemory: sm,
  });
}

async function runOnce(s: SessionActivitySentinel, jobSlug: string | undefined, runId: string, ents: Ent[]) {
  nextEntities = ents;
  const digests = await s.digestActivity(makeSession(jobSlug, runId));
  expect(digests.length).toBeGreaterThan(0);
}

function all(type: string) {
  return sm.export().entities.filter(e => e.type === type);
}

describe('SessionActivitySentinel — job entity upsert', () => {
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-job-upsert-'));
    stateDir = path.join(dir, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    sm = new SemanticMemory({ dbPath: path.join(stateDir, 'semantic.db'), stateDir });
    await sm.open();
  });
  afterEach(() => {
    sm.close();
    SafeFsExecutor.safeRmSync(dir, {
      recursive: true,
      force: true,
      operation: 'tests/unit/SessionActivitySentinel-job-entity-upsert.test.ts:cleanup',
    });
  });

  it('(a) 6 runs with differently worded names leave one row per type, holding the last run', async () => {
    const s = makeSentinel();
    const N = 6;
    for (let i = 1; i <= N; i++) {
      await runOnce(s, 'health-check', `a${i}`, [
        { type: 'fact', name: `Disk usage ${50 + i}% run${i}`, content: `disk reading alpha${i}` },
        { type: 'fact', name: `Memory headroom ${i}`, content: `memory reading beta${i}` },
        { type: 'decision', name: `Decision of day ${i}`, content: `decided gamma${i}` },
      ]);
    }
    const facts = all('fact');
    const decisions = all('decision');
    expect(facts).toHaveLength(1);
    expect(decisions).toHaveLength(1);
    expect(sm.findBySource('job-digest:health-check:fact')?.id).toBe(facts[0].id);
    expect(sm.findBySource('job-digest:health-check:decision')?.id).toBe(decisions[0].id);
    expect(facts[0].content).toBe(
      `- Disk usage ${50 + N}% run${N}: disk reading alpha${N}\n- Memory headroom ${N}: memory reading beta${N}`,
    );
    expect(decisions[0].content).toBe(`- Decision of day ${N}: decided gamma${N}`);
    expect(facts[0].sourceSession).toBe(`session-a${N}`);
    expect(Date.parse(facts[0].lastVerified)).toBeGreaterThan(Date.parse(facts[0].createdAt) - 1);
  });

  it('(b) 25 seeded random-name runs still leave exactly one row per (jobSlug, type)', async () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const words = ['disk', 'cpu', 'queue', 'latency', 'backup', 'cert', 'heap', 'socket', 'cache', 'lag'];
    const w = () => words[Math.floor(rnd() * words.length)] + Math.floor(rnd() * 1000);
    const types = ['fact', 'decision', 'pattern'];
    const s = makeSentinel();
    for (let i = 0; i < 25; i++) {
      await runOnce(s, 'rand-job', `b${i}`, types.map(t => ({ type: t, name: `${w()} ${w()}`, content: `${w()} ${w()}` })));
    }
    for (const t of types) {
      expect(all(t)).toHaveLength(1);
      expect(sm.findBySource(`job-digest:rand-job:${t}`)).not.toBeNull();
    }
  });

  it('(c) two job slugs never share a row', async () => {
    const s = makeSentinel();
    await runOnce(s, 'job-one', 'c1', [{ type: 'fact', name: 'same name', content: 'from one' }]);
    await runOnce(s, 'job-two', 'c2', [{ type: 'fact', name: 'same name', content: 'from two' }]);
    expect(all('fact')).toHaveLength(2);
    expect(sm.findBySource('job-digest:job-one:fact')?.content).toBe('- same name: from one');
    expect(sm.findBySource('job-digest:job-two:fact')?.content).toBe('- same name: from two');
  });

  it('(d) interactive session (no jobSlug) still dedupes by exact name', async () => {
    const s = makeSentinel();
    await runOnce(s, undefined, 'd1', [{ type: 'fact', name: 'Exact Name', content: 'first' }]);
    await runOnce(s, undefined, 'd2', [{ type: 'fact', name: 'exact name', content: 'second' }]);
    await runOnce(s, undefined, 'd3', [{ type: 'fact', name: 'Other Name', content: 'third' }]);
    const facts = all('fact');
    expect(facts).toHaveLength(2);
    expect(facts.find(f => f.name === 'Exact Name')?.content).toBe('first');
  });

  it('(e) rebuild from the journal restores the latest content', async () => {
    const s = makeSentinel();
    for (let i = 1; i <= 4; i++) {
      await runOnce(s, 'dur-job', `e${i}`, [{ type: 'fact', name: `name ${i}`, content: `content ${i}` }]);
    }
    const before = sm.findBySource('job-digest:dur-job:fact')!;
    sm.rebuild();
    const after = sm.findBySource('job-digest:dur-job:fact')!;
    expect(all('fact')).toHaveLength(1);
    expect(after.id).toBe(before.id);
    expect(after.content).toBe('- name 4: content 4');
    expect(after.sourceSession).toBe('session-e4');
    expect(after.lastVerified).toBe(before.lastVerified);
  });

  it('(f) FTS follows the update', async () => {
    const s = makeSentinel();
    await runOnce(s, 'fts-job', 'f1', [{ type: 'fact', name: 'n1', content: 'zebraonly marker' }]);
    await runOnce(s, 'fts-job', 'f2', [{ type: 'fact', name: 'n2', content: 'quokkaonly marker' }]);
    expect(sm.search('quokkaonly').map(r => r.source)).toContain('job-digest:fts-job:fact');
    expect(sm.search('zebraonly').map(r => r.source)).not.toContain('job-digest:fts-job:fact');
  });

  it('updateContent returns false for an unknown id', () => {
    expect(sm.updateContent('no-such-id', { content: 'x', lastVerified: new Date().toISOString() })).toBe(false);
  });

  // ── Review round 1 (ROOT-CAUSE-EVO-002-r2) ──────────────────────────

  function edgesOf(fromId: string) {
    return sm.export().edges.filter(x => x.fromId === fromId);
  }

  it('P1: one run digested in 2 units keeps both units\' facts', async () => {
    const s = makeSentinel();
    queue = [
      [{ type: 'fact', name: 'Disk usage 56%', content: 'disk at 56 percent' }],
      [{ type: 'fact', name: 'Cert expiry', content: 'TLS cert expires in 3 days' }],
    ];
    await s.digestActivity(makeSession('health-check', 'r1'));
    await s.digestActivity(makeSession('health-check', 'r1'));
    const e = sm.findBySource('job-digest:health-check:fact')!;
    expect(e.content).toBe('- Disk usage 56%: disk at 56 percent\n- Cert expiry: TLS cert expires in 3 days');
  });

  it('P2: an edge written by run 1 does not outlive the content it described', async () => {
    const dockerId = sm.remember({
      type: 'tool', name: 'Docker', content: 'container runtime', confidence: 0.9,
      lastVerified: new Date().toISOString(), source: 'manual', tags: [],
    });
    const s = makeSentinel();
    queue = [[{
      type: 'fact', name: 'Docker daemon down', content: 'docker was restarted',
      relationships: [{ to: 'Docker', relation: 'related_to' }],
    }]];
    await s.digestActivity(makeSession('health-check', 'r1'));
    const keyed = sm.findBySource('job-digest:health-check:fact')!;
    expect(edgesOf(keyed.id).filter(x => x.toId === dockerId)).toHaveLength(1);

    queue = [[{ type: 'fact', name: 'Disk usage 57%', content: 'disk at 57 percent' }]];
    await s.digestActivity(makeSession('health-check', 'r2'));
    expect(edgesOf(keyed.id).filter(x => x.toId === dockerId)).toHaveLength(0);

    queue = [[{
      type: 'fact', name: 'Docker again', content: 'docker restarted again',
      relationships: [{ to: 'Docker', relation: 'related_to' }],
    }]];
    await s.digestActivity(makeSession('health-check', 'r3'));
    const back = edgesOf(keyed.id).filter(x => x.toId === dockerId);
    expect(back).toHaveLength(1);
    expect(back[0].context).toBe('digest:session-r3');
  });

  it('newlines in names and content collapse to one line per member', async () => {
    const s = makeSentinel();
    queue = [[{ type: 'fact', name: 'a\r\nb', content: 'c\nd\r\ne' }]];
    await s.digestActivity(makeSession('nl-job', 'n1'));
    expect(sm.findBySource('job-digest:nl-job:fact')!.content).toBe('- a b: c d e');
  });

  it('P3: an incoming edge written by run 1 does not outlive the target content it described', async () => {
    const s = makeSentinel();
    queue = [[
      { type: 'fact', name: 'Docker daemon down', content: 'docker was down',
        relationships: [{ to: 'Restart docker', relation: 'caused' }] },
      { type: 'decision', name: 'Restart docker', content: 'restarted the daemon' },
    ]];
    await s.digestActivity(makeSession('health-check', 'r1'));
    const decision = sm.findBySource('job-digest:health-check:decision')!;
    expect(sm.export().edges.filter(x => x.toId === decision.id)).toHaveLength(1);
    queue = [[{ type: 'decision', name: 'Rotate certs', content: 'rotated TLS certs' }]];
    await s.digestActivity(makeSession('health-check', 'r2'));
    expect(decision.id).toBe(sm.findBySource('job-digest:health-check:decision')!.id);
    expect(sm.findBySource('job-digest:health-check:decision')!.content).toBe('- Rotate certs: rotated TLS certs');
    expect(sm.export().edges.filter(x => x.toId === decision.id && (x.context ?? '').startsWith('digest:'))).toHaveLength(0);
  });

  const TYPES = ['fact', 'decision', 'pattern'];
  const externals = ['X0', 'X1', 'X2', 'X3'];
  function generateWide(seed0: number) {
    let seed = seed0;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
    let n = 0;
    const runs = int(2, 6);
    return Array.from({ length: runs }, () =>
      Array.from({ length: int(1, 3) }, () => {
        const types = TYPES.filter(() => rnd() < 0.6);
        if (types.length === 0) types.push(TYPES[int(0, 2)]);
        const unit: Ent[] = [];
        for (const type of types) {
          for (let k = int(1, 2); k > 0; k--) unit.push({ type, name: `n${n++} ${type}`, content: `c${int(0, 99)}`, relationships: [] });
        }
        for (const e of unit) {
          for (let k = int(0, 3); k > 0; k--) {
            const r = rnd();
            const to = r < 0.5 ? unit[int(0, unit.length - 1)].name
              : r < 0.85 ? externals[int(0, externals.length - 1)] : `Missing ${int(0, 3)}`;
            e.relationships!.push({ to, relation: rnd() < 0.5 ? 'related_to' : 'caused' });
          }
        }
        return unit;
      }),
    );
  }
  function seedExternals(): Map<string, string> {
    const m = new Map<string, string>();
    for (const t of externals) {
      m.set(t, sm.remember({
        type: 'tool', name: t, content: `ext ${t}`, confidence: 0.9,
        lastVerified: new Date().toISOString(), source: `manual:${t}`, tags: [],
      }));
    }
    return m;
  }
  function assertOwnership() {
    const { entities, edges } = sm.export();
    const byId = new Map(entities.map(e => [e.id, e]));
    for (const x of edges) {
      if (!(x.context ?? '').startsWith('digest:')) continue;
      for (const end of [x.fromId, x.toId]) {
        const ent = byId.get(end)!;
        if (ent.source.startsWith('job-digest:')) expect(x.context).toBe(`digest:${ent.sourceSession}`);
      }
    }
  }

  it('property: every digest edge touching a keyed entity belongs to that entity\'s current run', async () => {
    const ext = seedExternals();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const jobSlug = `wide-${seed}`;
      const corpus = generateWide(seed * 104729);
      const s = makeSentinel();
      for (let r = 0; r < corpus.length; r++) {
        const expected = new Set<string>();
        for (const unit of corpus[r]) {
          queue = [unit];
          await s.digestActivity(makeSession(jobSlug, `w${seed}-${r}`));
          const idOf = (type: string) => sm.findBySource(`job-digest:${jobSlug}:${type}`)!.id;
          for (const e of unit) {
            const from = idOf(e.type);
            for (const rel of e.relationships ?? []) {
              const peer = unit.find(u => u.name.toLowerCase() === rel.to.toLowerCase());
              const to = peer ? idOf(peer.type) : ext.get(rel.to);
              if (to && to !== from) expected.add(`${from}|${to}|${rel.relation}`);
            }
          }
        }
        assertOwnership();
        const have = new Set(sm.export().edges.map(x => `${x.fromId}|${x.toId}|${x.relation}`));
        for (const e of expected) expect(have.has(e)).toBe(true);
      }
    }
  });

  it('rebuild from the journal reproduces the same content and edge set', async () => {
    const corpus = generateWide(424242);
    seedExternals();
    const s = makeSentinel();
    for (let r = 0; r < corpus.length; r++) {
      for (const unit of corpus[r]) {
        queue = [unit];
        await s.digestActivity(makeSession('dur2', `d${r}`));
      }
    }
    const snapshot = () => ({
      content: sm.export().entities.filter(e => e.source.startsWith('job-digest:dur2:')).map(e => `${e.source}=${e.content}`).sort(),
      edges: sm.export().edges.map(x => `${x.id}|${x.fromId}|${x.toId}|${x.relation}|${x.context}`).sort(),
    });
    const before = snapshot();
    expect(before.edges.length).toBeGreaterThan(0);
    sm.rebuild();
    expect(snapshot()).toEqual(before);
  });

  describe('removeEdgesTouching', () => {
    const mk = (name: string) => sm.remember({
      type: 'tool', name, content: name, confidence: 0.9,
      lastVerified: new Date().toISOString(), source: `manual:${name}`, tags: [],
    });
    const journalDisconnects = () =>
      fs.readFileSync(path.join(stateDir, 'semantic.jsonl'), 'utf-8')
        .split('\n').filter(l => l.includes('"action":"disconnect"')).length;

    it('removes matching-prefix edges in both directions for that entity only', () => {
      const a = mk('a'); const b = mk('b'); const c = mk('c'); const d = mk('d');
      sm.connect(a, b, 'related_to', 'digest:s1');   // out
      sm.connect(c, a, 'related_to', 'digest:s1');   // in
      sm.connect(a, d, 'related_to', 'supersede: replaced');
      sm.connect(a, c, 'built_by');                  // null context
      sm.connect(b, c, 'related_to', 'digest:s1');   // other entities
      expect(sm.removeEdgesTouching(a, 'digest:')).toBe(2);
      const left = sm.export().edges.map(x => `${x.fromId}>${x.toId}:${x.context}`).sort();
      expect(left).toEqual([`${a}>${c}:undefined`, `${a}>${d}:supersede: replaced`, `${b}>${c}:digest:s1`].sort());
      expect(journalDisconnects()).toBe(1);
    });

    it('treats % and _ literally and returns 0 without journaling when nothing matches', () => {
      const a = mk('a'); const b = mk('b');
      sm.connect(a, b, 'related_to', 'digest:s1');
      expect(sm.removeEdgesTouching(a, '%')).toBe(0);
      expect(sm.removeEdgesTouching(b, 'dig_st:')).toBe(0);
      expect(sm.removeEdgesTouching(a, 'nomatch')).toBe(0);
      expect(journalDisconnects()).toBe(0);
      expect(sm.export().edges).toHaveLength(1);
    });
  });
});
