/**
 * ChoicePicker — modal single-select list for slash commands that ask
 * the user to pick from a small set of preset values.
 *
 * Mirrors SessionPickerComponent's container-replacement pattern: host
 * calls `showChoicePicker(...)` which clears the editor container,
 * addChild(picker), setFocus(picker); the picker invokes `onSelect` or
 * `onCancel`, and the host tears it down.
 */

import {
  Container,
  matchesKey,
  Key,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '@earendil-works/pi-tui';
import chalk from 'chalk';

import type { ColorPalette } from '#/tui/theme/colors';
import { printableChar } from '#/tui/utils/printable-key';

export interface ChoiceOption {
  /** Value passed to onSelect (e.g. the actual editor command string). */
  readonly value: string;
  /** Display text shown in the list. */
  readonly label: string;
  /** Optional explanatory text shown below the label. */
  readonly description?: string | undefined;
}

export interface ChoicePickerOptions {
  readonly title: string;
  readonly hint?: string;
  readonly notice?: string;
  readonly options: readonly ChoiceOption[];
  readonly currentValue?: string;
  readonly colors: ColorPalette;
  readonly onSelect: (value: string) => void;
  readonly onCancel: () => void;
}

const CURRENT_MARK = '← current';

function wrapDescription(text: string, width: number): string[] {
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
    current = visibleWidth(word) <= maxWidth ? word : truncateToWidth(word, maxWidth, '…');
  }

  if (current.length > 0) lines.push(current);
  return lines;
}

export class ChoicePickerComponent extends Container implements Focusable {
  focused = false;
  private readonly opts: ChoicePickerOptions;
  private selectedIndex: number;

  constructor(opts: ChoicePickerOptions) {
    super();
    this.opts = opts;
    const currentIdx = opts.options.findIndex((o) => o.value === opts.currentValue);
    this.selectedIndex = Math.max(currentIdx, 0);
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
      this.selectedIndex = Math.min(this.opts.options.length - 1, this.selectedIndex + 1);
      return;
    }
    if (
      matchesKey(data, Key.enter) ||
      matchesKey(data, Key.right) ||
      matchesKey(data, Key.space) ||
      printableChar(data) === ' '
    ) {
      const chosen = this.opts.options[this.selectedIndex];
      if (chosen !== undefined) this.opts.onSelect(chosen.value);
      return;
    }
  }

  override render(width: number): string[] {
    const { colors } = this.opts;
    const hint = this.opts.hint ?? '↑↓ navigate · Enter select · Esc cancel';
    const lines: string[] = [
      chalk.hex(colors.primary)('─'.repeat(width)),
      chalk.hex(colors.primary).bold(` ${this.opts.title}`),
      chalk.hex(colors.textMuted)(` ${hint}`),
    ];
    if (this.opts.notice !== undefined) {
      lines.push(chalk.hex(colors.success)(` ${this.opts.notice}`));
    }
    lines.push('');

    for (let i = 0; i < this.opts.options.length; i++) {
      const opt = this.opts.options[i]!;
      const isSelected = i === this.selectedIndex;
      const isCurrent = opt.value === this.opts.currentValue;
      const pointer = isSelected ? '❯' : ' ';
      const labelStyle = isSelected ? chalk.hex(colors.primary).bold : chalk.hex(colors.text);
      let line = chalk.hex(isSelected ? colors.primary : colors.textDim)(`  ${pointer} `);
      line += labelStyle(opt.label);
      if (isCurrent) {
        line += ' ' + chalk.hex(colors.success)(CURRENT_MARK);
      }
      lines.push(line);
      if (opt.description !== undefined && opt.description.length > 0) {
        const descriptionWidth = Math.max(1, width - 4);
        for (const descLine of wrapDescription(opt.description, descriptionWidth)) {
          lines.push(chalk.hex(colors.textMuted)(`    ${descLine}`));
        }
      }
    }

    lines.push('');
    lines.push(chalk.hex(colors.primary)('─'.repeat(width)));
    return lines.map((line) => truncateToWidth(line, width));
  }
}
