---
name: herdr-pi
description: "Use the herdr tools registered by the pi-herdr extension to manage herdr workspaces, tabs, and panes, and to coordinate with sibling agents. Triggers: split a pane, run a command in another pane, wait for a server/build/tests to finish, read another agent's output, check on sibling agents, coordinate work across panes."
---

# herdr-pi — using herdr tools in pi

This skill covers the herdr tools registered by the `pi-herdr` extension. The
tools let you control herdr from inside the agent so you can split panes, run
commands, read output, and coordinate with sibling agents.

**Prerequisite:** The `pi-herdr` package must be installed and you must be
running inside herdr (`HERDR_ENV=1`). If a tool returns "herdr not available",
you are not inside herdr and these tools cannot be used.

## important: discover IDs dynamically

Pane, tab, and workspace IDs are **compact live IDs** that can change when tabs,
panes, or workspaces are closed. They look like `wH`, `wH:t3`, `wH:pF` — **not**
`1-1`. Never hardcode or guess an ID from a previous turn.

Always re-discover IDs first:

1. Call `herdr_panes` (or `herdr_workspaces` / `herdr_tabs`) to get current IDs.
2. Read `result.panes` for the pane list. Each pane has `pane_id`, `workspace_id`,
   `tab_id`, `focused`, `agent`, and `agent_status`.
3. The `focused: true` pane is the one you are running in.

When you split a pane, the new pane ID is in the response at
`result.pane.pane_id`. Parse it and use it for the next call.

## tools

### herdr_panes
List all panes. No parameters. Returns `{ result: { panes: [...] } }`.
Each pane: `pane_id`, `workspace_id`, `tab_id`, `focused`, `agent`, `agent_status`
(`idle`, `working`, `blocked`, `done`, `unknown`).

### herdr_workspaces
List all workspaces. Returns `{ result: { workspaces: [...] } }`.
Each workspace: `workspace_id`, `label`, `focused`, `agent_status`, `pane_count`, `tab_count`.

### herdr_tabs
List tabs in a workspace. Optional `workspaceId` (default: current).
Returns `{ result: { tabs: [...] } }`.

### herdr_read
Read output from a pane. Parameters: `paneId` (required), `lines` (default 50),
`source` (`visible`, `recent`, `recent-unwrapped`; default `recent`). Use
`recent-unwrapped` when you want the same text that `herdr_wait_output` matches
against. Prints the pane's recent text (not JSON).

### herdr_run
Run a command in a pane. Parameters: `paneId`, `command`. Sends the text plus a
real Enter key. Use this to start servers, run tests, or drive another agent.

### herdr_split
Split a pane. Parameters: `paneId`, `direction` (`right` or `down`),
`noFocus` (default true keeps focus on your pane). Returns the new pane at
`result.pane.pane_id`.

### herdr_wait_output
Block until text appears in a pane. Parameters: `paneId`, `match`, `timeout`
(ms, default 30000), `regex` (treat match as regex). Returns success or
times out with an error. Use for "ready on port 3000", "test result", etc.

### herdr_wait_agent
Block until an agent reaches a status. Parameters: `paneId`, `status`
(`idle`, `working`, `blocked`, `done`), `timeout` (ms, default 60000). Use
`done` to wait until a sibling agent finishes a task.

## recipes

### Start a server in a split pane and wait until ready
```
# 1. discover current panes
herdr_panes()
# -> pick your focused pane_id, e.g. "wH:pM"

# 2. split and capture the new pane id
herdr_split(paneId="wH:pM", direction="right")
# -> response.result.pane.pane_id  e.g. "wH:pN"

# 3. start the server there
herdr_run(paneId="wH:pN", command="npm run dev")

# 4. wait for the ready line
herdr_wait_output(paneId="wH:pN", match="ready on port", timeout=30000)

# 5. confirm by reading recent output
herdr_read(paneId="wH:pN", lines=20)
```

### Run tests in a separate pane and read the result
```
herdr_panes()
herdr_split(paneId="<focused>", direction="down")
# -> new pane id from response.result.pane.pane_id
herdr_run(paneId="<new-pane>", command="pytest")
herdr_wait_output(paneId="<new-pane>", match="passed|failed|error", regex=true, timeout=60000)
herdr_read(paneId="<new-pane>", lines=30)
```

### Coordinate with a sibling agent
```
herdr_panes()                              # find the sibling pane_id
herdr_wait_agent(paneId="wR:p1", status="done", timeout=120000)
herdr_read(paneId="wR:p1", lines=100)      # read what it produced
```

### Check what another agent is doing right now
```
herdr_panes()                              # locate the agent pane
herdr_read(paneId="wR:p1", lines=80)       # read its current screen
```

## commands (optional, user-facing)

These are available for the user, not needed by the agent:

- `/herdr status` — show current pane/workspace
- `/herdr panes` — list panes
- `/herdr tabs [workspace-id]` — list tabs
- `/herdr workspaces` — list workspaces
- `/herdr read <pane-id> [lines]` — read a pane
- `/herdr split [direction]` — split current pane

## notes

- Pane IDs are validated and must match `^[A-Za-z0-9:_-]+$`. Invalid IDs return
  an error instead of running.
- Use `herdr_read` for output that already exists. Use `herdr_wait_output` for
  output you expect next.
- `done` means the agent finished but the user has not looked at it yet.
- Closing tabs/panes can compact IDs — re-discover them before reusing.