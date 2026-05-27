import {
  Container,
  Input,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '@earendil-works/pi-tui';
import type { PluginInfo, PluginSummary } from '@moonshot-ai/kimi-code-sdk';
import chalk from 'chalk';

import type { ColorPalette } from '#/tui/theme/colors';
import { printableChar } from '#/tui/utils/printable-key';
import type { PluginMarketplaceEntry } from '#/utils/plugin-marketplace';

import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';

const OVERVIEW_INSTALL = 'install';
const OVERVIEW_MARKETPLACE = 'marketplace';
const OVERVIEW_RELOAD = 'reload';
const OVERVIEW_SHOW_LIST = 'show-list';
const OVERVIEW_PLUGIN_PREFIX = 'plugin:';

const DETAIL_INFO = 'info';
const DETAIL_TOGGLE = 'toggle';
const DETAIL_REMOVE = 'remove';
const DETAIL_BACK = 'back';
const DETAIL_MCP_PREFIX = 'mcp:';
const REMOVE_CONFIRM_CANCEL = 'cancel';
const REMOVE_CONFIRM_REMOVE = 'remove';
const ELLIPSIS = '…';

interface PluginsOverviewItem {
  readonly value: string;
  readonly kind: 'plugin' | 'action';
  readonly label: string;
  readonly status?: string;
  readonly description: string;
}

export type PluginsOverviewSelection =
  | { readonly kind: 'install' }
  | { readonly kind: 'marketplace' }
  | { readonly kind: 'reload' }
  | { readonly kind: 'show-list' }
  | { readonly kind: 'toggle'; readonly id: string; readonly enabled: boolean }
  | { readonly kind: 'plugin'; readonly id: string };

export interface PluginsOverviewSelectorOptions {
  readonly plugins: readonly PluginSummary[];
  readonly selectedId?: string;
  readonly pluginHint?: {
    readonly id: string;
    readonly text: string;
  };
  readonly colors: ColorPalette;
  readonly onSelect: (selection: PluginsOverviewSelection) => void;
  readonly onCancel: () => void;
}

export class PluginsOverviewSelectorComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: PluginsOverviewSelectorOptions;
  private readonly items: readonly PluginsOverviewItem[];
  private selectedIndex = 0;

  constructor(opts: PluginsOverviewSelectorOptions) {
    super();
    this.opts = opts;
    this.items = buildOverviewItems(opts.plugins);
    const selectedIndex = this.items.findIndex(
      (item) => item.value === `${OVERVIEW_PLUGIN_PREFIX}${opts.selectedId}`,
    );
    this.selectedIndex = Math.max(0, selectedIndex);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.left)) {
      this.opts.onCancel();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
      return;
    }
    if (matchesKey(data, Key.space) || printableChar(data) === ' ') {
      const chosen = this.items[this.selectedIndex];
      if (chosen === undefined || !chosen.value.startsWith(OVERVIEW_PLUGIN_PREFIX)) return;
      const id = chosen.value.slice(OVERVIEW_PLUGIN_PREFIX.length);
      const plugin = this.opts.plugins.find((item) => item.id === id);
      if (plugin !== undefined) {
        this.opts.onSelect({ kind: 'toggle', id, enabled: !plugin.enabled });
      }
      return;
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.right)) {
      const chosen = this.items[this.selectedIndex];
      if (chosen === undefined) return;
      const selection = parseOverviewSelection(chosen.value);
      if (selection !== undefined) this.opts.onSelect(selection);
    }
  }

  override render(width: number): string[] {
    const { colors, plugins } = this.opts;
    const hint = '↑↓ navigate · Enter/→ details · Space enable/disable · ←/Esc close';
    const pluginItems = this.items.filter((item) => item.kind === 'plugin');
    const actionItems = this.items.filter((item) => item.kind === 'action');
    const lines: string[] = [
      chalk.hex(colors.primary)('─'.repeat(width)),
      chalk.hex(colors.primary).bold(' Plugins'),
      chalk.hex(colors.textMuted)(` ${hint}`),
      '',
      sectionLabel(`Installed plugins (${plugins.length})`, colors),
    ];

    if (pluginItems.length === 0) {
      lines.push(chalk.hex(colors.textMuted)('  No plugins installed.'));
    } else {
      let absoluteIndex = 0;
      for (const item of pluginItems) {
        lines.push(...this.renderItem(item, absoluteIndex, width));
        absoluteIndex++;
      }
    }

    lines.push('');
    lines.push(sectionLabel('Actions', colors));
    for (let i = 0; i < actionItems.length; i++) {
      lines.push(...this.renderItem(actionItems[i]!, pluginItems.length + i, width));
    }

    lines.push('');
    lines.push(chalk.hex(colors.primary)('─'.repeat(width)));
    return lines.map((line) => truncateToWidth(line, width, ELLIPSIS));
  }

  private renderItem(item: PluginsOverviewItem, index: number, width: number): string[] {
    const { colors } = this.opts;
    const selected = index === this.selectedIndex;
    const pointer = selected ? '❯' : ' ';
    const labelStyle = selected ? chalk.hex(colors.primary).bold : chalk.hex(colors.text);
    const prefix = chalk.hex(selected ? colors.primary : colors.textDim)(`  ${pointer} `);
    let line = prefix + labelStyle(item.label);
    if (item.status !== undefined) {
      line += '  ' + statusStyle(item, colors)(item.status);
    }
    const pluginId = overviewItemPluginId(item);
    if (pluginId !== undefined && this.opts.pluginHint?.id === pluginId) {
      line += '  ' + chalk.hex(colors.warning)(this.opts.pluginHint.text);
    }

    const descriptionWidth = Math.max(1, width - 4);
    const lines = [line];
    for (const descLine of wrapOverviewDescription(item.description, descriptionWidth)) {
      lines.push(chalk.hex(colors.textMuted)(`    ${descLine}`));
    }
    return lines;
  }
}

export type PluginMarketplaceSelection =
  | { readonly kind: 'install'; readonly entry: PluginMarketplaceEntry }
  | { readonly kind: 'detail'; readonly id: string }
  | { readonly kind: 'back' };

export interface PluginMarketplaceSelectorOptions {
  readonly entries: readonly PluginMarketplaceEntry[];
  readonly installedIds: ReadonlySet<string>;
  readonly source: string;
  readonly colors: ColorPalette;
  readonly onSelect: (selection: PluginMarketplaceSelection) => void;
  readonly onCancel: () => void;
}

export class PluginMarketplaceSelectorComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: PluginMarketplaceSelectorOptions;
  private readonly items: readonly PluginsOverviewItem[];
  private selectedIndex = 0;

  constructor(opts: PluginMarketplaceSelectorOptions) {
    super();
    this.opts = opts;
    this.items = buildMarketplaceItems(opts.entries, opts.installedIds);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.left)) {
      this.opts.onCancel();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
      return;
    }
    if (
      matchesKey(data, Key.enter) ||
      matchesKey(data, Key.space) ||
      printableChar(data) === ' '
    ) {
      const chosen = this.items[this.selectedIndex];
      if (chosen === undefined) return;
      if (chosen.value === 'back') {
        this.opts.onSelect({ kind: 'back' });
        return;
      }
      const entry = this.opts.entries.find((item) => item.id === chosen.value);
      if (entry === undefined) return;
      this.opts.onSelect({ kind: 'install', entry });
      return;
    }
    if (matchesKey(data, Key.right)) {
      const chosen = this.items[this.selectedIndex];
      if (chosen === undefined) return;
      if (chosen.value === 'back') {
        this.opts.onSelect({ kind: 'back' });
        return;
      }
      const entry = this.opts.entries.find((item) => item.id === chosen.value);
      if (entry !== undefined && this.opts.installedIds.has(entry.id)) {
        this.opts.onSelect({ kind: 'detail', id: entry.id });
      }
    }
  }

  override render(width: number): string[] {
    const { colors } = this.opts;
    const entries = this.items.filter((item) => item.kind === 'plugin');
    const actions = this.items.filter((item) => item.kind === 'action');
    const lines: string[] = [
      chalk.hex(colors.primary)('─'.repeat(width)),
      chalk.hex(colors.primary).bold(' Official plugins'),
      chalk.hex(colors.textMuted)(' ↑↓ navigate · Enter/Space install/update · → details if installed · ←/Esc back'),
      chalk.hex(colors.textMuted)(` Source: ${this.opts.source}`),
      '',
      sectionLabel(`Marketplace (${entries.length})`, colors),
    ];

    if (entries.length === 0) {
      lines.push(chalk.hex(colors.textMuted)('  No marketplace plugins found.'));
    } else {
      for (let i = 0; i < entries.length; i++) {
        lines.push(...this.renderItem(entries[i]!, i, width));
      }
    }

    lines.push('');
    lines.push(sectionLabel('Actions', colors));
    for (let i = 0; i < actions.length; i++) {
      lines.push(...this.renderItem(actions[i]!, entries.length + i, width));
    }

    lines.push('');
    lines.push(chalk.hex(colors.primary)('─'.repeat(width)));
    return lines.map((line) => truncateToWidth(line, width, ELLIPSIS));
  }

  private renderItem(item: PluginsOverviewItem, index: number, width: number): string[] {
    const { colors } = this.opts;
    const selected = index === this.selectedIndex;
    const pointer = selected ? '❯' : ' ';
    const labelStyle = selected ? chalk.hex(colors.primary).bold : chalk.hex(colors.text);
    const prefix = chalk.hex(selected ? colors.primary : colors.textDim)(`  ${pointer} `);
    let line = prefix + labelStyle(item.label);
    if (item.status !== undefined) {
      line += '  ' + statusStyle(item, colors)(item.status);
    }
    const descriptionWidth = Math.max(1, width - 4);
    const lines = [line];
    for (const descLine of wrapOverviewDescription(item.description, descriptionWidth)) {
      lines.push(chalk.hex(colors.textMuted)(`    ${descLine}`));
    }
    return lines;
  }
}

export type PluginDetailSelection =
  | { readonly kind: 'info' }
  | { readonly kind: 'toggle'; readonly enabled: boolean }
  | { readonly kind: 'mcp'; readonly server: string; readonly enabled: boolean }
  | { readonly kind: 'remove' }
  | { readonly kind: 'back' };

export interface PluginDetailSelectorOptions {
  readonly info: PluginInfo;
  readonly notice?: string;
  readonly colors: ColorPalette;
  readonly onSelect: (selection: PluginDetailSelection) => void;
  readonly onCancel: () => void;
}

export class PluginDetailSelectorComponent extends ChoicePickerComponent {
  constructor(opts: PluginDetailSelectorOptions) {
    super({
      title: `${opts.info.displayName} (${opts.info.id})`,
      hint: '↑↓ navigate · Enter/Space action · ←/Esc back',
      notice: opts.notice,
      options: buildDetailOptions(opts.info),
      colors: opts.colors,
      onSelect: (value) => {
        const selection = parseDetailSelection(value, opts.info);
        if (selection !== undefined) opts.onSelect(selection);
      },
      onCancel: opts.onCancel,
    });
  }
}

export type PluginRemoveConfirmResult =
  | { readonly kind: 'confirm' }
  | { readonly kind: 'cancel' };

export interface PluginRemoveConfirmOptions {
  readonly id: string;
  readonly displayName: string;
  readonly colors: ColorPalette;
  readonly onDone: (result: PluginRemoveConfirmResult) => void;
}

export class PluginRemoveConfirmComponent extends ChoicePickerComponent {
  constructor(opts: PluginRemoveConfirmOptions) {
    super({
      title: `Remove ${opts.displayName} (${opts.id})?`,
      hint: '↑↓ navigate · Enter/Space select · ←/Esc cancel',
      options: [
        {
          value: REMOVE_CONFIRM_CANCEL,
          label: 'Cancel',
          description: 'Keep this plugin installed.',
        },
        {
          value: REMOVE_CONFIRM_REMOVE,
          label: 'Remove plugin',
          description: 'Remove only the install record; plugin files are left in place.',
        },
      ],
      colors: opts.colors,
      onSelect: (value) => {
        opts.onDone(value === REMOVE_CONFIRM_REMOVE ? { kind: 'confirm' } : { kind: 'cancel' });
      },
      onCancel: () => {
        opts.onDone({ kind: 'cancel' });
      },
    });
  }
}

export type PluginInstallInputResult =
  | { readonly kind: 'ok'; readonly value: string }
  | { readonly kind: 'cancel' };

const INSTALL_TITLE = 'Install plugin';
const INSTALL_SUBTITLE = 'Enter a local path or zip URL.';
const INSTALL_EMPTY_SUBTITLE = 'Plugin path or zip URL cannot be empty.';
const INSTALL_FOOTER = 'Enter to install  ·  Esc to cancel';

export class PluginInstallInputDialogComponent extends Container implements Focusable {
  focused = false;

  private readonly input = new Input();
  private readonly onDone: (result: PluginInstallInputResult) => void;
  private readonly colors: ColorPalette;
  private done = false;
  private emptyHinted = false;

  constructor(onDone: (result: PluginInstallInputResult) => void, colors: ColorPalette) {
    super();
    this.onDone = onDone;
    this.colors = colors;
    this.input.onSubmit = (value) => {
      this.submit(value);
    };
  }

  handleInput(data: string): void {
    if (this.done) return;
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl('c')) ||
      matchesKey(data, Key.ctrl('d'))
    ) {
      this.cancel();
      return;
    }
    if (this.emptyHinted) this.emptyHinted = false;
    this.input.handleInput(data);
  }

  override invalidate(): void {
    super.invalidate();
    this.input.invalidate();
  }

  override render(width: number): string[] {
    this.input.focused = this.focused && !this.done;

    const safeWidth = Math.max(32, width);
    const innerWidth = Math.max(12, safeWidth - 4);
    const pad = '  ';
    const border = (s: string): string => chalk.hex(this.colors.primary)(s);
    const title = chalk.bold.hex(this.colors.textStrong)(INSTALL_TITLE);
    const subtitle = chalk.hex(this.colors.textDim)(
      this.emptyHinted ? INSTALL_EMPTY_SUBTITLE : INSTALL_SUBTITLE,
    );
    const footer = chalk.hex(this.colors.textDim)(INSTALL_FOOTER);
    const inputLine = this.input.render(innerWidth)[0] ?? '> ';
    const contentLines = [
      truncateToWidth(title, innerWidth, '…'),
      '',
      truncateToWidth(subtitle, innerWidth, '…'),
      '',
      inputLine,
      '',
      truncateToWidth(footer, innerWidth, '…'),
    ];

    const lines: string[] = [
      '',
      border('╭' + '─'.repeat(safeWidth - 2) + '╮'),
      border('│') + ' '.repeat(safeWidth - 2) + border('│'),
    ];

    for (const content of contentLines) {
      const rightPad = Math.max(0, innerWidth - visibleWidth(content));
      lines.push(border('│') + pad + content + ' '.repeat(rightPad) + border('│'));
    }

    lines.push(border('│') + ' '.repeat(safeWidth - 2) + border('│'));
    lines.push(border('╰' + '─'.repeat(safeWidth - 2) + '╯'));
    lines.push('');

    return lines;
  }

  private submit(value: string): void {
    if (this.done) return;
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      this.emptyHinted = true;
      return;
    }
    this.done = true;
    this.onDone({ kind: 'ok', value: trimmed });
  }

  private cancel(): void {
    if (this.done) return;
    this.done = true;
    this.onDone({ kind: 'cancel' });
  }
}

function buildOverviewItems(plugins: readonly PluginSummary[]): PluginsOverviewItem[] {
  const options: PluginsOverviewItem[] = plugins.map((plugin) => ({
    value: `${OVERVIEW_PLUGIN_PREFIX}${plugin.id}`,
    kind: 'plugin',
    label: plugin.displayName,
    status: pluginStatus(plugin),
    description: overviewPluginDescription(plugin),
  }));
  options.push(
    {
      value: OVERVIEW_MARKETPLACE,
      kind: 'action',
      label: 'Browse official marketplace',
      description: 'Install official plugins from marketplace.json.',
    },
    {
      value: OVERVIEW_INSTALL,
      kind: 'action',
      label: 'Install plugin',
      description: 'Install from a local path or zip URL.',
    },
    {
      value: OVERVIEW_RELOAD,
      kind: 'action',
      label: 'Reload plugins',
      description: 'Re-read installed.json and plugin manifests.',
    },
    {
      value: OVERVIEW_SHOW_LIST,
      kind: 'action',
      label: 'Show plugin summary',
      description: 'Append the current plugin summary to the transcript.',
    },
  );
  return options;
}

function overviewPluginDescription(plugin: PluginSummary): string {
  const shortcut = `Enter/→ details · Space ${plugin.enabled ? 'disable' : 'enable'}`;
  const state = plugin.state === 'ok' ? '' : ` · state ${plugin.state}`;
  const skills = `${plugin.skillCount} skill${plugin.skillCount === 1 ? '' : 's'}`;
  const tools = plugin.toolCount > 0 ? ` · ${plugin.toolCount} tool${plugin.toolCount === 1 ? '' : 's'}` : '';
  const mcp =
    plugin.mcpServerCount > 0
      ? ` · MCP ${plugin.enabledMcpServerCount}/${plugin.mcpServerCount}`
      : '';
  const diagnostics = plugin.hasErrors ? ' · diagnostics available' : '';
  return `${shortcut} · id ${plugin.id} · ${skills}${tools}${mcp}${state}${diagnostics}`;
}

function pluginStatus(plugin: PluginSummary): string {
  if (plugin.state !== 'ok') return plugin.state;
  return plugin.enabled ? 'enabled' : 'disabled';
}

function parseOverviewSelection(value: string): PluginsOverviewSelection | undefined {
  if (value === OVERVIEW_INSTALL) return { kind: 'install' };
  if (value === OVERVIEW_MARKETPLACE) return { kind: 'marketplace' };
  if (value === OVERVIEW_RELOAD) return { kind: 'reload' };
  if (value === OVERVIEW_SHOW_LIST) return { kind: 'show-list' };
  if (value.startsWith(OVERVIEW_PLUGIN_PREFIX)) {
    return { kind: 'plugin', id: value.slice(OVERVIEW_PLUGIN_PREFIX.length) };
  }
  return undefined;
}

function overviewItemPluginId(item: PluginsOverviewItem): string | undefined {
  if (!item.value.startsWith(OVERVIEW_PLUGIN_PREFIX)) return undefined;
  return item.value.slice(OVERVIEW_PLUGIN_PREFIX.length);
}

function buildMarketplaceItems(
  entries: readonly PluginMarketplaceEntry[],
  installedIds: ReadonlySet<string>,
): PluginsOverviewItem[] {
  const items: PluginsOverviewItem[] = entries.map((entry) => ({
    value: entry.id,
    kind: 'plugin',
    label: entry.displayName,
    status: installedIds.has(entry.id) ? 'installed' : installStatus(entry),
    description: marketplaceEntryDescription(entry, installedIds.has(entry.id)),
  }));
  items.push({
    value: 'back',
    kind: 'action',
    label: 'Back to installed plugins',
    description: 'Return to the local plugin manager.',
  });
  return items;
}

function marketplaceEntryDescription(entry: PluginMarketplaceEntry, installed: boolean): string {
  const action = installed ? 'Enter/Space update · → details' : 'Enter/Space install';
  const description = entry.description ?? 'Official plugin';
  const version = entry.version !== undefined ? ` · v${entry.version}` : '';
  const keywords =
    entry.keywords !== undefined && entry.keywords.length > 0
      ? ` · ${entry.keywords.join(', ')}`
      : '';
  return `${action} · ${description} · id ${entry.id}${version}${keywords}`;
}

function installStatus(entry: PluginMarketplaceEntry): string {
  return entry.version === undefined ? 'install' : `install v${entry.version}`;
}

function sectionLabel(label: string, colors: ColorPalette): string {
  return chalk.hex(colors.textDim).bold(` ${label}`);
}

function statusStyle(
  item: PluginsOverviewItem,
  colors: ColorPalette,
): (text: string) => string {
  if (item.kind === 'action') return chalk.hex(colors.textDim);
  if (item.status === 'enabled' || item.status === 'installed') return chalk.hex(colors.success);
  if (item.status?.startsWith('install')) return chalk.hex(colors.primary);
  if (item.status === 'disabled') return chalk.hex(colors.textDim);
  if (item.status !== undefined && /^\d/.test(item.status)) return chalk.hex(colors.textDim);
  return chalk.hex(colors.warning);
}

function wrapOverviewDescription(text: string, width: number): string[] {
  const maxWidth = Math.max(1, width);
  const words = text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (visibleWidth(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current.length > 0) lines.push(current);
    current = visibleWidth(word) <= maxWidth ? word : truncateToWidth(word, maxWidth, ELLIPSIS);
  }

  if (current.length > 0) lines.push(current);
  return lines;
}

function buildDetailOptions(info: PluginInfo): ChoiceOption[] {
  const options: ChoiceOption[] = [
    {
      value: DETAIL_INFO,
      label: 'Show details',
      description: 'Append manifest paths, skills, tools, MCP servers, and diagnostics.',
    },
    {
      value: DETAIL_TOGGLE,
      label: info.enabled ? 'Disable plugin' : 'Enable plugin',
      description: 'Plugin enabled state applies to new sessions after /new.',
    },
  ];

  for (const server of info.mcpServers) {
    options.push({
      value: `${DETAIL_MCP_PREFIX}${server.name}`,
      label: `${server.enabled ? 'Disable' : 'Enable'} MCP server: ${server.name}`,
      description: `${server.transport} server ${server.runtimeName}; changes apply after /new.`,
    });
  }

  options.push(
    {
      value: DETAIL_REMOVE,
      label: 'Remove plugin',
      description: 'Remove the install record; local source directories are left in place.',
    },
    {
      value: DETAIL_BACK,
      label: 'Back to plugins',
    },
  );
  return options;
}

function parseDetailSelection(value: string, info: PluginInfo): PluginDetailSelection | undefined {
  if (value === DETAIL_INFO) return { kind: 'info' };
  if (value === DETAIL_TOGGLE) return { kind: 'toggle', enabled: !info.enabled };
  if (value === DETAIL_REMOVE) return { kind: 'remove' };
  if (value === DETAIL_BACK) return { kind: 'back' };
  if (value.startsWith(DETAIL_MCP_PREFIX)) {
    const serverName = value.slice(DETAIL_MCP_PREFIX.length);
    const server = info.mcpServers.find((item) => item.name === serverName);
    if (server === undefined) return undefined;
    return { kind: 'mcp', server: serverName, enabled: !server.enabled };
  }
  return undefined;
}
