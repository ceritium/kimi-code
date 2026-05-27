import { chmod, mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import yazl from 'yazl';

import { PluginManager } from '../../src/plugin/manager';
import { createPluginExecutableTool } from '../../src/plugin/tool';

async function makeKimiHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'kimi-home-'));
}

async function managedPluginRoot(home: string, id: string): Promise<string> {
  return realpath(path.join(home, 'plugins', 'managed', id));
}

async function makePlugin(
  name: string,
  options: {
    skills?: boolean;
    version?: string;
    sessionStartSkill?: string;
    mcpServers?: Record<string, unknown>;
    tools?: Record<string, unknown>;
  } = {},
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `plugin-${name}-`));
  const manifest: Record<string, unknown> = { name };
  if (options.version !== undefined) {
    manifest['version'] = options.version;
  }
  if (options.skills === true) {
    manifest['skills'] = './skills/';
    await mkdir(path.join(root, 'skills'), { recursive: true });
    await mkdir(path.join(root, 'skills', 'demo-skill'), { recursive: true });
    await writeFile(
      path.join(root, 'skills', 'demo-skill', 'SKILL.md'),
      '---\nname: demo-skill\ndescription: A demo\n---\nbody',
      'utf8',
    );
  }
  if (options.sessionStartSkill !== undefined) {
    manifest['sessionStart'] = { skill: options.sessionStartSkill };
  }
  if (options.mcpServers !== undefined) {
    manifest['mcpServers'] = options.mcpServers;
  }
  if (options.tools !== undefined) {
    manifest['tools'] = options.tools;
  }
  await writeFile(
    path.join(root, 'plugin.json'),
    JSON.stringify(manifest),
    'utf8',
  );
  return realpath(root);
}

describe('PluginManager', () => {
  it('install() adds a plugin and load() rehydrates it from disk', async () => {
    const home = await makeKimiHome();
    const pluginRoot = await makePlugin('demo', { skills: true });

    let manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    expect(manager.list()).toEqual([]);

    const record = await manager.install(pluginRoot);
    expect(record.id).toBe('demo');
    expect(record.enabled).toBe(true);
    expect(manager.list()).toHaveLength(1);

    manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    expect(manager.list()).toHaveLength(1);
    expect(manager.get('demo')?.root).toBe(await managedPluginRoot(home, 'demo'));
    expect(manager.get('demo')?.originalSource).toBe(pluginRoot);
  });

  it('install() accepts a .kimi-plugin manifest', async () => {
    const home = await makeKimiHome();
    const root = await mkdtemp(path.join(tmpdir(), 'kimi-plugin-'));
    await mkdir(path.join(root, '.kimi-plugin'), { recursive: true });
    await mkdir(path.join(root, 'skills'), { recursive: true });
    await writeFile(
      path.join(root, '.kimi-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'superpowers',
        skills: './skills/',
        skillInstructions: 'Use Kimi tools.',
      }),
      'utf8',
    );

    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    const record = await manager.install(root);
    const managedRoot = await managedPluginRoot(home, 'superpowers');

    expect(record.id).toBe('superpowers');
    expect(record.manifestKind).toBe('kimi-plugin');
    expect(record.root).toBe(managedRoot);
    expect(record.originalSource).toBe(root);
    expect(record.manifest?.skills).toEqual([path.join(managedRoot, 'skills')]);
    expect(manager.pluginSkillRoots()).toContainEqual({
      path: path.join(managedRoot, 'skills'),
      source: 'extra',
      plugin: { id: 'superpowers', instructions: 'Use Kimi tools.' },
    });
  });

  it('install() rejects a relative plugin root', async () => {
    const home = await makeKimiHome();
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();

    await expect(manager.install('relative/plugin')).rejects.toThrow(/absolute path/i);
  });

  it('install() copies a symlinked plugin root into the managed plugins dir', async () => {
    const home = await makeKimiHome();
    const pluginRoot = await makePlugin('demo');
    const link = path.join(await mkdtemp(path.join(tmpdir(), 'plugin-link-')), 'demo-link');
    await symlink(pluginRoot, link);
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();

    const record = await manager.install(link);

    const managedRoot = await managedPluginRoot(home, 'demo');
    expect(record.root).toBe(managedRoot);
    expect(record.originalSource).toBe(link);
    const reloaded = new PluginManager({ kimiHomeDir: home });
    await reloaded.load();
    expect(reloaded.get('demo')?.root).toBe(managedRoot);
  });

  it('setEnabled() persists the new state', async () => {
    const home = await makeKimiHome();
    const root = await makePlugin('demo', { skills: true });
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(root);

    await manager.setEnabled('demo', false);
    expect(manager.get('demo')?.enabled).toBe(false);

    const reloaded = new PluginManager({ kimiHomeDir: home });
    await reloaded.load();
    expect(reloaded.get('demo')?.enabled).toBe(false);
  });

  it('remove() clears the entry but does not delete the source directory', async () => {
    const home = await makeKimiHome();
    const root = await makePlugin('demo', { skills: true });
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(root);

    await manager.remove('demo');
    expect(manager.get('demo')).toBeUndefined();
    // Source directory survives.
    const { stat } = await import('node:fs/promises');
    expect((await stat(root)).isDirectory()).toBe(true);
  });

  it('pluginSkillRoots() returns only enabled plugins skills paths', async () => {
    const home = await makeKimiHome();
    const a = await makePlugin('a', { skills: true });
    const b = await makePlugin('b', { skills: true });
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(a);
    await manager.install(b);
    await manager.setEnabled('b', false);
    const managedA = await managedPluginRoot(home, 'a');
    const managedB = await managedPluginRoot(home, 'b');
    expect(manager.pluginSkillRoots()).toContainEqual({
      path: path.join(managedA, 'skills'),
      source: 'extra',
      plugin: { id: 'a', instructions: undefined },
    });
    expect(manager.pluginSkillRoots()).not.toContainEqual({
      path: path.join(managedB, 'skills'),
      source: 'extra',
      plugin: { id: 'b', instructions: undefined },
    });
  });

  it('reload() picks up edits to the managed plugin copy', async () => {
    const home = await makeKimiHome();
    const root = await makePlugin('demo');
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(root);
    const managedRoot = await managedPluginRoot(home, 'demo');

    await writeFile(
      path.join(managedRoot, 'plugin.json'),
      JSON.stringify({ name: 'demo', version: '2.0.0' }),
      'utf8',
    );
    const summary = await manager.reload();
    expect(summary.errors).toEqual([]);
    expect(manager.get('demo')?.manifest?.version).toBe('2.0.0');
  });

  it('reload() does not reread the original local source after install', async () => {
    const home = await makeKimiHome();
    const root = await makePlugin('demo');
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(root);

    await writeFile(
      path.join(root, 'plugin.json'),
      JSON.stringify({ name: 'demo', version: 'source-edit' }),
      'utf8',
    );

    const summary = await manager.reload();
    expect(summary.errors).toEqual([]);
    expect(manager.get('demo')?.manifest?.version).toBeUndefined();
  });

  it('install() refuses to add a directory without a manifest', async () => {
    const home = await makeKimiHome();
    const root = await mkdtemp(path.join(tmpdir(), 'no-manifest-'));
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await expect(manager.install(root)).rejects.toThrow(/manifest/i);
  });

  it('install() overwrites the same local plugin and preserves user state', async () => {
    const home = await makeKimiHome();
    const root = await makePlugin('demo', {
      version: '1.0.0',
      mcpServers: { finance: { command: 'finance-mcp' } },
    });
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    const first = await manager.install(root);
    await manager.setMcpServerEnabled('demo', 'finance', true);
    await manager.setEnabled('demo', false);

    await new Promise((r) => setTimeout(r, 10));
    const updatedRoot = await makePlugin('demo', {
      version: '2.0.0',
      mcpServers: { finance: { command: 'finance-mcp-v2' } },
    });
    const updated = await manager.install(updatedRoot);

    expect(manager.list()).toHaveLength(1);
    expect(updated.manifest?.version).toBe('2.0.0');
    expect(updated.enabled).toBe(false);
    expect(updated.installedAt).toBe(first.installedAt);
    expect(updated.updatedAt).not.toBe(first.updatedAt);
    expect(updated.originalSource).toBe(updatedRoot);
    expect(manager.info('demo')?.mcpServers[0]?.enabled).toBe(true);
  });

  it('keeps a plugin in error state instead of losing it on a broken manifest', async () => {
    const home = await makeKimiHome();
    const root = await makePlugin('demo');
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(root);
    await writeFile(
      path.join(await managedPluginRoot(home, 'demo'), 'plugin.json'),
      '{ not json',
      'utf8',
    );
    await manager.reload();
    const record = manager.get('demo');
    expect(record?.state).toBe('error');
    expect(record?.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'manifest.invalid_json' }),
    );
    expect(manager.pluginSkillRoots()).toEqual([]);
  });

  it('enabledSessionStarts() returns only enabled plugin sessionStart declarations', async () => {
    const home = await makeKimiHome();
    const root = await makePlugin('demo', {
      skills: true,
      sessionStartSkill: 'demo-skill',
    });
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(root);
    expect(manager.enabledSessionStarts()).toEqual([
      { pluginId: 'demo', skillName: 'demo-skill' },
    ]);

    await manager.setEnabled('demo', false);
    expect(manager.enabledSessionStarts()).toEqual([]);
  });

  it('maps manifest skillInstructions to record skillInstructions', async () => {
    const home = await makeKimiHome();
    const root = await mkdtemp(path.join(tmpdir(), 'plugin-instructions-'));
    await writeFile(
      path.join(root, 'plugin.json'),
      JSON.stringify({
        name: 'demo',
        skillInstructions: 'Always be helpful.',
      }),
      'utf8',
    );
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    const record = await manager.install(root);
    expect(record.skillInstructions).toBe('Always be helpful.');
  });

  it('setMcpServerEnabled() persists explicit MCP server state', async () => {
    const home = await makeKimiHome();
    const root = await makePlugin('demo', {
      mcpServers: {
        finance: { command: 'finance-mcp' },
        docs: { url: 'https://example.com/mcp' },
      },
    });
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(root);

    expect(manager.info('demo')?.mcpServers).toContainEqual(
      expect.objectContaining({
        name: 'finance',
        runtimeName: 'plugin-demo-finance',
        enabled: false,
        command: 'finance-mcp',
      }),
    );
    expect(manager.summaries()[0]).toEqual(
      expect.objectContaining({
        mcpServerCount: 2,
        enabledMcpServerCount: 0,
      }),
    );

    await manager.setMcpServerEnabled('demo', 'finance', true);

    expect(manager.enabledMcpServers()).toEqual({
      'plugin-demo-finance': expect.objectContaining({
        command: 'finance-mcp',
        env: { KIMI_CODE_HOME: home },
      }),
    });
    expect(manager.summaries()[0]).toEqual(
      expect.objectContaining({
        mcpServerCount: 2,
        enabledMcpServerCount: 1,
      }),
    );

    const reloaded = new PluginManager({ kimiHomeDir: home });
    await reloaded.load();
    expect(reloaded.info('demo')?.mcpServers).toContainEqual(
      expect.objectContaining({ name: 'finance', enabled: true }),
    );
  });

  it('enabledTools() returns executable plugin tool specs for enabled plugins', async () => {
    const home = await makeKimiHome();
    const root = await makePlugin('demo', {
      tools: {
        query_finance: {
          description: 'Query finance data',
          run: {
            type: 'node',
            entry: './bin/query-finance',
          },
          inputSchema: { type: 'object', properties: {} },
        },
      },
    });
    await mkdir(path.join(root, 'bin'), { recursive: true });
    await writeFile(path.join(root, 'bin', 'query-finance'), '#!/bin/sh\n', 'utf8');

    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(root);
    const managedRoot = await managedPluginRoot(home, 'demo');

    expect(manager.summaries()[0]).toEqual(expect.objectContaining({ toolCount: 1 }));
    expect(manager.info('demo')?.tools).toContainEqual(
      expect.objectContaining({
        name: 'query_finance',
        runtimeName: 'plugin__demo__query_finance',
        command: path.join(managedRoot, 'bin', 'query-finance'),
        run: {
          type: 'node',
          entry: path.join(managedRoot, 'bin', 'query-finance'),
          args: [],
        },
      }),
    );
    expect(manager.enabledTools()).toContainEqual(
      expect.objectContaining({
        pluginId: 'demo',
        pluginRoot: managedRoot,
        runtimeName: 'plugin__demo__query_finance',
        run: {
          type: 'node',
          entry: path.join(managedRoot, 'bin', 'query-finance'),
          args: [],
        },
      }),
    );

    await manager.setEnabled('demo', false);
    expect(manager.enabledTools()).toEqual([]);
  });

  it('plugin executable tools pass JSON input through stdin', async () => {
    const home = await makeKimiHome();
    const root = await mkdtemp(path.join(tmpdir(), 'plugin-tool-run-'));
    const script = path.join(root, 'echo-json.mjs');
    await writeFile(
      script,
      [
        '#!/usr/bin/env node',
        "let input = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => { input += chunk; });",
        "process.stdin.on('end', () => {",
        "  const parsed = JSON.parse(input || '{}');",
        "  process.stdout.write(JSON.stringify({ ok: true, value: parsed.value, home: process.env.KIMI_CODE_HOME }));",
        '});',
      ].join('\n'),
      'utf8',
    );
    await chmod(script, 0o755);

    const tool = createPluginExecutableTool({
      pluginId: 'demo',
      pluginRoot: root,
      kimiHomeDir: home,
      name: 'echo_json',
      runtimeName: 'plugin__demo__echo_json',
      description: 'Echo JSON',
      inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
      run: {
        type: 'process',
        command: script,
      },
      stdin: 'json',
      timeoutMs: 10_000,
    });

    const execution = tool.resolveExecution({ value: 'hello' });
    expect(execution.isError).not.toBe(true);
    if (execution.isError === true) throw new Error(String(execution.output));
    const result = await execution.execute({
      turnId: '1',
      toolCallId: 'call-1',
      signal: new AbortController().signal,
    });

    expect(result).toEqual(
      expect.objectContaining({
        isError: false,
        output: JSON.stringify({ ok: true, value: 'hello', home }),
      }),
    );
  });

  it('plugin node tools invoke the hidden Kimi node runner', async () => {
    const home = await makeKimiHome();
    const root = await mkdtemp(path.join(tmpdir(), 'plugin-node-run-'));
    const script = path.join(root, 'tool.mjs');
    await writeFile(script, 'process.stdout.write("ok\\n");\n', 'utf8');

    const tool = createPluginExecutableTool({
      pluginId: 'demo',
      pluginRoot: root,
      kimiHomeDir: home,
      name: 'node_tool',
      runtimeName: 'plugin__demo__node_tool',
      description: 'Run JS',
      inputSchema: { type: 'object', properties: {} },
      run: {
        type: 'node',
        entry: script,
        args: ['node_tool'],
      },
      stdin: 'json',
      timeoutMs: 10_000,
    });

    const execution = tool.resolveExecution({});
    expect(execution.isError).not.toBe(true);
    if (execution.isError === true) throw new Error(String(execution.output));
    const displayDetail = (execution.display as { readonly detail?: unknown } | undefined)?.detail;
    expect(displayDetail).toEqual(
      expect.objectContaining({
        command: process.execPath,
        args: expect.arrayContaining(['__plugin_run_node', script, '--', 'node_tool']),
        cwd: root,
      }),
    );
  });

  it('enabledMcpServers() excludes disabled plugins', async () => {
    const home = await makeKimiHome();
    const root = await makePlugin('demo', {
      mcpServers: { finance: { command: 'finance-mcp' } },
    });
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(root);
    await manager.setMcpServerEnabled('demo', 'finance', true);
    await manager.setEnabled('demo', false);

    expect(manager.enabledMcpServers()).toEqual({});
  });

  it('setMcpServerEnabled() rejects unknown MCP servers', async () => {
    const home = await makeKimiHome();
    const root = await makePlugin('demo');
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(root);

    await expect(manager.setMcpServerEnabled('demo', 'missing', true)).rejects.toThrow(
      /does not declare MCP server/i,
    );
  });

  it('install() sets originalSource and updatedAt', async () => {
    const home = await makeKimiHome();
    const root = await makePlugin('demo');
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();

    const before = Date.now();
    const record = await manager.install(root);
    const after = Date.now();

    expect(record.originalSource).toBe(root);
    expect(record.root).toBe(await managedPluginRoot(home, 'demo'));
    expect(record.updatedAt).toBeDefined();
    const updatedAt = new Date(record.updatedAt!).getTime();
    expect(updatedAt).toBeGreaterThanOrEqual(before);
    expect(updatedAt).toBeLessThanOrEqual(after);
    expect(record.installedAt).toBe(record.updatedAt);
  });

  it('persist() and load() round-trip originalSource and updatedAt', async () => {
    const home = await makeKimiHome();
    const root = await makePlugin('demo');
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(root);

    const reloaded = new PluginManager({ kimiHomeDir: home });
    await reloaded.load();
    const record = reloaded.get('demo');
    expect(record?.originalSource).toBe(root);
    expect(record?.root).toBe(await managedPluginRoot(home, 'demo'));
    expect(record?.updatedAt).toBeDefined();
  });

  it('setEnabled() updates updatedAt', async () => {
    const home = await makeKimiHome();
    const root = await makePlugin('demo');
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    const record = await manager.install(root);
    const firstUpdatedAt = record.updatedAt;

    // Give enough time for the timestamp to change.
    await new Promise((r) => setTimeout(r, 10));
    await manager.setEnabled('demo', false);

    const after = manager.get('demo');
    expect(after?.updatedAt).toBeDefined();
    expect(after?.updatedAt).not.toBe(firstUpdatedAt);

    const reloaded = new PluginManager({ kimiHomeDir: home });
    await reloaded.load();
    expect(reloaded.get('demo')?.updatedAt).toBe(after?.updatedAt);
  });

  it('info() includes originalSource', async () => {
    const home = await makeKimiHome();
    const root = await makePlugin('demo');
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(root);

    const info = manager.info('demo');
    expect(info?.originalSource).toBe(root);
  });

  it('install() supports zip URL', async () => {
    const home = await makeKimiHome();
    const zipBuffer = await createZipBuffer([
      {
        name: 'plugin/plugin.json',
        data: JSON.stringify({ name: 'zip-demo', skills: './skills/' }),
      },
      {
        name: 'plugin/skills/demo-skill/SKILL.md',
        data: '---\nname: demo-skill\ndescription: A demo\n---\nbody',
      },
    ]);
    const url = await serveOnce(zipBuffer);

    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();

    const record = await manager.install(url);
    const managedRoot = await realpath(path.join(home, 'plugins', 'managed', 'zip-demo'));
    expect(record.id).toBe('zip-demo');
    expect(record.source).toBe('zip-url');
    expect(record.originalSource).toBe(url);
    expect(record.root).toBe(managedRoot);
    expect(record.manifest?.skills).toEqual([path.join(managedRoot, 'skills')]);

    const reloaded = new PluginManager({ kimiHomeDir: home });
    await reloaded.load();
    expect(reloaded.get('zip-demo')?.source).toBe('zip-url');
    expect(reloaded.get('zip-demo')?.root).toBe(managedRoot);
  });

  it('install() from zip-url overwrites existing zip-url plugin', async () => {
    const home = await makeKimiHome();
    const zipBuffer1 = await createZipBuffer([
      { name: 'plugin/plugin.json', data: JSON.stringify({ name: 'zip-demo', version: '1.0.0' }) },
    ]);
    const url1 = await serveOnce(zipBuffer1);

    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(url1);

    const zipBuffer2 = await createZipBuffer([
      { name: 'plugin/plugin.json', data: JSON.stringify({ name: 'zip-demo', version: '2.0.0' }) },
    ]);
    const url2 = await serveOnce(zipBuffer2);

    const record = await manager.install(url2);
    expect(record.manifest?.version).toBe('2.0.0');
    expect(manager.list()).toHaveLength(1);
    expect(record.originalSource).toBe(url2);
  });

  it('install() from zip-url overwrites existing local-path plugin', async () => {
    const home = await makeKimiHome();
    const root = await makePlugin('zip-demo');
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    const first = await manager.install(root);
    await manager.setEnabled('zip-demo', false);

    const zipBuffer = await createZipBuffer([
      { name: 'plugin/plugin.json', data: JSON.stringify({ name: 'zip-demo', version: '2.0.0' }) },
    ]);
    const url = await serveOnce(zipBuffer);

    const updated = await manager.install(url);

    expect(updated.source).toBe('zip-url');
    expect(updated.originalSource).toBe(url);
    expect(updated.manifest?.version).toBe('2.0.0');
    expect(updated.enabled).toBe(false);
    expect(updated.installedAt).toBe(first.installedAt);
    expect(manager.list()).toHaveLength(1);
  });

  it('install() rejects zip URL without manifest', async () => {
    const home = await makeKimiHome();
    const zipBuffer = await createZipBuffer([
      { name: 'readme.txt', data: 'no manifest here' },
    ]);
    const url = await serveOnce(zipBuffer);

    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();

    await expect(manager.install(url)).rejects.toThrow(/manifest/i);
  });
});

async function createZipBuffer(entries: Array<{ name: string; data: string | Buffer }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile();
    const chunks: Buffer[] = [];
    zipfile.outputStream.on('data', (chunk) => chunks.push(chunk));
    zipfile.outputStream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    zipfile.outputStream.on('error', reject);
    for (const entry of entries) {
      zipfile.addBuffer(Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data), entry.name);
    }
    zipfile.end();
  });
}

async function serveOnce(buffer: Buffer): Promise<string> {
  const { createServer } = await import('node:http');
  return new Promise((resolve) => {
    const server = createServer((_, res) => {
      res.writeHead(200, { 'Content-Type': 'application/zip' });
      res.end(buffer);
      server.close();
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()!;
      resolve(`http://127.0.0.1:${(addr as any).port}`);
    });
  });
}
