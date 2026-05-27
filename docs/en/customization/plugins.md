# Plugins

Plugins package reusable Kimi Code CLI behavior around a `plugin.json` manifest. A plugin can contribute skills, register command-backed tools, add plugin-specific instructions to those skills, declare a session-start skill, and declare MCP servers that the user can enable explicitly. Multi-harness repositories can put the same Kimi manifest under `.kimi-plugin/plugin.json` instead of occupying the repository root.

Installing a plugin does not execute plugin-provided Python, Node.js, Shell, or hook scripts. Declared plugin tools are registered for new sessions and run only when the model calls them through the normal tool approval flow. Explicitly enabled `mcpServers` are started in new sessions.

## Installing and managing plugins

Run `/plugins` inside the TUI to open the interactive plugin manager. The picker lists installed plugins and lets you install, inspect, enable, disable, remove, reload, and toggle plugin MCP servers without remembering subcommands. Use `Enter` or `→` to open details, `Space` to enable or disable an installed plugin, and `←` or `Esc` to go back. In the marketplace view, `Enter` or `Space` installs or updates the selected plugin; installed entries also support `→` to open details.

Shortcut commands remain available for quick or scripted actions:

```sh
/plugins
/plugins <id>
/plugins <path-or-zip-url>
/plugins install /absolute/path/to/plugin
/plugins install ./relative-plugin
/plugins install https://example.com/plugin.zip
/plugins marketplace
/plugins marketplace ./plugins/marketplace.json
/plugins info <id>
/plugins enable <id>
/plugins disable <id>
/plugins remove <id>
/plugins reload
/plugins mcp enable <id> <server>
/plugins mcp disable <id> <server>
```

Hosted example packages:

```sh
/plugins https://kimi-1300010026.cos.ap-beijing.myqcloud.com/kimi-datasource.zip
/plugins https://kimi-1300010026.cos.ap-beijing.myqcloud.com/superpowers-kimi-5.1.0-kimi.1.zip
```

The official marketplace loads from `https://code.kimi.com/kimi-code/plugins/marketplace.json` by default. In `/plugins`, choose **Browse official marketplace** to list the marketplace entries and install one directly. The CDN can host the whole marketplace directory with `marketplace.json` at its root; relative plugin sources are resolved next to that file.

To test a staging CDN file or alternate marketplace, override the marketplace source:

```sh
KIMI_CODE_PLUGIN_MARKETPLACE_URL=https://staging.example.com/plugins/marketplace.json kimi
```

You can also open a one-off marketplace file without changing the environment:

```sh
/plugins marketplace plugins/marketplace.json
```

During CLI development, `pnpm dev:cli` starts a loopback marketplace server for the repository's `plugins/` directory and temporarily sets `KIMI_CODE_PLUGIN_MARKETPLACE_URL=http://127.0.0.1:<port>/marketplace.json` for that dev process. The server rewrites local directory sources to temporary zip URLs so marketplace installs exercise the same download path as the CDN. To test the real CDN from dev, set `KIMI_CODE_PLUGIN_MARKETPLACE_URL=https://code.kimi.com/kimi-code/plugins/marketplace.json pnpm dev:cli`; the dev wrapper will use that value instead of starting the local marketplace server.

Local directories and Zip URLs are copied into Kimi Code CLI's managed plugin directory under `$KIMI_CODE_HOME/plugins/managed/<id>/`. Installing the same plugin id again overwrites that managed copy, preserving the plugin's enabled state and MCP server toggles. `installed.json` records the managed copy plus the original source for display. Removing a plugin asks for confirmation, then only removes the install record; it does not delete the managed copy or the original local source directory.

Plugin changes apply to new sessions. After installing, enabling, disabling, removing, reloading, or enabling a plugin MCP server, start a fresh session with `/new` for the change to affect the available skills, plugin tools, `sessionStart.skill`, and MCP servers. Existing sessions keep the snapshot they started with.

The reload action re-reads `installed.json` and each plugin manifest so that `/plugins` and `/plugins info <id>` show the latest install state and diagnostics. It is not a hot reload for the current session's skills or MCP connections.
Because local-path installs run from the managed copy, editing the original source directory after install has no effect until you reinstall the plugin.

## Manifest format

Kimi Code CLI treats a root `plugin.json` as the primary plugin manifest:

```text
<plugin_root>/plugin.json
```

If `plugin.json` is absent, Kimi Code CLI reads the Kimi-scoped manifest:

```text
<plugin_root>/.kimi-plugin/plugin.json
```

Kimi Code CLI does not read `.codex-plugin/plugin.json`. If both `plugin.json` and `.kimi-plugin/plugin.json` exist, the root `plugin.json` wins and the `.kimi-plugin` manifest is shown as shadowed in `/plugins info`.

A typical plugin manifest looks like this:

```json
{
  "name": "kimi-finance",
  "version": "1.0.0",
  "description": "Finance data and analysis workflows for Kimi Code CLI",
  "keywords": ["finance", "mcp"],
  "skills": "./skills/",
  "sessionStart": {
    "skill": "using-finance"
  },
  "skillInstructions": "Prefer finance plugin tools for live market data. Do not invent live prices.",
  "tools": {
    "query_finance": {
      "description": "Query finance data",
      "command": "./bin/query-finance",
      "inputSchema": {
        "type": "object",
        "properties": {
          "symbol": { "type": "string" }
        },
        "required": ["symbol"]
      }
    }
  },
  "interface": {
    "displayName": "Kimi Finance",
    "shortDescription": "Market data and financial analysis workflows"
  }
}
```

Supported fields:

| Field | Description |
| --- | --- |
| `name` | Required plugin id source. Must match `[a-z0-9][a-z0-9_-]{0,63}`. |
| `version`, `description`, `keywords`, `author`, `homepage`, `license` | Display metadata. |
| `skills` | One path or an array of paths. Each path must start with `./` and stay inside the plugin root after symlinks are resolved. |
| root `SKILL.md` | If `skills` is omitted and the plugin root contains `SKILL.md`, the root is treated as a single skill root. |
| `sessionStart.skill` | Declaratively injects the named skill into the main agent at the start of a new or resumed session. |
| `skillInstructions` | Extra instructions prepended whenever a skill from this plugin is loaded. |
| `tools` | Command-backed tool declarations. Each tool runs only when called, uses stdin JSON by default, and is exposed as `plugin__<plugin>__<tool>`. |
| `mcpServers` | MCP server declarations. They are displayed after install, but each server stays disabled until the user enables it. |
| `interface` | Display fields for `/plugins info`, such as `displayName`, `shortDescription`, `longDescription`, `developerName`, `capabilities`, `websiteURL`, and `defaultPrompt`. |

Unsupported legacy fields such as `configFile`, `config_file`, `inject`, `bootstrap`, `hooks`, and `apps` are reported as diagnostics and ignored.

## Skills and session start

Plugin skills use the same `SKILL.md` format as ordinary [Agent Skills](./skills.md). The common layout is:

```text
my-plugin/
  plugin.json
  skills/
    using-my-plugin/
      SKILL.md
    another-workflow/
      SKILL.md
```

`sessionStart.skill` is a declarative session-start rule: it loads a skill into the main agent's context once at the start of a session. It does not execute code. Use it when the plugin needs to establish workflow rules before the first user task, such as mapping another tool harness's terminology to Kimi Code CLI tools.

`skillInstructions` stays next to the skill content whenever the skill is loaded, whether the skill was loaded by `sessionStart.skill`, by `/skill:<name>`, or by the model's automatic skill invocation.

## Plugin tools

Plugin tools are declared data, not imported JavaScript. Kimi Code CLI resolves each `command` under the managed plugin root and registers the tool under a namespaced name:

```json
{
  "tools": {
    "query_finance": {
      "description": "Query finance data",
      "command": "./bin/query-finance",
      "args": ["quote"],
      "inputSchema": {
        "type": "object",
        "properties": {
          "symbol": { "type": "string" }
        },
        "required": ["symbol"]
      }
    }
  }
}
```

Rules:

- `command` must start with `./`, resolve inside the plugin root after symlinks, and point to a file.
- `args` is an optional string array. Kimi Code CLI never invokes a shell for plugin tools.
- Tool input is sent to stdin as JSON unless `stdin` is `"none"`.
- `timeoutMs` defaults to `120000` and is capped at `600000`.
- Runtime environment includes `KIMI_CODE_HOME`, `KIMI_PLUGIN_ROOT`, and `KIMI_PLUGIN_DATA`.
- The model sees the tool as `plugin__<plugin-id>__<tool-name>`, for example `plugin__kimi-datasource__query_stock`.

## MCP servers in plugins

Plugin MCP servers reuse the same server schema as [MCP](./mcp.md). They can be stdio servers:

```json
{
  "mcpServers": {
    "finance": {
      "command": "uvx",
      "args": ["kimi-finance-mcp"]
    }
  }
}
```

Or HTTP servers:

```json
{
  "mcpServers": {
    "docs": {
      "url": "https://example.com/mcp"
    }
  }
}
```

For stdio servers, `command` may be a command found on `PATH`, or a `./` path inside the plugin root. If `cwd` is set, it must also start with `./` and stay inside the plugin root. Plugin MCP servers inherit the current process environment; values written under `env` are literal overrides, not `${VAR}` interpolation.

Installing a plugin never starts its MCP servers. Enable a server explicitly:

```sh
/plugins
# choose the plugin, then choose "Enable MCP server"

# or use the shortcut:
/plugins mcp enable kimi-finance finance
/new
```

The enabled state is stored in `$KIMI_CODE_HOME/plugins/installed.json`. Once a new session starts, enabled plugin MCP servers go through the normal MCP lifecycle, status events, tool naming, and permission approval flow.

## Security model

Plugins are loaded conservatively:

- Only `plugin.json`, `.kimi-plugin/plugin.json`, and Markdown skill files are read during install and session startup.
- Plugin tools do not run at install time or session startup. They run only when called as tools and go through normal approval.
- Hooks and legacy tool runtimes are not executed by the plugin loader.
- Plugin paths must stay inside the plugin root after symlinks are resolved.
- MCP servers declared by a plugin are opt-in and only start in a new session after you enable them from `/plugins` or with `/plugins mcp enable`.
- Bad manifests or unsafe paths produce diagnostics shown by `/plugins info <id>` and do not crash unrelated sessions.
