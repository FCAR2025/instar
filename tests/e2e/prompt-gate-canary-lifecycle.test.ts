import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { AgentServer } from '../../src/server/AgentServer.js';
import { SafeFsExecutor } from '../../src/core/SafeFsExecutor.js';
import { StateManager } from '../../src/core/StateManager.js';
import type { InstarConfig } from '../../src/core/types.js';

describe('PromptGate provider canary lifecycle', () => {
  let tmpDir: string;
  let server: AgentServer;
  const authToken = 'prompt-gate-canary-lifecycle';
  const evaluate = vi.fn(async () => 'NO_PROMPT');
  const sessionManager = {
    listRunningSessions: vi.fn(() => []),
    getCachedRunningSessions: vi.fn(() => ({ count: 0, sessions: [] })),
    getSession: vi.fn(() => null),
    getRunningSessionPanePids: vi.fn(() => []),
    on: vi.fn(),
  };

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-gate-canary-e2e-'));
    const stateDir = path.join(tmpDir, '.instar');
    fs.mkdirSync(path.join(stateDir, 'state', 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(stateDir, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'config.json'), JSON.stringify({ port: 0, projectName: 'canary-e2e' }));
    const config = {
      projectName: 'canary-e2e', projectDir: tmpDir, stateDir, port: 0,
      authToken, requestTimeoutMs: 10_000, version: '0.0.0',
      sessions: {
        claudePath: '/usr/bin/echo', maxSessions: 3, defaultMaxDurationMinutes: 30,
        protectedSessions: [], monitorIntervalMs: 5000,
        componentFrameworks: { overrides: { PromptGate: 'claude-code' } },
      },
      scheduler: { enabled: false, jobsFile: '', maxParallelJobs: 1 },
      messaging: [], monitoring: { promptGate: { enabled: true }, resourceLedger: { enabled: false } }, updates: {},
    } as InstarConfig;
    server = new AgentServer({
      config,
      sessionManager: sessionManager as any,
      state: new StateManager(stateDir),
      intelligence: { evaluate },
    });
    await server.start();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await server.stop();
    SafeFsExecutor.safeRmSync(tmpDir, {
      recursive: true,
      force: true,
      operation: 'tests/e2e/prompt-gate-canary-lifecycle.test.ts',
    });
  });

  it('is alive through AgentServer and does not enumerate or create sessions', async () => {
    const res = await request(server.getApp())
      .post('/prompt-gate/canary')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-Instar-AgentId', 'canary-e2e');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, expected: 'NO_PROMPT', actual: 'NO_PROMPT' });
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(sessionManager.listRunningSessions).not.toHaveBeenCalled();
  });
});
