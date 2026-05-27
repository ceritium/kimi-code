import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

import type { ExecutableTool, ExecutableToolResult } from '../loop';
import { ToolResultBuilder } from '../tools/support/result-builder';
import type { EnabledPluginTool, PluginToolRun } from './types';

const SIGTERM_GRACE_MS = 5_000;
const NODE_RUNNER_COMMAND = '__plugin_run_node';

export function createPluginExecutableTool(spec: EnabledPluginTool): ExecutableTool {
  return {
    name: spec.runtimeName,
    description: spec.description,
    parameters: spec.inputSchema,
    resolveExecution: (args) => {
      const invocation = pluginToolInvocation(spec.run);
      return {
        description: `Calling plugin tool: ${spec.pluginId}/${spec.name}`,
        display: {
          kind: 'generic',
          summary: `Call plugin tool ${spec.pluginId}/${spec.name}`,
          detail: {
            command: invocation.command,
            args: invocation.args,
            cwd: spec.pluginRoot,
          },
        },
        execute: ({ signal }) => executePluginTool(spec, args, signal),
      };
    },
  };
}

async function executePluginTool(
  spec: EnabledPluginTool,
  args: unknown,
  signal: AbortSignal,
): Promise<ExecutableToolResult> {
  if (signal.aborted) {
    return { isError: true, output: 'Aborted before plugin tool started.' };
  }

  const dataDir = path.join(spec.kimiHomeDir, 'plugins', 'data', spec.pluginId);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });

  let proc: ChildProcessWithoutNullStreams;
  try {
    const invocation = pluginToolInvocation(spec.run);
    proc = spawn(invocation.command, invocation.args, {
      cwd: spec.pluginRoot,
      env: pluginToolEnv(spec, dataDir),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    await waitForSpawn(proc);
  } catch (error) {
    return {
      isError: true,
      output: `Failed to start plugin tool "${spec.runtimeName}": ${formatError(error)}`,
    };
  }

  const builder = new ToolResultBuilder();
  let timedOut = false;
  let aborted = false;
  let killed = false;

  const killProc = async (): Promise<void> => {
    if (killed) return;
    killed = true;
    killChild(proc, 'SIGTERM');
    const exited = waitForClose(proc)
      .then(() => true)
      .catch(() => true);
    const ended = await Promise.race([
      exited,
      new Promise<false>((resolve) => setTimeout(() => resolve(false), SIGTERM_GRACE_MS)),
    ]);
    if (!ended && proc.exitCode === null) killChild(proc, 'SIGKILL');
  };

  const onAbort = (): void => {
    aborted = true;
    void killProc();
  };
  signal.addEventListener('abort', onAbort);
  const timeout = setTimeout(() => {
    timedOut = true;
    void killProc();
  }, spec.timeoutMs);

  try {
    if (spec.stdin === 'json') {
      proc.stdin.end(JSON.stringify(args ?? {}));
    } else {
      proc.stdin.end();
    }

    const [exitCode] = await Promise.all([
      waitForClose(proc),
      readStreamIntoBuilder(proc.stdout, builder),
      readStreamIntoBuilder(proc.stderr, builder, '[stderr]\n'),
    ]);

    if (timedOut) {
      return builder.error(`Plugin tool timed out after ${String(spec.timeoutMs)}ms.`, {
        brief: 'Plugin tool timed out',
      });
    }
    if (aborted) {
      return builder.error('Plugin tool interrupted by user.', { brief: 'Interrupted by user' });
    }
    if (exitCode === 0) {
      return builder.ok('Plugin tool completed.');
    }
    if (builder.nChars === 0) builder.write(`Process exited with code ${String(exitCode)}`);
    return builder.error(`Plugin tool failed with exit code ${String(exitCode)}.`, {
      brief: `Failed with exit code ${String(exitCode)}`,
    });
  } catch (error) {
    return {
      isError: true,
      output: `Plugin tool "${spec.runtimeName}" failed: ${formatError(error)}`,
    };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', onAbort);
  }
}

function pluginToolInvocation(
  run: PluginToolRun,
): { readonly command: string; readonly args: readonly string[] } {
  if (run.type === 'process') {
    return { command: run.command, args: run.args ?? [] };
  }
  const runner = nodeRunnerCommand();
  return {
    command: runner.command,
    args: [...runner.args, NODE_RUNNER_COMMAND, run.entry, '--', ...(run.args ?? [])],
  };
}

function nodeRunnerCommand(): { readonly command: string; readonly args: readonly string[] } {
  const currentScript = process.argv[1];
  if (currentScript !== undefined && isNodeScriptPath(currentScript)) {
    return { command: process.execPath, args: [currentScript] };
  }
  return { command: process.execPath, args: [] };
}

function isNodeScriptPath(value: string): boolean {
  return /\.(?:cjs|mjs|js|ts)$/.test(value);
}

function pluginToolEnv(spec: EnabledPluginTool, dataDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NO_COLOR: '1',
    TERM: process.env['TERM'] ?? 'dumb',
    GIT_TERMINAL_PROMPT: process.env['GIT_TERMINAL_PROMPT'] ?? '0',
    KIMI_CODE_HOME: spec.kimiHomeDir,
    KIMI_PLUGIN_ROOT: spec.pluginRoot,
    KIMI_PLUGIN_DATA: dataDir,
  };
}

function waitForSpawn(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSpawn = (): void => {
      child.off('error', onError);
      resolve();
    };
    const onError = (error: Error): void => {
      child.off('spawn', onSpawn);
      reject(error);
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}

function waitForClose(child: ChildProcessWithoutNullStreams): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 0));
  });
}

function readStreamIntoBuilder(
  stream: Readable,
  builder: ToolResultBuilder,
  prefix?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let prefixed = false;
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      if (prefix !== undefined && !prefixed) {
        builder.write(prefix);
        prefixed = true;
      }
      builder.write(chunk);
    });
    stream.once('error', reject);
    stream.once('end', resolve);
  });
}

function killChild(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== 'win32' && child.pid !== undefined) {
      process.kill(-child.pid, signal);
      return;
    }
  } catch {
    // Fall back to killing only the direct child.
  }
  try {
    child.kill(signal);
  } catch {
    // Process already exited.
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
