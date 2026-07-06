/**
 * pi-herdr extension — Herdr integration for pi coding agent
 *
 * Provides tools for managing herdr workspaces, tabs, and panes,
 * plus commands and a status widget showing current pane info.
 *
 * Requires herdr CLI in PATH and HERDR_ENV=1 for full functionality.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defineTool, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execSync, execFileSync, execFile } from "node:child_process";

// ============================================================================
// Helpers
// ============================================================================

let extensionApi: ExtensionAPI | null = null;

function herdrAvailable(): boolean {
  try {
    execSync("which herdr", { stdio: "ignore" });
    return process.env.HERDR_ENV === "1";
  } catch {
    return false;
  }
}

function herdrExec(args: string[]): string {
  return execFileSync("herdr", args, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return { raw: output };
  }
}

// Pane/tab/workspace IDs look like wH, wH:t3, wH:pF. Validate before
// interpolating into shell commands to prevent injection from LLM input.
const ID_RE = /^[A-Za-z0-9:_-]+$/;
function assertValidId(id: string, field: string): string {
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new Error(`Invalid ${field}: ${JSON.stringify(id)}`);
  }
  return id;
}

// Matches a bare `herdr <subcommand>` invocation at a command position:
// start of string, or after a shell separator (; & | ( ` or whitespace).
const HERDR_CMD_RE = /(?:^|;(?:\s*|&+|\|*)|&+\s*|\|+\s*|\(\s*|`\s*|^\s*sudo\s+)herdr\s+(\w+)/;
const HERDR_TOOL_HINTS: Record<string, { tool: string; hint: string }> = {
  pane: { tool: "herdr_panes / herdr_read / herdr_run / herdr_split / herdr_send / herdr_pane_close", hint: "use herdr_panes to list, herdr_read to read output, herdr_run to run a command, herdr_split to split, herdr_send to send text or keys without Enter, or herdr_pane_close to close a pane" },
  tab: { tool: "herdr_tabs / herdr_tab_create / herdr_tab_focus / herdr_tab_rename / herdr_tab_close", hint: "use herdr_tabs to list, herdr_tab_create to create, herdr_tab_focus to focus, herdr_tab_rename to rename, or herdr_tab_close to close a tab" },
  workspace: { tool: "herdr_workspaces / herdr_workspace_create / herdr_workspace_focus / herdr_workspace_rename / herdr_workspace_close", hint: "use herdr_workspaces to list, herdr_workspace_create to create, herdr_workspace_focus to focus, herdr_workspace_rename to rename, or herdr_workspace_close to close a workspace" },
  wait: { tool: "herdr_wait_output / herdr_wait_agent", hint: "use herdr_wait_output to wait for text, or herdr_wait_agent to wait for an agent status" },
};

function detectHerdrCli(command: string): { subcommand: string; tool: string; hint: string } | null {
  const m = HERDR_CMD_RE.exec(command);
  if (!m) return null;
  const sub = m[1] ?? "";
  const entry = HERDR_TOOL_HINTS[sub] ?? { tool: "herdr_* tools", hint: "use the herdr_* tools provided by the pi-herdr extension instead of the raw herdr CLI" };
  return { subcommand: sub, tool: entry.tool, hint: entry.hint };
}

// ============================================================================
// Tool Definitions
// ============================================================================

const herdrPanesTool = defineTool({
  name: "herdr_panes",
  label: "Herdr Panes",
  description: "List all panes in the current workspace with their status",
  parameters: Type.Object({}),
  promptSnippet: "List herdr panes with agent status",
  async execute(): Promise<any> {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available (HERDR_ENV != 1 or herdr not in PATH)" }], details: {} };
    }
    const output = herdrExec(["pane", "list"]);
    const data = parseJson(output);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      details: { panes: data },
    };
  },
});

const herdrReadTool = defineTool({
  name: "herdr_read",
  label: "Herdr Read",
  description: "Read output from a specific herdr pane",
  parameters: Type.Object({
    paneId: Type.String({ description: "Pane ID (e.g., 1-1, 1-2)" }),
    lines: Type.Optional(Type.Number({ description: "Number of lines to read (default: 50)" })),
    source: Type.Optional(Type.Union([
      Type.Literal("visible"),
      Type.Literal("recent"),
      Type.Literal("recent-unwrapped"),
    ])),
  }),
  promptSnippet: "Read output from a herdr pane",
  async execute(_toolCallId: string, params: any): Promise<any> {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    assertValidId(params.paneId, "paneId");
    const lines = params.lines ?? 50;
    const source = params.source ?? "recent";
    const output = herdrExec(["pane", "read", params.paneId, "--source", source, "--lines", String(lines)]);
    return { content: [{ type: "text" as const, text: output }], details: { paneId: params.paneId } };
  },
});

const herdrRunTool = defineTool({
  name: "herdr_run",
  label: "Herdr Run",
  description: "Run a command in a specific herdr pane",
  parameters: Type.Object({
    paneId: Type.String({ description: "Pane ID to run the command in" }),
    command: Type.String({ description: "Command to execute" }),
  }),
  promptSnippet: "Run a command in a herdr pane",
  async execute(_toolCallId: string, params: any): Promise<any> {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    assertValidId(params.paneId, "paneId");
    herdrExec(["pane", "run", params.paneId, params.command]);
    return { content: [{ type: "text" as const, text: `Command sent to pane ${params.paneId}` }], details: { paneId: params.paneId } };
  },
});

const herdrSplitTool = defineTool({
  name: "herdr_split",
  label: "Herdr Split",
  description: "Split a pane horizontally or vertically",
  parameters: Type.Object({
    paneId: Type.String({ description: "Pane ID to split from" }),
    direction: Type.Union([
      Type.Literal("right"),
      Type.Literal("down"),
    ], { description: "Split direction" }),
    noFocus: Type.Optional(Type.Boolean({ description: "Keep focus on current pane (default: true)" })),
  }),
  promptSnippet: "Split a herdr pane",
  async execute(_toolCallId: string, params: any): Promise<any> {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    assertValidId(params.paneId, "paneId");
    const args = ["pane", "split", params.paneId, "--direction", params.direction];
    if (params.noFocus !== false) {
      args.push("--no-focus");
    }
    const output = herdrExec(args);
    const data = parseJson(output);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      details: { split: data },
    };
  },
});

const herdrWaitOutputTool = defineTool({
  name: "herdr_wait_output",
  label: "Herdr Wait Output",
  description: "Wait for specific text to appear in a pane",
  parameters: Type.Object({
    paneId: Type.String({ description: "Pane ID to watch" }),
    match: Type.String({ description: "Text pattern to match" }),
    timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds (default: 30000)" })),
    regex: Type.Optional(Type.Boolean({ description: "Treat match as regex" })),
  }),
  promptSnippet: "Wait for output pattern in a herdr pane",
  async execute(_toolCallId: string, params: any): Promise<any> {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    assertValidId(params.paneId, "paneId");
    const timeout = params.timeout ?? 30000;
    const args = ["wait", "output", params.paneId, "--match", params.match, "--timeout", String(timeout)];
    if (params.regex) {
      args.push("--regex");
    }
    try {
      herdrExec(args);
      return { content: [{ type: "text" as const, text: `Pattern "${params.match}" found in pane ${params.paneId}` }], details: { success: true } };
    } catch {
      return { content: [{ type: "text" as const, text: `Timeout waiting for pattern in pane ${params.paneId}` }], details: { success: false }, isError: true };
    }
  },
});

const herdrWaitAgentTool = defineTool({
  name: "herdr_wait_agent",
  label: "Herdr Wait Agent",
  description: "Wait for an agent in a pane to reach a specific status in the background, without blocking the agent",
  parameters: Type.Object({
    paneId: Type.String({ description: "Pane ID to watch" }),
    status: Type.Union([
      Type.Literal("idle"),
      Type.Literal("working"),
      Type.Literal("blocked"),
      Type.Literal("done"),
    ], { description: "Target agent status" }),
    timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds (default: 60000)" })),
  }),
  promptSnippet: "Wait for agent status in a herdr pane (non-blocking)",
  async execute(_toolCallId: string, params: any): Promise<any> {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    assertValidId(params.paneId, "paneId");
    const timeout = params.timeout ?? 60000;
    
    // Start background wait
    execFile(
      "herdr",
      ["wait", "agent-status", params.paneId, "--status", params.status, "--timeout", String(timeout)],
      (error, stdout, stderr) => {
        if (error) {
          const errorMsg = stderr.trim() || error.message;
          extensionApi?.sendUserMessage(`[herdr_wait_agent] Timeout or failure waiting for agent in pane ${params.paneId} to reach status "${params.status}": ${errorMsg}`);
        } else {
          extensionApi?.sendUserMessage(`[herdr_wait_agent] Agent in pane ${params.paneId} reached status: ${params.status}`);
        }
      }
    );

    return {
      content: [{
        type: "text" as const,
        text: `Started background wait for agent in pane ${params.paneId} to reach status "${params.status}" (timeout: ${timeout}ms). The agent will be notified asynchronously once the status is reached or a timeout occurs.`
      }],
      details: { success: true, status: "pending" }
    };
  },
});

const herdrTabsTool = defineTool({
  name: "herdr_tabs",
  label: "Herdr Tabs",
  description: "List all tabs in a workspace",
  parameters: Type.Object({
    workspaceId: Type.Optional(Type.String({ description: "Workspace ID (default: current)" })),
  }),
  promptSnippet: "List herdr tabs",
  async execute(_toolCallId: string, params: any): Promise<any> {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    const args = ["tab", "list"];
    if (params.workspaceId) {
      args.push("--workspace", assertValidId(params.workspaceId, "workspaceId"));
    }
    const output = herdrExec(args);
    const data = parseJson(output);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], details: { tabs: data } };
  },
});

const herdrSendTool = defineTool({
  name: "herdr_send",
  label: "Herdr Send",
  description: "Send text (no Enter) or raw keys to a herdr pane. Use mode=text for partial input or TUI apps that react to keystrokes; mode=keys for keys like Enter, Escape, Ctrl+C.",
  parameters: Type.Object({
    paneId: Type.String({ description: "Pane ID to send to" }),
    mode: Type.Union([Type.Literal("text"), Type.Literal("keys")], { description: "text = send string without Enter; keys = send raw key names (e.g. Enter, Escape, Ctrl+C)" }),
    text: Type.Optional(Type.String({ description: "Text to send (mode=text)" })),
    keys: Type.Optional(Type.String({ description: "Key names to send, space-separated (mode=keys, e.g. 'Enter' or 'Escape Ctrl+C')" })),
  }),
  promptSnippet: "Send text or keys to a herdr pane (no Enter)",
  async execute(_toolCallId: string, params: any): Promise<any> {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    assertValidId(params.paneId, "paneId");
    if (params.mode === "text") {
      const text = params.text ?? "";
      herdrExec(["pane", "send-text", params.paneId, text]);
      return { content: [{ type: "text" as const, text: `Text sent to pane ${params.paneId} (no Enter)` }], details: { paneId: params.paneId, mode: "text", length: text.length } };
    }
    // mode === "keys" — validate each key token against a safe allowlist.
    const rawKeys = (params.keys ?? "").trim();
    if (!rawKeys) {
      return { content: [{ type: "text" as const, text: "mode=keys requires the keys parameter (e.g. 'Enter' or 'Escape Ctrl+C')" }], details: {}, isError: true };
    }
    const tokens = rawKeys.split(/\s+/);
    for (const k of tokens) {
      if (!/^([A-Za-z0-9]+|[Cc]trl[-+][A-Za-z]|[Aa]lt[-+][A-Za-z]|F[0-9]{1,2})$/.test(k)) {
        return { content: [{ type: "text" as const, text: `Invalid key token: ${JSON.stringify(k)}. Use names like Enter, Escape, Tab, Backspace, Ctrl+C, Alt+F4, F1-F12.` }], details: {}, isError: true };
      }
    }
    herdrExec(["pane", "send-keys", params.paneId, ...tokens]);
    return { content: [{ type: "text" as const, text: `Keys sent to pane ${params.paneId}: ${tokens.join(" ")}` }], details: { paneId: params.paneId, mode: "keys", keys: tokens } };
  },
});

const herdrPaneCloseTool = defineTool({
  name: "herdr_pane_close",
  label: "Herdr Pane Close",
  description: "Close a herdr pane by ID",
  parameters: Type.Object({
    paneId: Type.String({ description: "Pane ID to close" }),
  }),
  promptSnippet: "Close a herdr pane",
  async execute(_toolCallId: string, params: any): Promise<any> {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    assertValidId(params.paneId, "paneId");
    try {
      herdrExec(["pane", "close", params.paneId]);
      return { content: [{ type: "text" as const, text: `Closed pane ${params.paneId}` }], details: { paneId: params.paneId, closed: true } };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Failed to close pane ${params.paneId}: ${e}` }], details: { paneId: params.paneId, closed: false }, isError: true };
    }
  },
});

const herdrWorkspacesTool = defineTool({
  name: "herdr_workspaces",
  label: "Herdr Workspaces",
  description: "List all herdr workspaces",
  parameters: Type.Object({}),
  promptSnippet: "List herdr workspaces",
  async execute(): Promise<any> {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    const output = herdrExec(["workspace", "list"]);
    const data = parseJson(output);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], details: { workspaces: data } };
  },
});

const herdrWorkspaceCreateTool = defineTool({
  name: "herdr_workspace_create",
  label: "Herdr Workspace Create",
  description: "Create a new herdr workspace",
  parameters: Type.Object({
    cwd: Type.Optional(Type.String({ description: "Initial working directory for the workspace" })),
    label: Type.Optional(Type.String({ description: "Human-readable label for the workspace" })),
    env: Type.Optional(Type.Union([
      Type.String({ description: "Environment variable (e.g. 'KEY=VALUE')" }),
      Type.Array(Type.String({ description: "Environment variables (e.g. ['KEY1=VALUE1', 'KEY2=VALUE2'])" })),
    ], { description: "Environment variables for the workspace (--env KEY=VALUE, repeatable)" })),
    noFocus: Type.Optional(Type.Boolean({ description: "Keep focus on current workspace (default: true)" })),
  }),
  promptSnippet: "Create a herdr workspace",
  async execute(_toolCallId: string, params: any): Promise<any> {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    const args = ["workspace", "create"];
    if (params.cwd) {
      args.push("--cwd", params.cwd);
    }
    if (params.label) {
      args.push("--label", params.label);
    }
    if (params.env) {
      const envVars = Array.isArray(params.env) ? params.env : [params.env];
      for (const e of envVars) {
        args.push("--env", e);
      }
    }
    if (params.noFocus === false) {
      args.push("--focus");
    } else {
      args.push("--no-focus");
    }
    try {
      const output = herdrExec(args);
      const data = parseJson(output);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], details: { workspace: data } };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Failed to create workspace: ${e}` }], details: {}, isError: true };
    }
  },
});

const herdrWorkspaceGetTool = defineTool({
  name: "herdr_workspace_get",
  label: "Herdr Workspace Get",
  description: "Get detailed information about a herdr workspace by ID",
  parameters: Type.Object({
    workspaceId: Type.String({ description: "Workspace ID to query" }),
  }),
  promptSnippet: "Get herdr workspace details",
  async execute(_toolCallId: string, params: any): Promise<any> {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    assertValidId(params.workspaceId, "workspaceId");
    try {
      const output = herdrExec(["workspace", "get", params.workspaceId]);
      const data = parseJson(output);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], details: { workspace: data } };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Failed to get workspace info: ${e}` }], details: {}, isError: true };
    }
  },
});

const herdrWorkspaceFocusTool = defineTool({
  name: "herdr_workspace_focus",
  label: "Herdr Workspace Focus",
  description: "Focus a herdr workspace by ID",
  parameters: Type.Object({
    workspaceId: Type.String({ description: "Workspace ID to focus" }),
  }),
  promptSnippet: "Focus a herdr workspace",
  async execute(_toolCallId: string, params: any): Promise<any> {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    assertValidId(params.workspaceId, "workspaceId");
    try {
      herdrExec(["workspace", "focus", params.workspaceId]);
      return { content: [{ type: "text" as const, text: `Focused workspace ${params.workspaceId}` }], details: { workspaceId: params.workspaceId, focused: true } };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Failed to focus workspace ${params.workspaceId}: ${e}` }], details: { workspaceId: params.workspaceId, focused: false }, isError: true };
    }
  },
});

const herdrWorkspaceRenameTool = defineTool({
  name: "herdr_workspace_rename",
  label: "Herdr Workspace Rename",
  description: "Rename a herdr workspace",
  parameters: Type.Object({
    workspaceId: Type.String({ description: "Workspace ID to rename" }),
    label: Type.String({ description: "New label for the workspace" }),
  }),
  promptSnippet: "Rename a herdr workspace",
  async execute(_toolCallId: string, params: any): Promise<any> {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    assertValidId(params.workspaceId, "workspaceId");
    try {
      herdrExec(["workspace", "rename", params.workspaceId, params.label]);
      return { content: [{ type: "text" as const, text: `Renamed workspace ${params.workspaceId} to "${params.label}"` }], details: { workspaceId: params.workspaceId, renamed: true, label: params.label } };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Failed to rename workspace ${params.workspaceId}: ${e}` }], details: { workspaceId: params.workspaceId, renamed: false }, isError: true };
    }
  },
});

const herdrWorkspaceCloseTool = defineTool({
  name: "herdr_workspace_close",
  label: "Herdr Workspace Close",
  description: "Close a herdr workspace by ID",
  parameters: Type.Object({
    workspaceId: Type.String({ description: "Workspace ID to close" }),
  }),
  promptSnippet: "Close a herdr workspace",
  async execute(_toolCallId: string, params: any): Promise<any> {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    assertValidId(params.workspaceId, "workspaceId");
    try {
      herdrExec(["workspace", "close", params.workspaceId]);
      return { content: [{ type: "text" as const, text: `Closed workspace ${params.workspaceId}` }], details: { workspaceId: params.workspaceId, closed: true } };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Failed to close workspace ${params.workspaceId}: ${e}` }], details: { workspaceId: params.workspaceId, closed: false }, isError: true };
    }
  },
});

const herdrTabCreateTool = defineTool({
  name: "herdr_tab_create",
  label: "Herdr Tab Create",
  description: "Create a new tab in a workspace",
  parameters: Type.Object({
    workspaceId: Type.Optional(Type.String({ description: "Workspace ID to create the tab in (default: current)" })),
    cwd: Type.Optional(Type.String({ description: "Initial working directory for the tab" })),
    label: Type.Optional(Type.String({ description: "Human-readable label for the tab" })),
    env: Type.Optional(Type.Union([
      Type.String({ description: "Environment variable (e.g. 'KEY=VALUE')" }),
      Type.Array(Type.String({ description: "Environment variables (e.g. ['KEY1=VALUE1', 'KEY2=VALUE2'])" })),
    ], { description: "Environment variables for the tab (--env KEY=VALUE, repeatable)" })),
    noFocus: Type.Optional(Type.Boolean({ description: "Keep focus on current tab (default: true)" })),
  }),
  promptSnippet: "Create a herdr tab",
  async execute(_toolCallId: string, params: any): Promise<any> {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    const args = ["tab", "create"];
    if (params.workspaceId) {
      args.push("--workspace", assertValidId(params.workspaceId, "workspaceId"));
    }
    if (params.cwd) {
      args.push("--cwd", params.cwd);
    }
    if (params.label) {
      args.push("--label", params.label);
    }
    if (params.env) {
      const envVars = Array.isArray(params.env) ? params.env : [params.env];
      for (const e of envVars) {
        args.push("--env", e);
      }
    }
    if (params.noFocus === false) {
      args.push("--focus");
    } else {
      args.push("--no-focus");
    }
    try {
      const output = herdrExec(args);
      const data = parseJson(output);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], details: { tab: data } };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Failed to create tab: ${e}` }], details: {}, isError: true };
    }
  },
});

const herdrTabGetTool = defineTool({
  name: "herdr_tab_get",
  label: "Herdr Tab Get",
  description: "Get detailed information about a herdr tab by ID",
  parameters: Type.Object({
    tabId: Type.String({ description: "Tab ID to query" }),
  }),
  promptSnippet: "Get herdr tab details",
  async execute(_toolCallId: string, params: any): Promise<any> {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    assertValidId(params.tabId, "tabId");
    try {
      const output = herdrExec(["tab", "get", params.tabId]);
      const data = parseJson(output);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], details: { tab: data } };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Failed to get tab info: ${e}` }], details: {}, isError: true };
    }
  },
});

const herdrTabFocusTool = defineTool({
  name: "herdr_tab_focus",
  label: "Herdr Tab Focus",
  description: "Focus a herdr tab by ID",
  parameters: Type.Object({
    tabId: Type.String({ description: "Tab ID to focus" }),
  }),
  promptSnippet: "Focus a herdr tab",
  async execute(_toolCallId: string, params: any): Promise<any> {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    assertValidId(params.tabId, "tabId");
    try {
      herdrExec(["tab", "focus", params.tabId]);
      return { content: [{ type: "text" as const, text: `Focused tab ${params.tabId}` }], details: { tabId: params.tabId, focused: true } };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Failed to focus tab ${params.tabId}: ${e}` }], details: { tabId: params.tabId, focused: false }, isError: true };
    }
  },
});

const herdrTabRenameTool = defineTool({
  name: "herdr_tab_rename",
  label: "Herdr Tab Rename",
  description: "Rename a herdr tab",
  parameters: Type.Object({
    tabId: Type.String({ description: "Tab ID to rename" }),
    label: Type.String({ description: "New label for the tab" }),
  }),
  promptSnippet: "Rename a herdr tab",
  async execute(_toolCallId: string, params: any): Promise<any> {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    assertValidId(params.tabId, "tabId");
    try {
      herdrExec(["tab", "rename", params.tabId, params.label]);
      return { content: [{ type: "text" as const, text: `Renamed tab ${params.tabId} to "${params.label}"` }], details: { tabId: params.tabId, renamed: true, label: params.label } };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Failed to rename tab ${params.tabId}: ${e}` }], details: { tabId: params.tabId, renamed: false }, isError: true };
    }
  },
});

const herdrTabCloseTool = defineTool({
  name: "herdr_tab_close",
  label: "Herdr Tab Close",
  description: "Close a herdr tab by ID",
  parameters: Type.Object({
    tabId: Type.String({ description: "Tab ID to close" }),
  }),
  promptSnippet: "Close a herdr tab",
  async execute(_toolCallId: string, params: any): Promise<any> {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    assertValidId(params.tabId, "tabId");
    try {
      herdrExec(["tab", "close", params.tabId]);
      return { content: [{ type: "text" as const, text: `Closed tab ${params.tabId}` }], details: { tabId: params.tabId, closed: true } };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Failed to close tab ${params.tabId}: ${e}` }], details: { tabId: params.tabId, closed: false }, isError: true };
    }
  },
});

// ============================================================================
// Extension
// ============================================================================

export default function (pi: ExtensionAPI) {
  extensionApi = pi;
  let currentPaneInfo: { paneId: string; workspace: string; tab: string } | null = null;

  // Intercept raw `herdr <cmd>` invocations made through the bash tool and
  // steer the agent to the corresponding herdr_* extension tool instead.
  pi.on("tool_call", async (event: any, ctx: any) => {
    if (!isToolCallEventType("bash", event)) return;
    const cmd = event.input?.command;
    if (typeof cmd !== "string" || cmd.length === 0) return;
    const detected = detectHerdrCli(cmd);
    if (!detected) return;
    ctx.ui.notify(`herdr CLI blocked — use the extension tool (${detected.tool}); ${detected.hint}.`, "error");
    return {
      block: true,
      reason: `Do not call the raw herdr CLI via bash. Use the pi-herdr extension tool instead: ${detected.tool}. ${detected.hint}. Discover current pane IDs first with herdr_panes. If you need a herdr_* capability that is not provided, call the closest available tool or ask the user.`,
    };
  });

  // Detect current pane on session start
  pi.on("session_start", async (_event: any, ctx: any) => {
    if (!herdrAvailable()) {
      ctx.ui.setStatus("herdr", "herdr: not available");
      return;
    }

    try {
      const panesOutput = herdrExec(["pane", "list"]);
      const parsed = parseJson(panesOutput) as {
        result?: { panes?: Array<{ pane_id: string; focused: boolean; workspace_id: string; tab_id: string }> };
      };
      const focused = parsed.result?.panes?.find((p) => p.focused);
      if (focused) {
        currentPaneInfo = {
          paneId: focused.pane_id,
          workspace: focused.workspace_id,
          tab: focused.tab_id,
        };
        ctx.ui.setStatus("herdr", `herdr: ${focused.workspace_id}:${focused.tab_id}:${focused.pane_id}`);
      } else {
        ctx.ui.setStatus("herdr", "herdr: active");
      }
    } catch {
      ctx.ui.setStatus("herdr", "herdr: active");
    }
  });

  // Register tools
  pi.registerTool(herdrPanesTool);
  pi.registerTool(herdrReadTool);
  pi.registerTool(herdrRunTool);
  pi.registerTool(herdrSplitTool);
  pi.registerTool(herdrSendTool);
  pi.registerTool(herdrPaneCloseTool);
  pi.registerTool(herdrWaitOutputTool);
  pi.registerTool(herdrWaitAgentTool);
  pi.registerTool(herdrTabsTool);
  pi.registerTool(herdrWorkspacesTool);
  pi.registerTool(herdrWorkspaceCreateTool);
  pi.registerTool(herdrWorkspaceGetTool);
  pi.registerTool(herdrWorkspaceFocusTool);
  pi.registerTool(herdrWorkspaceRenameTool);
  pi.registerTool(herdrWorkspaceCloseTool);
  pi.registerTool(herdrTabCreateTool);
  pi.registerTool(herdrTabGetTool);
  pi.registerTool(herdrTabFocusTool);
  pi.registerTool(herdrTabRenameTool);
  pi.registerTool(herdrTabCloseTool);

  // Register commands
  pi.registerCommand("herdr", {
    description: "Herdr management: status, panes, tabs, workspaces, read, split",
    handler: async (args: string, ctx: any) => {
      if (!herdrAvailable()) {
        ctx.ui.notify("herdr not available (HERDR_ENV != 1 or herdr not in PATH)", "error");
        return;
      }

      const [subcommand, ...rest] = args.trim().split(/\s+/);
      const arg = rest.join(" ");

      switch (subcommand) {
        case "status":
          if (currentPaneInfo) {
            ctx.ui.notify(`Workspace: ${currentPaneInfo.workspace}, Tab: ${currentPaneInfo.tab}, Pane: ${currentPaneInfo.paneId}`, "info");
          } else {
            ctx.ui.notify("Herdr active but pane info not detected", "info");
          }
          break;

        case "panes":
        case "pane": {
          try {
            const output = herdrExec(["pane", "list"]);
            const data = parseJson(output) as {
              result?: { panes?: Array<{ pane_id: string; focused: boolean; agent?: string; agent_status?: string }> };
            };
            const lines = data.result?.panes?.map((p) => {
              const focus = p.focused ? " \u25cf" : "";
              const agent = p.agent ? ` [${p.agent}]` : "";
              const status = p.agent_status ? ` (${p.agent_status})` : "";
              return `  ${p.pane_id}${focus}${agent}${status}`;
            }) ?? ["  No panes found"];
            ctx.ui.notify("Panes:\n" + lines.join("\n"), "info");
          } catch (e) {
            ctx.ui.notify(`Error: ${e}`, "error");
          }
          break;
        }

        case "tabs":
        case "tab": {
          const [action, ...actionArgs] = rest;
          if (!action || action === "list" || action.startsWith("-")) {
            try {
              const args = ["tab", "list"];
              if (action) {
                args.push(action, ...actionArgs);
              }
              const output = herdrExec(args);
              ctx.ui.notify(JSON.stringify(parseJson(output), null, 2), "info");
            } catch (e) {
              ctx.ui.notify(`Error: ${e}`, "error");
            }
          } else if (action === "create" || action === "get" || action === "focus" || action === "rename" || action === "close") {
            try {
              const output = herdrExec(["tab", action, ...actionArgs]);
              ctx.ui.notify(output.trim() ? JSON.stringify(parseJson(output), null, 2) : `Tab action "${action}" completed`, "info");
            } catch (e) {
              ctx.ui.notify(`Error: ${e}`, "error");
            }
          } else {
            ctx.ui.notify(`Unknown tab action: ${action}. Supported: list, create, get, focus, rename, close`, "error");
          }
          break;
        }

        case "workspaces":
        case "workspace": {
          const [action, ...actionArgs] = rest;
          if (!action || action === "list") {
            try {
              const output = herdrExec(["workspace", "list"]);
              ctx.ui.notify(JSON.stringify(parseJson(output), null, 2), "info");
            } catch (e) {
              ctx.ui.notify(`Error: ${e}`, "error");
            }
          } else if (action === "create" || action === "get" || action === "focus" || action === "rename" || action === "close") {
            try {
              const output = herdrExec(["workspace", action, ...actionArgs]);
              ctx.ui.notify(output.trim() ? JSON.stringify(parseJson(output), null, 2) : `Workspace action "${action}" completed`, "info");
            } catch (e) {
              ctx.ui.notify(`Error: ${e}`, "error");
            }
          } else {
            ctx.ui.notify(`Unknown workspace action: ${action}. Supported: list, create, get, focus, rename, close`, "error");
          }
          break;
        }

        case "read":
          if (!arg) {
            ctx.ui.notify("Usage: /herdr read <pane-id> [lines]", "error");
            return;
          }
          try {
            const [paneId, lines] = arg.split(/\s+/).filter(Boolean);
            if (!paneId) {
              ctx.ui.notify("Usage: /herdr read <pane-id> [lines]", "error");
              return;
            }
            const output = herdrExec(["pane", "read", paneId, "--source", "recent", "--lines", lines ?? "50"]);
            ctx.ui.notify(output, "info");
          } catch (e) {
            ctx.ui.notify(`Error: ${e}`, "error");
          }
          break;

        case "split":
          try {
            const direction = arg || "right";
            const myPaneId = currentPaneInfo?.paneId;
            if (!myPaneId) {
              ctx.ui.notify("Could not detect current pane", "error");
              return;
            }
            const output = herdrExec(["pane", "split", myPaneId, "--direction", direction, "--no-focus"]);
            const data = parseJson(output) as { result?: { pane?: { pane_id: string } } };
            const newPaneId = data.result?.pane?.pane_id;
            ctx.ui.notify(`Split ${direction}. New pane: ${newPaneId ?? "unknown"}`, "info");
          } catch (e) {
            ctx.ui.notify(`Error: ${e}`, "error");
          }
          break;

        default:
          ctx.ui.notify("Usage: /herdr [status|panes|tabs|workspaces|read|split]", "info");
      }
    },
  });
}
