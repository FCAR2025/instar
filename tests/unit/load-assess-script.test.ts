/**
 * load-assess.sh — script behavior (CMT-1703, spec robust-load-assessment-fleet).
 *
 * Runs the REAL template script with the LOAD_ASSESS_FORCE_IDLE test seam to
 * exercise the verdict-threshold boundaries deterministically, plus the --json
 * contract and the fail-soft path (no server → ledger=unavailable, still a verdict).
 */
import { afterEach, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { SafeFsExecutor } from '../../src/core/SafeFsExecutor.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../../src/templates/scripts/load-assess.sh');
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    SafeFsExecutor.safeRmSync(dir, {
      recursive: true,
      force: true,
      operation: 'tests/unit/load-assess-script.test.ts',
    });
  }
});

function run(forceIdle: string | null, json = true): string {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (forceIdle !== null) env.LOAD_ASSESS_FORCE_IDLE = forceIdle;
  const args = json ? ['--json'] : [];
  return execFileSync('bash', [SCRIPT, ...args], { env, encoding: 'utf-8', timeout: 20000 });
}

describe('load-assess.sh — verdict thresholds (both sides of each boundary)', () => {
  it('idle <12% → SATURATED', () => {
    expect(JSON.parse(run('5')).verdict).toBe('SATURATED');
    expect(JSON.parse(run('11.9')).verdict).toBe('SATURATED');
  });
  it('boundary 12: idle 12% → ELEVATED (not SATURATED)', () => {
    expect(JSON.parse(run('12')).verdict).toBe('ELEVATED');
  });
  it('12–30% → ELEVATED', () => {
    expect(JSON.parse(run('20')).verdict).toBe('ELEVATED');
    expect(JSON.parse(run('29.9')).verdict).toBe('ELEVATED');
  });
  it('boundary 30: idle 30% → OK (not ELEVATED)', () => {
    expect(JSON.parse(run('30')).verdict).toBe('OK');
  });
  it('>30% → OK', () => {
    expect(JSON.parse(run('62')).verdict).toBe('OK');
  });
});

describe('load-assess.sh — --json contract', () => {
  it('emits valid JSON with the documented fields', () => {
    const j = JSON.parse(run('45'));
    expect(['OK', 'ELEVATED', 'SATURATED', 'UNKNOWN']).toContain(j.verdict);
    expect(typeof j.cpuIdlePercent === 'number' || j.cpuIdlePercent === null).toBe(true);
    expect(j.scope).toBe('cpu-capacity-only'); // scope honesty — not a universal health oracle
    expect(typeof j.os).toBe('string');
    expect(j).toHaveProperty('loadAvg5'); // load average present but it is CONTEXT only
  });
});

describe('load-assess.sh — fail-soft', () => {
  it('still emits a verdict when the ResourceLedger is unreachable (no server in test env)', () => {
    const j = JSON.parse(run('40'));
    // run from src/templates/scripts → no .instar/config.json → no auth → ledger unavailable
    expect(j.ledger).toContain('unavailable');
    expect(j.verdict).toBe('OK'); // verdict still derived from CPU idle%, not the ledger
  });
  it('human-readable output names the verdict and demotes load average to context', () => {
    const out = run('40', false);
    expect(out).toContain('VERDICT:');
    expect(out).toContain('context only');
    expect(out).toContain('CPU capacity only');
  });

  it('reads legacy config authToken and derives the agent id when the vault and projectName are absent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'load-assess-config-auth-'));
    tempDirs.push(root);
    const scriptsDir = path.join(root, '.instar', 'scripts');
    const binDir = path.join(root, 'bin');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(scriptsDir, 'load-assess.sh'));
    fs.writeFileSync(path.join(root, '.instar', 'config.json'), JSON.stringify({
      port: 4040,
      authToken: 'fixture-token',
    }));
    const expectedAgentId = path.basename(root);
    fs.writeFileSync(path.join(binDir, 'curl'), `#!/usr/bin/env bash\ncase "$*" in\n  *"Authorization: Bearer fixture-token"*"X-Instar-AgentId: ${expectedAgentId}"*) printf '%s\\n' '{"sampleCount":3,"sources":[{"source":"aggregate","avgCpuPercent":12,"peakCpuPercent":34,"currentCpuPercent":5}]}' ;;\n  *) printf '%s\\n' '{"error":"wrong auth"}' ;;\nesac\n`);
    fs.chmodSync(path.join(binDir, 'curl'), 0o755);

    const out = execFileSync('bash', [path.join(scriptsDir, 'load-assess.sh'), '--json'], {
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, LOAD_ASSESS_FORCE_IDLE: '40' },
      encoding: 'utf-8',
      timeout: 20000,
    });

    expect(JSON.parse(out).ledger).toBe('avg=12 peak=34 current=5 samples=3');
  });

  it('emits valid single-line JSON when curl fails after malformed output and Linux ps contains quotes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'load-assess-fail-soft-json-'));
    tempDirs.push(root);
    const scriptsDir = path.join(root, '.instar', 'scripts');
    const binDir = path.join(root, 'bin');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(scriptsDir, 'load-assess.sh'));
    fs.writeFileSync(path.join(root, '.instar', 'config.json'), JSON.stringify({
      port: 4040,
      authToken: 'fixture-token',
    }));
    fs.writeFileSync(path.join(binDir, 'curl'), '#!/usr/bin/env bash\nprintf %s "{bad"\nexit 28\n');
    fs.writeFileSync(path.join(binDir, 'ps'), `#!/usr/bin/env bash\ncase "$*" in\n  *"--sort=-pcpu"*) printf '%s\\n' '91.2 "quoted-node"' '8.0 rustc' '3.0 bash' ;;\n  *) exit 9 ;;\nesac\n`);
    fs.chmodSync(path.join(binDir, 'curl'), 0o755);
    fs.chmodSync(path.join(binDir, 'ps'), 0o755);

    const out = execFileSync('bash', [path.join(scriptsDir, 'load-assess.sh'), '--json'], {
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, LOAD_ASSESS_FORCE_IDLE: '40' },
      encoding: 'utf-8',
      timeout: 20000,
    });
    const parsed = JSON.parse(out);

    expect(out.trim().split('\n')).toHaveLength(1);
    expect(parsed.ledger).toBe('unavailable');
    expect(parsed.topConsumer).toBe('"quoted-node"');
    expect(parsed.topClass).toContain('agent-work');
  });
});
