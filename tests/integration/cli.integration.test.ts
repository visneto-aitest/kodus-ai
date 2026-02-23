import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startMockServer, type MockServer } from './mock-server.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CLI_PATH = path.join(PROJECT_ROOT, 'dist/index.js');

let mockServer: MockServer;
let tmpHome: string;
let gitRepoDir: string;

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function parseFirstJsonObject(output: string): any {
  const start = output.indexOf('{');
  if (start === -1) {
    throw new Error('No JSON object found in CLI output');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < output.length; i++) {
    const ch = output[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      continue;
    }

    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(output.slice(start, i + 1));
      }
    }
  }

  throw new Error('Incomplete JSON object in CLI output');
}

async function runCli(
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync('node', [CLI_PATH, ...args], {
      cwd: opts.cwd ?? gitRepoDir,
      env: {
        PATH: process.env.PATH,
        HOME: tmpHome,
        KODUS_API_URL: mockServer.url,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        NODE_NO_WARNINGS: '1',
        ...opts.env,
      },
      timeout: 30_000,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      exitCode: typeof error.code === 'number' ? error.code : 1,
    };
  }
}

async function createTempGitRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodus-test-repo-'));
  await execFileAsync('git', ['init'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

beforeAll(async () => {
  // 1. Isolated HOME so ~/.kodus is temp
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'kodus-test-home-'));
  const kodusDir = path.join(tmpHome, '.kodus');
  await fs.mkdir(kodusDir, { recursive: true });

  // 2. Team key config
  await fs.writeFile(
    path.join(kodusDir, 'config.json'),
    JSON.stringify({
      teamKey: 'kodus_test_key',
      teamName: 'Test Team',
      organizationName: 'Test Org',
    }),
  );

  // 3. Git repo with uncommitted changes
  gitRepoDir = await createTempGitRepo();
  await fs.writeFile(path.join(gitRepoDir, 'test.ts'), 'let x = 1;\nlet y = 2;\n');
  await execFileAsync('git', ['add', '.'], { cwd: gitRepoDir });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: gitRepoDir });
  await fs.writeFile(path.join(gitRepoDir, 'test.ts'), 'let x = 1;\nlet y = 2;\nlet z = 3;\n');

  // 4. Mock API server
  mockServer = await startMockServer();
});

afterAll(async () => {
  await mockServer?.close();
  if (tmpHome) await fs.rm(tmpHome, { recursive: true, force: true });
  if (gitRepoDir) await fs.rm(gitRepoDir, { recursive: true, force: true });
});

beforeEach(() => {
  mockServer.reset();
});

// ---------------------------------------------------------------------------
// Smoke tests — no API needed
// ---------------------------------------------------------------------------
describe('CLI smoke', () => {
  it('prints version', async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
    const { stdout, exitCode } = await runCli(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
  });

  it('prints help with main commands', async () => {
    const { stdout, exitCode } = await runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('review');
    expect(stdout).toContain('auth');
  });

  it('prints review subcommand help', async () => {
    const { stdout, exitCode } = await runCli(['review', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--staged');
    expect(stdout).toContain('--fast');
    expect(stdout).toContain('--prompt-only');
  });
});

// ---------------------------------------------------------------------------
// Review command — full round-trip through mock server
// ---------------------------------------------------------------------------
describe('review integration', () => {
  it('returns JSON review result', async () => {
    const { stdout, exitCode } = await runCli(['review', '--fast', '--format', 'json']);
    expect(exitCode).toBe(0);

    const json = parseFirstJsonObject(stdout);
    expect(json).toHaveProperty('summary');
    expect(json).toHaveProperty('issues');
    expect(json.issues).toHaveLength(2);
    expect(json.filesAnalyzed).toBe(1);
    expect(json.duration).toBe(1234);
  });

  it('sends X-Team-Key header when using team key', async () => {
    await runCli(['review', '--fast', '--format', 'json']);

    const req = mockServer.requests.find((r) => r.url === '/cli/review');
    expect(req).toBeDefined();
    expect(req!.headers['x-team-key']).toBe('kodus_test_key');
    // Should NOT have Authorization header
    expect(req!.headers['authorization']).toBeUndefined();
  });

  it('sends diff in request body', async () => {
    await runCli(['review', '--fast', '--format', 'json']);

    const req = mockServer.requests.find((r) => r.url === '/cli/review');
    expect(req).toBeDefined();
    expect(req!.body).toHaveProperty('diff');
    expect(req!.body.diff).toContain('let z = 3');
  });

  it('reports "No changes" when working tree is clean', async () => {
    const cleanRepo = await createTempGitRepo();
    await fs.writeFile(path.join(cleanRepo, 'file.ts'), 'const x = 1;\n');
    await execFileAsync('git', ['add', '.'], { cwd: cleanRepo });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: cleanRepo });

    try {
      const { stdout, stderr } = await runCli(['review', '--format', 'json'], { cwd: cleanRepo });
      const output = stdout + stderr;
      expect(output).toContain('No changes to review');
    } finally {
      await fs.rm(cleanRepo, { recursive: true, force: true });
    }
  });

  it('respects --staged flag (only staged diff)', async () => {
    await fs.writeFile(path.join(gitRepoDir, 'staged.ts'), 'const staged = true;\n');
    await execFileAsync('git', ['add', 'staged.ts'], { cwd: gitRepoDir });

    try {
      const { exitCode } = await runCli(['review', '--staged', '--fast', '--format', 'json']);
      expect(exitCode).toBe(0);

      const req = mockServer.requests.find((r) => r.url === '/cli/review');
      expect(req).toBeDefined();
      // staged diff should contain the new file, NOT the unstaged test.ts change
      expect(req!.body.diff).toContain('staged');
    } finally {
      await execFileAsync('git', ['reset', 'HEAD', 'staged.ts'], { cwd: gitRepoDir }).catch(() => {});
      await fs.unlink(path.join(gitRepoDir, 'staged.ts')).catch(() => {});
    }
  });

  it('outputs markdown format', async () => {
    const { stdout, exitCode } = await runCli(['review', '--fast', '--format', 'markdown']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Found 2 issues');
  });
});

// ---------------------------------------------------------------------------
// Auth status — team key and trial paths
// ---------------------------------------------------------------------------
describe('auth status integration', () => {
  it('shows team key mode', async () => {
    const { stdout, stderr, exitCode } = await runCli(['auth', 'status']);
    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    expect(output).toContain('Team Key');
    expect(output).toContain('Test Org');
    expect(output).toContain('Test Team');
  });

  it('shows trial mode when no auth configured', async () => {
    const noAuthHome = await fs.mkdtemp(path.join(os.tmpdir(), 'kodus-noauth-'));

    try {
      const { stdout, stderr, exitCode } = await runCli(['auth', 'status'], {
        env: { HOME: noAuthHome },
      });
      expect(exitCode).toBe(0);
      const output = stdout + stderr;
      expect(output).toContain('Trial');
      expect(output).toContain('2/5');
    } finally {
      await fs.rm(noAuthHome, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Hook commands — install, status, uninstall
// ---------------------------------------------------------------------------
describe('hook integration', () => {
  it('kodus hook install creates pre-push hook', async () => {
    const { stdout, stderr, exitCode } = await runCli(['hook', 'install', '--force']);
    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    expect(output).toContain('installed');

    const hookPath = path.join(gitRepoDir, '.git', 'hooks', 'pre-push');
    const content = await fs.readFile(hookPath, 'utf-8');
    expect(content).toContain('# kodus-hook');
    expect(content).toContain('--fail-on critical');
  });

  it('kodus hook status shows installed', async () => {
    // Install first
    await runCli(['hook', 'install', '--force']);

    const { stdout, stderr, exitCode } = await runCli(['hook', 'status']);
    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    expect(output).toContain('installed');
    expect(output).toContain('critical');
  });

  it('kodus hook uninstall removes the hook', async () => {
    // Install first
    await runCli(['hook', 'install', '--force']);

    const { stdout, stderr, exitCode } = await runCli(['hook', 'uninstall']);
    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    expect(output).toContain('removed');

    const hookPath = path.join(gitRepoDir, '.git', 'hooks', 'pre-push');
    await expect(fs.access(hookPath)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Decision commands — enable and capture
// ---------------------------------------------------------------------------
describe('decisions integration', () => {
  it('kodus decisions enable configures .claude/settings.json, ~/.codex/config.toml, post-merge hook and modules.yml', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'decisions',
      'enable',
      '--agents',
      'claude,codex',
    ]);
    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    expect(output).toContain('Decisions enabled');

    const claudeSettingsPath = path.join(gitRepoDir, '.claude', 'settings.json');
    const claudeSettings = JSON.parse(await fs.readFile(claudeSettingsPath, 'utf-8'));

    expect(claudeSettings).toHaveProperty('hooks');
    expect(claudeSettings.hooks).toHaveProperty('UserPromptSubmit');
    expect(claudeSettings.hooks).toHaveProperty('Stop');

    const userPromptSubmitJson = JSON.stringify(claudeSettings.hooks.UserPromptSubmit);
    const stopJson = JSON.stringify(claudeSettings.hooks.Stop);
    expect(userPromptSubmitJson).toContain('kodus decisions capture --agent claude-compatible --event user-prompt-submit');
    expect(stopJson).toContain('kodus decisions capture --agent claude-compatible --event stop');

    const codexConfigPath = path.join(tmpHome, '.codex', 'config.toml');
    const codexConfig = await fs.readFile(codexConfigPath, 'utf-8');
    expect(codexConfig).toContain('notify = ["kodus", "decisions", "capture", "--agent", "codex", "--event", "stop"]');

    const hookPath = path.join(gitRepoDir, '.git', 'hooks', 'post-merge');
    const hookContent = await fs.readFile(hookPath, 'utf-8');
    expect(hookContent).toContain('kodus decisions promote');
  });

  it('kodus decisions capture writes markdown memory file under .kody/pr/<branch>.md', async () => {
    const branch = (await execFileAsync('git', ['branch', '--show-current'], { cwd: gitRepoDir })).stdout.trim();

    const payload = JSON.stringify({
      session_id: 'session-1',
      turn_id: 'turn-1',
      prompt: 'Use idempotent cache key',
      last_assistant_message: 'Done with fallback behavior',
    });

    const { exitCode } = await runCli([
      'decisions',
      'capture',
      payload,
      '--agent',
      'codex',
      '--event',
      'agent-turn-complete',
      '--summary',
      'architectural decision',
    ]);
    expect(exitCode).toBe(0);

    const memoryFilePath = path.join(gitRepoDir, '.kody', 'pr', `${branch}.md`);
    const content = await fs.readFile(memoryFilePath, 'utf-8');
    expect(content).toContain(`# PR Memory: ${branch}`);
    expect(content).toContain('codex');
    expect(content).toContain('agent-turn-complete');
    expect(content).toContain('Use idempotent cache key');
  });

  it('kodus decisions capture resolves claude-compatible to cursor when Cursor env vars are present', async () => {
    const branch = (await execFileAsync('git', ['branch', '--show-current'], { cwd: gitRepoDir })).stdout.trim();

    const payload = JSON.stringify({
      session_id: 'session-2',
      prompt: 'add retry with backoff',
    });

    const { exitCode } = await runCli([
      'decisions',
      'capture',
      payload,
      '--agent',
      'claude-compatible',
      '--event',
      'user-prompt-submit',
    ], {
      env: {
        CURSOR_VERSION: '1.0.0',
      },
    });
    expect(exitCode).toBe(0);

    const memoryFilePath = path.join(gitRepoDir, '.kody', 'pr', `${branch}.md`);
    const content = await fs.readFile(memoryFilePath, 'utf-8');
    expect(content).toContain('| cursor | user-prompt-submit');
  });
});

// ---------------------------------------------------------------------------
// Review --fail-on flag
// ---------------------------------------------------------------------------
describe('review --fail-on integration', () => {
  it('exits with code 1 when issues meet threshold', async () => {
    // Mock server returns issues with severity 'warning' and 'error'
    const { exitCode } = await runCli([
      'review', '--fast', '--format', 'json', '--fail-on', 'warning',
    ]);
    expect(exitCode).toBe(1);
  });

  it('exits with code 0 when no issues meet threshold', async () => {
    // Mock server returns 'warning' and 'error' severity issues
    // Using --fail-on critical means neither meets threshold
    const { exitCode } = await runCli([
      'review', '--fast', '--format', 'json', '--fail-on', 'critical',
    ]);
    expect(exitCode).toBe(0);
  });
});
