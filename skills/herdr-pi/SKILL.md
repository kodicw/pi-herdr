---
name: herdr-pi
description: "Use herdr tools registered by the pi-herdr extension. Manage workspaces, tabs, panes, and coordinate with agents running in other panes."
---

# herdr-pi — using herdr tools in pi

This skill covers the herdr tools and commands registered by the `pi-herdr` extension.

**Prerequisite:** The `pi-herdr` package must be installed and you must be running inside herdr (`HERDR_ENV=1`).

## tools

The following tools are registered by the extension and callable by the LLM:

### herdr_panes
List all panes with their IDs, focus state, and agent status.

### herdr_read
Read output from a specific pane. Parameters:
- `paneId` — pane ID (e.g., `1-1`, `1-2`)
- `lines` — number of lines (default: 50)
- `source` — `visible`, `recent`, or `recent-unwrapped`

### herdr_run
Run a command in a specific pane. Parameters:
- `paneId` — target pane
- `command` — command to execute

### herdr_split
Split a pane. Parameters:
- `paneId` — pane to split from
- `direction` — `right` or `down`
- `noFocus` — keep focus on current pane (default: true)

### herdr_wait_output
Wait for text to appear in a pane. Parameters:
- `paneId` — pane to watch
- `match` — text or regex pattern
- `timeout` — milliseconds (default: 30000)
- `regex` — treat match as regex

### herdr_wait_agent
Wait for an agent to reach a status. Parameters:
- `paneId` — pane to watch
- `status` — `idle`, `working`, `blocked`, or `done`
- `timeout` — milliseconds (default: 60000)

### herdr_tabs
List tabs in a workspace. Parameters:
- `workspaceId` — workspace ID (default: current)

### herdr_workspaces
List all herdr workspaces.

## commands

### /herdr status
Show current pane, tab, and workspace info.

### /herdr panes
List all panes with IDs and agent status.

### /herdr tabs [workspace-id]
List tabs in current or specified workspace.

### /herdr workspaces
List all workspaces.

### /herdr read <pane-id> [lines]
Read recent output from a pane.

### /herdr split [direction]
Split current pane (`right` or `down`).

## recipes

### Start a server and wait for it
```
herdr_split(paneId="1-2", direction="right")
# Note the new pane ID from the result
herdr_run(paneId="<new-pane>", command="npm run dev")
herdr_wait_output(paneId="<new-pane>", match="ready on port", timeout=30000)
herdr_read(paneId="<new-pane>", lines=20)
```

### Coordinate with another agent
```
herdr_wait_agent(paneId="1-1", status="done", timeout=120000)
herdr_read(paneId="1-1", lines=100)
```

### Run tests in a split pane
```
herdr_split(paneId="1-2", direction="down")
herdr_run(paneId="<new-pane>", command="pytest")
herdr_wait_output(paneId="<new-pane>", match="passed|failed", regex=true, timeout=60000)
herdr_read(paneId="<new-pane>", lines=30)
```
