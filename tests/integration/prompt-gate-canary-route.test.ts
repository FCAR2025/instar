import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRoutes, type RouteContext } from '../../src/server/routes.js';
import { authMiddleware } from '../../src/server/middleware.js';

const AUTH = 'prompt-gate-canary-test-token';

function appWith(input: { enabled?: boolean; evaluate?: (prompt: string, options?: any) => Promise<string> }) {
  const sessionManager = {
    getCachedRunningSessions: vi.fn(() => ({ count: 0, sessions: [] })),
    listRunningSessions: vi.fn(() => []),
  };
  const ctx = {
    config: {
      projectName: 'test', projectDir: '/tmp', stateDir: '/tmp/.instar', port: 0,
      authToken: AUTH,
      sessions: { componentFrameworks: { overrides: { PromptGate: 'claude-code' } } },
      scheduler: {},
      monitoring: { promptGate: { enabled: input.enabled ?? true } },
    },
    sessionManager,
    state: { getJobState: () => null, getSession: () => null },
    scheduler: null,
    intelligence: input.evaluate ? { evaluate: input.evaluate } : null,
    startTime: new Date(),
  } as unknown as RouteContext;
  const app = express();
  app.use(express.json());
  app.use(authMiddleware(() => AUTH, 'test'));
  app.use('/', createRoutes(ctx));
  return { app, sessionManager };
}

describe('POST /prompt-gate/canary', () => {
  it('reports configured PromptGate posture even when no relay adapter is configured', async () => {
    const { app } = appWith({ evaluate: async () => 'NO_PROMPT' });

    const res = await request(app)
      .get('/prompt-gate/status')
      .set('Authorization', `Bearer ${AUTH}`)
      .set('X-Instar-AgentId', 'test');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enabled: true,
      intelligenceConfigured: true,
      relayConfigured: false,
    });
  });

  it('runs a no-session provider canary without touching session state', async () => {
    const evaluate = vi.fn(async () => 'NO_PROMPT');
    const { app, sessionManager } = appWith({ evaluate });

    const res = await request(app)
      .post('/prompt-gate/canary')
      .set('Authorization', `Bearer ${AUTH}`)
      .set('X-Instar-AgentId', 'test');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, expected: 'NO_PROMPT', actual: 'NO_PROMPT' });
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(sessionManager.getCachedRunningSessions).not.toHaveBeenCalled();
    expect(sessionManager.listRunningSessions).not.toHaveBeenCalled();
  });

  it('returns 503 when PromptGate is disabled or no provider is wired', async () => {
    const disabled = appWith({ enabled: false, evaluate: async () => 'NO_PROMPT' }).app;
    const unavailable = appWith({}).app;
    const headers = { Authorization: `Bearer ${AUTH}`, 'X-Instar-AgentId': 'test' };

    expect((await request(disabled).post('/prompt-gate/canary').set(headers)).status).toBe(503);
    expect((await request(unavailable).post('/prompt-gate/canary').set(headers)).status).toBe(503);
  });
});
