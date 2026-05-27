import { describe, expect, it, vi } from 'vitest';

import {
  PluginDetailSelectorComponent,
  PluginInstallInputDialogComponent,
  PluginMarketplaceSelectorComponent,
  PluginRemoveConfirmComponent,
  PluginsOverviewSelectorComponent,
  type PluginInstallInputResult,
  type PluginRemoveConfirmResult,
} from '#/tui/components/dialogs/plugins-selector';
import { darkColors } from '#/tui/theme/colors';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;

function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

describe('plugins selector dialogs', () => {
  it('renders installed plugins as selectable overview entries', () => {
    const onSelect = vi.fn();
    const picker = new PluginsOverviewSelectorComponent({
      plugins: [
        {
          id: 'kimi-datasource',
          displayName: 'Kimi Datasource',
          version: '1.0.0',
          enabled: true,
          state: 'ok',
          skillCount: 2,
          toolCount: 0,
          mcpServerCount: 1,
          enabledMcpServerCount: 0,
          hasErrors: false,
        },
      ],
      colors: darkColors,
      onSelect,
      onCancel: vi.fn(),
    });

    const out = picker.render(120).map(strip).join('\n');
    expect(out).toContain('Installed plugins (1)');
    expect(out).toContain('Actions');
    expect(out).toContain('❯ Kimi Datasource  enabled');
    expect(out).toContain('Enter/→ details · Space disable · id kimi-datasource · 2 skills · MCP 0/1');
    expect(out).toContain('Browse official marketplace');
    expect(out).toContain('Install plugin');
    expect(out).toContain('Show plugin summary');

    picker.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith({ kind: 'plugin', id: 'kimi-datasource' });
  });

  it('renders marketplace plugins separately from marketplace actions', () => {
    const onSelect = vi.fn();
    const picker = new PluginMarketplaceSelectorComponent({
      entries: [
        {
          id: 'superpowers',
          displayName: 'Superpowers',
          version: '5.1.0',
          description: 'Workflow skills',
          source: 'https://example.com/superpowers.zip',
          keywords: ['workflow'],
        },
      ],
      installedIds: new Set(),
      source: '/tmp/marketplace.json',
      colors: darkColors,
      onSelect,
      onCancel: vi.fn(),
    });

    const out = picker.render(120).map(strip).join('\n');
    expect(out).toContain('Marketplace (1)');
    expect(out).toContain('❯ Superpowers  install v5.1.0');
    expect(out).toContain('Enter/Space install · Workflow skills · id superpowers · v5.1.0 · workflow');
    expect(out).toContain('Actions');
    expect(out).toContain('Back to installed plugins');

    picker.handleInput(' ');
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'install',
      entry: expect.objectContaining({ id: 'superpowers' }),
    });
  });

  it('updates installed marketplace entries with enter and opens details with right', () => {
    const onSelect = vi.fn();
    const picker = new PluginMarketplaceSelectorComponent({
      entries: [
        {
          id: 'superpowers',
          displayName: 'Superpowers',
          source: 'https://example.com/superpowers.zip',
        },
      ],
      installedIds: new Set(['superpowers']),
      source: '/tmp/marketplace.json',
      colors: darkColors,
      onSelect,
      onCancel: vi.fn(),
    });

    const out = picker.render(120).map(strip).join('\n');
    expect(out).toContain('❯ Superpowers  installed');
    expect(out).toContain('Enter/Space update · → details · Official plugin · id superpowers');

    picker.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'install',
      entry: expect.objectContaining({ id: 'superpowers' }),
    });
    onSelect.mockClear();
    picker.handleInput('\u001B[C');
    expect(onSelect).toHaveBeenCalledWith({ kind: 'detail', id: 'superpowers' });
  });

  it('returns typed actions from the plugin detail selector', () => {
    const onSelect = vi.fn();
    const picker = new PluginDetailSelectorComponent({
      info: {
        id: 'kimi-datasource',
        displayName: 'Kimi Datasource',
        version: '1.0.0',
        enabled: true,
        state: 'ok',
        skillCount: 1,
        toolCount: 0,
        mcpServerCount: 1,
        enabledMcpServerCount: 0,
        hasErrors: false,
        source: 'local-path',
        root: '/plugins/kimi-datasource',
        manifest: undefined,
        tools: [],
        mcpServers: [
          {
            name: 'data',
            runtimeName: 'plugin-kimi-datasource-data',
            enabled: false,
            transport: 'stdio',
            command: '/plugins/kimi-datasource/bin/data',
          },
        ],
        diagnostics: [],
      },
      colors: darkColors,
      onSelect,
      onCancel: vi.fn(),
    });

    const out = picker.render(120).map(strip);
    expect(out).toContain('  ❯ Show details');
    expect(out).toContain('    Enable MCP server: data');

    picker.handleInput('\u001B[B');
    picker.handleInput('\u001B[B');
    picker.handleInput('\r');

    expect(onSelect).toHaveBeenCalledWith({ kind: 'mcp', server: 'data', enabled: true });
  });

  it('toggles an installed plugin from the overview with space', () => {
    const onSelect = vi.fn();
    const picker = new PluginsOverviewSelectorComponent({
      plugins: [
        {
          id: 'kimi-datasource',
          displayName: 'Kimi Datasource',
          version: '1.0.0',
          enabled: true,
          state: 'ok',
          skillCount: 1,
          toolCount: 0,
          mcpServerCount: 0,
          enabledMcpServerCount: 0,
          hasErrors: false,
        },
      ],
      colors: darkColors,
      onSelect,
      onCancel: vi.fn(),
    });

    picker.handleInput(' ');

    expect(onSelect).toHaveBeenCalledWith({
      kind: 'toggle',
      id: 'kimi-datasource',
      enabled: false,
    });
  });

  it('renders plugin action hints inline on the overview row', () => {
    const picker = new PluginsOverviewSelectorComponent({
      plugins: [
        {
          id: 'kimi-datasource',
          displayName: 'Kimi Datasource',
          version: '1.0.0',
          enabled: true,
          state: 'ok',
          skillCount: 1,
          toolCount: 0,
          mcpServerCount: 0,
          enabledMcpServerCount: 0,
          hasErrors: false,
        },
      ],
      selectedId: 'kimi-datasource',
      pluginHint: { id: 'kimi-datasource', text: 'saved · /new to apply' },
      colors: darkColors,
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const out = picker.render(120).map(strip).join('\n');

    expect(out).toContain('❯ Kimi Datasource  enabled  saved · /new to apply');
  });

  it('defaults plugin removal confirmation to cancel', () => {
    const results: PluginRemoveConfirmResult[] = [];
    const picker = new PluginRemoveConfirmComponent({
      id: 'kimi-datasource',
      displayName: 'Kimi Datasource',
      colors: darkColors,
      onDone: (result) => {
        results.push(result);
      },
    });

    const out = picker.render(120).map(strip);
    expect(out).toContain(' Remove Kimi Datasource (kimi-datasource)?');
    expect(out).toContain('  ❯ Cancel');
    expect(out).toContain('    Keep this plugin installed.');
    expect(out).toContain('    Remove only the install record; plugin files are left in place.');

    picker.handleInput('\r');
    expect(results).toEqual([{ kind: 'cancel' }]);
  });

  it('confirms plugin removal only after choosing remove', () => {
    const results: PluginRemoveConfirmResult[] = [];
    const picker = new PluginRemoveConfirmComponent({
      id: 'kimi-datasource',
      displayName: 'Kimi Datasource',
      colors: darkColors,
      onDone: (result) => {
        results.push(result);
      },
    });

    picker.handleInput('\u001B[B');
    picker.handleInput('\r');

    expect(results).toEqual([{ kind: 'confirm' }]);
  });

  it('collects an install source and validates empty input', () => {
    const collected: PluginInstallInputResult[] = [];
    const dialog = new PluginInstallInputDialogComponent((result) => {
      collected.push(result);
    }, darkColors);
    dialog.focused = true;

    dialog.handleInput('\r');
    expect(collected).toEqual([]);
    expect(strip(dialog.render(80).join('\n'))).toContain(
      'Plugin path or zip URL cannot be empty.',
    );

    for (const ch of './plugins/kimi-datasource') {
      dialog.handleInput(ch);
    }
    dialog.handleInput('\r');

    expect(collected).toEqual([{ kind: 'ok', value: './plugins/kimi-datasource' }]);
  });
});
