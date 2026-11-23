import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { asNonEmptyString } from '../shared/guards.js';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_CHARS = 4_000;
const DEFAULT_CHECK_TIMEOUT_MS = 60_000;

const trimOutput = (value) => {
  const text = String(value ?? '').trim();
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, 1200)}\n... [truncated] ...\n${text.slice(-2600)}`;
};

const runShellCommand = async (command, cwd, timeoutMs = DEFAULT_CHECK_TIMEOUT_MS) => {
  const startedAt = Date.now();
  const isWin = process.platform === 'win32';
  const bin = isWin ? 'cmd.exe' : '/bin/sh';
  const args = isWin ? ['/d', '/s', '/c', command] : ['-c', command];
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return {
      command,
      status: 'passed',
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      stdout: trimOutput(stdout),
      stderr: trimOutput(stderr),
    };
  } catch (error) {
    return {
      command,
      status: 'failed',
      exitCode: Number.isInteger(error?.code) ? error.code : 1,
      durationMs: Date.now() - startedAt,
      stdout: trimOutput(error?.stdout),
      stderr: trimOutput(error?.stderr || error?.message),
    };
  }
};

const readGitSummary = async (cwd) => {
  try {
    const [statusOut, diffOut] = await Promise.all([
      execFileAsync('git', ['status', '--short'], { cwd, timeout: 10_000, windowsHide: true }).then((r) => r.stdout.trim()).catch(() => ''),
      execFileAsync('git', ['diff', '--stat'], { cwd, timeout: 10_000, windowsHide: true }).then((r) => r.stdout.trim()).catch(() => ''),
    ]);
    return [statusOut, diffOut].filter(Boolean).join('\n');
  } catch {
    return '';
  }
};

export const detectDefaultVerificationCommands = async (directory) => {
  try {
    const pkgPath = path.join(directory, 'package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
    const scripts = pkg?.scripts ?? {};
    const detected = [];
    if (asNonEmptyString(scripts['type-check'])) detected.push('bun run type-check');
    if (asNonEmptyString(scripts.test)) detected.push('bun test');
    if (asNonEmptyString(scripts.lint)) detected.push('bun run lint');
    return detected;
  } catch {
    return [];
  }
};

export const createEvidenceVerifier = ({
  runCommand = runShellCommand,
  readGit = readGitSummary,
  timeoutMs = DEFAULT_CHECK_TIMEOUT_MS,
} = {}) => {
  const verifyObjective = async (objective, { autoDetect = false } = {}) => {
    const directory = asNonEmptyString(objective?.directory);
    if (!directory) {
      return {
        status: 'unavailable',
        checks: [],
        gitDiffSummary: '',
        summary: 'Verification unavailable: objective has no target directory.',
        followUpTasks: [],
      };
    }

    const exists = await fs.stat(directory).then((s) => s.isDirectory()).catch(() => false);
    if (!exists) {
      return {
        status: 'unavailable',
        checks: [],
        gitDiffSummary: '',
        summary: `Verification unavailable: directory ${directory} does not exist.`,
        followUpTasks: [],
      };
    }

    const gitDiffSummary = await readGit(directory);
    let commands = Array.isArray(objective.verificationCommands)
      ? objective.verificationCommands.map((c) => asNonEmptyString(c)).filter(Boolean)
      : [];
    if (commands.length === 0 && autoDetect) {
      commands = await detectDefaultVerificationCommands(directory);
    }

    if (commands.length === 0) {
      return {
        status: 'unverified',
        checks: [],
        gitDiffSummary,
        summary: 'No verification commands configured or executed; objective cannot be marked verified without evidence.',
        followUpTasks: [],
      };
    }

    const checks = [];
    for (const cmd of commands) {
      checks.push(await runCommand(cmd, directory, timeoutMs));
    }

    const failedChecks = checks.filter((c) => c.status !== 'passed');
    if (failedChecks.length === 0) {
      return {
        status: 'passed',
        checks,
        gitDiffSummary,
        summary: `All ${checks.length} verification check(s) passed.`,
        followUpTasks: [],
      };
    }

    const followUpTasks = failedChecks.map((check) => ({
      title: `Fix verification failure: ${check.command}`,
      kind: 'code',
      role: 'engineer',
      prompt: `Verification command \`${check.command}\` failed with exit code ${check.exitCode}.\nOutput:\n${check.stderr || check.stdout || 'no output'}\nFix the underlying defect and re-verify.`,
    }));

    return {
      status: 'failed',
      checks,
      gitDiffSummary,
      summary: `${failedChecks.length} of ${checks.length} verification check(s) failed: ${failedChecks.map((c) => c.command).join(', ')}`,
      followUpTasks,
    };
  };

  return { verifyObjective };
};
