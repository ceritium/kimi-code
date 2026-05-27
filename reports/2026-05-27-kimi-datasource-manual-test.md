# kimi-datasource / Superpowers 插件手动测试说明

这份说明给内部验证用，命令可以直接整段复制到 TUI 里逐条执行。

## 测试包

- kimi-datasource 仓库内源码：`plugins/official/kimi-datasource`
- kimi-datasource 本机源码副本：`/Users/moonshot/code/kimi-datasource`
- kimi-datasource 本地 zip：`/Users/moonshot/code/kimi-datasource.zip`
- kimi-datasource CDN：`https://kimi-1300010026.cos.ap-beijing.myqcloud.com/kimi-datasource.zip`
- Superpowers Kimi 适配 CDN：`https://kimi-1300010026.cos.ap-beijing.myqcloud.com/superpowers-kimi-5.1.0-kimi.1.zip`

注意：当前 `/plugins install` 只有 `http://` / `https://` 会走 zip 安装。本地 zip 路径
`/Users/moonshot/code/kimi-datasource.zip` 不能直接安装；本地测试源码用目录路径，CDN 测试用 URL。

## kimi-datasource：本地源码安装

```text
/plugins install plugins/official/kimi-datasource
/plugins info kimi-datasource
/new
/skill:kimi-datasource 查一下贵州茅台现在多少钱
```

预期：

- `/plugins info kimi-datasource` 显示 plugin 已启用，source 是 `local-path`。
- Root 在 `$KIMI_CODE_HOME/plugins/managed/kimi-datasource` 下，Original source 是本地源码目录。
- 安装后修改本地源码目录不会影响已安装 plugin；要更新需要重新 `/plugins install ...`。
- 能看到根目录 `SKILL.md` 作为 plugin skill。
- 不需要 `/plugins mcp enable`，`/plugins info` 中 MCP server 数量应为 0。
- 模型应通过 Bash 执行 `${KIMI_SKILL_DIR}/bin/kimi-datasource.mjs`。
- datasource 脚本是纯 Node 实现，直接读取 `$KIMI_CODE_HOME/credentials/kimi-code.json`。
- 如果没有 Kimi Code 登录凭据，应该表现为 Bash 命令错误，不应该是 plugin 安装错误。

## kimi-datasource：CDN zip 安装

如果已经装过本地目录，先移除。zip 安装不能覆盖同 id 的 local-path 安装：

```text
/plugins remove kimi-datasource
/plugins install https://kimi-1300010026.cos.ap-beijing.myqcloud.com/kimi-datasource.zip
/plugins info kimi-datasource
/new
/skill:kimi-datasource 查一下贵州茅台现在多少钱
```

预期：

- `/plugins info kimi-datasource` 显示 source 是 `zip-url`。
- Original source 是 `https://kimi-1300010026.cos.ap-beijing.myqcloud.com/kimi-datasource.zip`。
- managed root 在 `$KIMI_CODE_HOME/plugins/managed/kimi-datasource` 下。
- skills-only 行为与本地源码安装一致。

## Superpowers：CDN zip 安装

```text
/plugins install https://kimi-1300010026.cos.ap-beijing.myqcloud.com/superpowers-kimi-5.1.0-kimi.1.zip
/plugins info superpowers
/new
Let's make a react todo list
```

预期：

- `/plugins info superpowers` 显示 source 是 `zip-url`。
- 能看到 skills 目录。
- 能看到 `Session start: using-superpowers`。
- 能看到 `Skill instructions: present`。
- `/new` 后首轮会注入 `using-superpowers`。
- 用户输入 `Let's make a react todo list` 后，应进入 Superpowers 的 brainstorming 流程。
- 需要向用户澄清选择时，应调用 Kimi 的 `AskUserQuestion`，显示 TUI 选择问题，而不是把选项直接写成普通文本。

## 清理

```text
/plugins remove kimi-datasource
/plugins remove superpowers
/new
```

预期：

- `installed.json` 不再包含 `kimi-datasource` / `superpowers`。
- `plugins/official/kimi-datasource` 和 `/Users/moonshot/code/kimi-datasource` 源码目录不受影响。
- CDN zip 解压出的 managed 目录即使还留在磁盘上，也不会继续参与 session。

## 提交前检查

- datasource 文档和测试命令里使用官方 CDN：
  `https://kimi-1300010026.cos.ap-beijing.myqcloud.com/kimi-datasource.zip`
- 如果 `plugins/official/kimi-datasource` 有变更，需要重新打包并上传
  `/Users/moonshot/code/kimi-datasource.zip` 到上面的官方 CDN 地址。
- Superpowers 测试命令使用当前 Kimi 适配 CDN：
  `https://kimi-1300010026.cos.ap-beijing.myqcloud.com/superpowers-kimi-5.1.0-kimi.1.zip`
- 不要把 `/Users/moonshot/Downloads/kimi-datasource.zip` 这种原始旧版 zip 当作新版 Kimi Code plugin 测试包。
