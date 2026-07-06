# pi-herdr

Herdr integration for [pi coding agent](https://pi.dev) — manage workspaces, tabs, panes, and coordinate agents from within pi.

## Features

- **8 LLM-callable tools** for managing herdr workspaces, tabs, and panes
- **Interactive commands** (`/herdr status`, `/herdr panes`, `/herdr split`, etc.)
- **Status bar widget** showing current pane/workspace info
- **Agent coordination** — wait for agent status, read output from sibling panes
- **Skill included** — guide for using herdr tools effectively

## Install

```bash
pi install git:github.com/kodicw/pi-herdr
```

Or try without installing:

```bash
pi -e git:github.com/kodicw/pi-herdr
```

## Requirements

- [herdr](https://herdr.dev) installed and in PATH
- Running inside a herdr session (`HERDR_ENV=1`)

## Tools

| Tool | Description |
|------|-------------|
| `herdr_panes` | List all panes with status |
| `herdr_read` | Read output from a pane |
| `herdr_run` | Run a command in a pane |
| `herdr_split` | Split a pane |
| `herdr_wait_output` | Wait for text pattern in a pane |
| `herdr_wait_agent` | Wait for agent to reach a status |
| `herdr_tabs` | List tabs in a workspace |
| `herdr_workspaces` | List all workspaces |

## Commands

```
/herdr status          # Show current pane/workspace info
/herdr panes           # List all panes
/herdr tabs [ws-id]    # List tabs
/herdr workspaces      # List workspaces
/herdr read <id> [n]   # Read pane output
/herdr split [dir]     # Split current pane (right/down)
```

## Development

```bash
git clone https://github.com/kodicw/pi-herdr
cd pi-herdr
npm install
pi -e ./extensions/herdr.ts
```

## License

MIT
