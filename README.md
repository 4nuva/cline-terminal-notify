# cline-terminal-notify

> **From the makers of [Agent Terminal](https://4nuva.dev/agent-terminal/).**
> In Agent Terminal these notifications also reach your paired phone, where you
> can open the session and reply. [Get Agent Terminal →](https://4nuva.dev/agent-terminal/)

A Cline plugin that raises a desktop notification through your terminal when Cline:

- finishes a run: `Task complete: Fixed the failing test. All 42 tests pass.`
- needs a permission: `Permission needed: run_commands — npm run deploy`
- asks you a question: `Question: Which database should I use?`

The title names the project folder (`Cline · my-app`), so you can tell sessions apart. Runs and tool calls of subagents, runs you stop and runs that fail raise nothing.

## Install

```
cline plugin install --git https://github.com/4nuva/cline-terminal-notify
```

This installs for your user (`~/.cline/plugins`). Add `--cwd .` to install for the current project only (`.cline/plugins`). Restart Cline afterwards.

Requires the Cline CLI 3 or later. The VS Code and JetBrains extensions do not load plugins.

## Terminals

The plugin writes a notification escape sequence to the terminal Cline runs in, and picks the sequence for the terminal it detects:

| Terminal | Sequence |
| --- | --- |
| [Agent Terminal](https://4nuva.dev/agent-terminal/) (desktop and phone) | OSC 777 |
| Ghostty, Warp, urxvt | OSC 777 |
| Windows Terminal, iTerm2, WezTerm, ConEmu | OSC 9 |
| kitty | OSC 99 |
| macOS Terminal, VS Code | bell |
| anything else | OSC 9 |

## Settings

Set these as environment variables.

| Variable | Values | Default |
| --- | --- | --- |
| `TERMINAL_NOTIFY_FORMAT` | `auto`, `osc777`, `osc9`, `osc99`, `all`, `bell`, `off` | `auto` |
| `TERMINAL_NOTIFY_DETAILS` | `true`, `false` | `true` |

`auto` picks a sequence for your terminal. `all` writes all three, for a terminal `auto` does not know (one that reads several shows several). `off` turns notifications off.

Details include the start of Cline's reply, the command or file a permission is for, and the question. With details off, a notification shows only the event. Known key and token formats are masked either way.

## How it differs from the Claude Code plugin

[terminal-notify for Claude Code](https://github.com/4nuva/claude-terminal-notify) has the same notifications. Cline's plugins differ in three ways:

- Cline has no hook for an approval prompt. The plugin treats a tool call that has not started 4 seconds after Cline issued it as waiting for you, so a permission notification comes about 4 seconds after the prompt appears.
- Cline has no hook for an idle prompt, so there is no idle reminder.
- Settings are environment variables. Cline plugins have no settings screen.

## Development

```
npm test
```

## License

MIT
