import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PostUpdateMigrator } from '../../src/core/PostUpdateMigrator.js';
import { SafeFsExecutor } from '../../src/core/SafeFsExecutor.js';
import { installBuiltinSkills } from '../../src/commands/init.js';
import { MEMORY_HYGIENE_SKILL_CONTENT } from '../../src/data/builtinSkillContent.js';

type MigrationResult = { upgraded: string[]; skipped: string[]; errors: string[] };
const FIX = path.join(__dirname, '..', 'fixtures', 'skills');
const OLD_PHRASE = 'Fix duplicates and minor cleanups directly (edit the file)';
const MARKER = 'Never edit MEMORY.md directly';

describe('memory-hygiene store skill', () => {
  let projectDir: string;
  let skillFile: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instar-memory-hygiene-'));
    fs.mkdirSync(path.join(projectDir, '.instar'), { recursive: true });
    skillFile = path.join(projectDir, '.claude', 'skills', 'memory-hygiene', 'SKILL.md');
  });

  afterEach(() => {
    SafeFsExecutor.safeRmSync(projectDir, {
      recursive: true,
      force: true,
      operation: 'tests/unit/memory-hygiene-store-skill.test.ts:cleanup',
    });
  });

  function migrate(): MigrationResult {
    const migrator = new PostUpdateMigrator({
      projectDir,
      stateDir: path.join(projectDir, '.instar'),
      port: 4321,
      hasTelegram: false,
      projectName: 'test',
    });
    const result: MigrationResult = { upgraded: [], skipped: [], errors: [] };
    (migrator as unknown as { migrateMemoryHygieneStoreSkill(r: MigrationResult): void }).migrateMemoryHygieneStoreSkill(result);
    return result;
  }

  function installOld(content?: string): string {
    const old = content ?? fs.readFileSync(path.join(FIX, 'memory-hygiene-pre-store.md'), 'utf8');
    fs.mkdirSync(path.dirname(skillFile), { recursive: true });
    fs.writeFileSync(skillFile, old);
    return old;
  }

  it('(a) constant equals the reviewed skill text', () => {
    expect(MEMORY_HYGIENE_SKILL_CONTENT).toBe(fs.readFileSync(path.join(FIX, 'memory-hygiene-store.md'), 'utf8'));
  });

  it('(b) fresh install uses the agent port everywhere and no stale phrase or escapes', () => {
    const skillsDir = path.join(projectDir, '.claude', 'skills');
    installBuiltinSkills(skillsDir, 4321);
    const text = fs.readFileSync(skillFile, 'utf8');
    expect(text).toContain(MARKER);
    expect(text).toContain('${INSTAR_PORT:-4321}');
    expect(text).not.toContain('${INSTAR_PORT:-4040}');
    expect(text).not.toContain(OLD_PHRASE);
    expect(text).not.toContain('\\`');
  });

  it('(c) migrates the old installed skill', () => {
    installOld();
    const result = migrate();
    const text = fs.readFileSync(skillFile, 'utf8');
    expect(text).not.toContain(OLD_PHRASE);
    expect(text).toContain(MARKER);
    expect(text).toContain('${INSTAR_PORT:-4321}');
    expect(text).not.toContain('${INSTAR_PORT:-4040}');
    expect(result.errors).toEqual([]);
    expect(result.upgraded.filter((u) => u.includes('memory-hygiene'))).toHaveLength(1);
  });

  it('(d) second run changes nothing', () => {
    installOld();
    migrate();
    const first = fs.readFileSync(skillFile);
    const result = migrate();
    expect(fs.readFileSync(skillFile).equals(first)).toBe(true);
    expect(result.upgraded.filter((u) => u.includes('memory-hygiene'))).toHaveLength(0);
  });

  it('(e) customized skill is left untouched', () => {
    const custom = fs.readFileSync(path.join(FIX, 'memory-hygiene-pre-store.md'), 'utf8').replace(OLD_PHRASE, 'My own rule');
    installOld(custom);
    const result = migrate();
    expect(fs.readFileSync(skillFile, 'utf8')).toBe(custom);
    expect(result.upgraded).toEqual([]);
  });

  it('(f) missing skill file is a no-op', () => {
    const result = migrate();
    expect(result.errors).toEqual([]);
    expect(result.upgraded).toEqual([]);
    expect(fs.existsSync(skillFile)).toBe(false);
  });
});
