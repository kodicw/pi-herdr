/**
 * pi-herdr extension — Herdr integration for pi coding agent
 *
 * Provides tools for managing herdr workspaces, tabs, and panes,
 * plus commands and a status widget showing current pane info.
 *
 * Requires herdr CLI in PATH and HERDR_ENV=1 for full functionality.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execSync } from "node:child_process";

// ============================================================================
// Helpers
// ============================================================================

function herdrAvailable(): boolean {
  try {
    execSync("which herdr", { stdio: "ignore" });
    return process.env.HERDR_ENV === "1";
  } catch {
    return false;
  }
}

function herdrExec(args: string): string {
  return execSync(`herdr ${args}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
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

// ============================================================================
// Tool Definitions
// ============================================================================

const herdrPanesTool = defineTool({
  name: "herdr_panes",
  label: "Herdr Panes",
  description: "List all panes in the current workspace with their status",
  parameters: Type.Object({}),
  promptSnippet: "List herdr panes with agent status",
  async execute() {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available (HERDR_ENV != 1 or herdr not in PATH)" }], details: {} };
    }
    const output = herdrExec("pane list");
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
  async execute(_toolCallId, params) {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    assertValidId(params.paneId, "paneId");
    const lines = params.lines ?? 50;
    const source = params.source ?? "recent";
    const output = herdrExec(`pane read ${params.paneId} --source ${source} --lines ${lines}`);
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
  async execute(_toolCallId, params) {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    assertValidId(params.paneId, "paneId");
    herdrExec(`pane run ${params.paneId} ${JSON.stringify(params.command)}`);
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
  async execute(_toolCallId, params) {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    assertValidId(params.paneId, "paneId");
    const noFocusFlag = params.noFocus !== false ? "--no-focus" : "";
    const output = herdrExec(`pane split ${params.paneId} --direction ${params.direction} ${noFocusFlag}`);
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
  async execute(_toolCallId, params) {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    assertValidId(params.paneId, "paneId");
    const timeout = params.timeout ?? 30000;
    const regexFlag = params.regex ? "--regex" : "";
    try {
      herdrExec(`wait output ${params.paneId} --match ${JSON.stringify(params.match)} --timeout ${timeout} ${regexFlag}`);
      return { content: [{ type: "text" as const, text: `Pattern "${params.match}" found in pane ${params.paneId}` }], details: { success: true } };
    } catch {
      return { content: [{ type: "text" as const, text: `Timeout waiting for pattern in pane ${params.paneId}` }], details: { success: false }, isError: true };
    }
  },
});

const herdrWaitAgentTool = defineTool({
  name: "herdr_wait_agent",
  label: "Herdr Wait Agent",
  description: "Wait for an agent in a pane to reach a specific status",
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
  promptSnippet: "Wait for agent status in a herdr pane",
  async execute(_toolCallId, params) {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    assertValidId(params.paneId, "paneId");
    const timeout = params.timeout ?? 60000;
    try {
      herdrExec(`wait agent-status ${params.paneId} --status ${params.status} --timeout ${timeout}`);
      return { content: [{ type: "text" as const, text: `Agent in pane ${params.paneId} reached status: ${params.status}` }], details: { success: true } };
    } catch {
      return { content: [{ type: "text" as const, text: `Timeout waiting for agent status in pane ${params.paneId}` }], details: { success: false }, isError: true };
    }
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
  async execute(_toolCallId, params) {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    const wsFlag = params.workspaceId ? `--workspace ${assertValidId(params.workspaceId, "workspaceId")}` : "";
    const output = herdrExec(`tab list ${wsFlag}`);
    const data = parseJson(output);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], details: { tabs: data } };
  },
});

const herdrWorkspacesTool = defineTool({
  name: "herdr_workspaces",
  label: "Herdr Workspaces",
  description: "List all herdr workspaces",
  parameters: Type.Object({}),
  promptSnippet: "List herdr workspaces",
  async execute() {
    if (!herdrAvailable()) {
      return { content: [{ type: "text" as const, text: "herdr not available" }], details: {} };
    }
    const output = herdrExec("workspace list");
    const data = parseJson(output);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], details: { workspaces: data } };
  },
});

// ============================================================================
// Extension
// ============================================================================

export default function (pi: ExtensionAPI) {
  let currentPaneInfo: { paneId: string; workspace: string; tab: string } | null = null;

  // Detect current pane on session start
  pi.on("session_start", async (_event, ctx) => {
    if (!herdrAvailable()) {
      ctx.ui.setStatus("herdr", "herdr: not available");
      return;
    }

    try {
      const panesOutput = herdrExec("pane list");
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
  pi.registerTool(herdrWaitOutputTool);
  pi.registerTool(herdrWaitAgentTool);
  pi.registerTool(herdrTabsTool);
  pi.registerTool(herdrWorkspacesTool);

  // Register commands
  pi.registerCommand("herdr", {
    description: "Herdr management: status, panes, tabs, workspaces, read, split",
    handler: async (args, ctx) => {
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
            const output = herdrExec("pane list");
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
        case "tab":
          try {
            const output = herdrExec(`tab list ${arg}`);
            ctx.ui.notify(JSON.stringify(parseJson(output), null, 2), "info");
          } catch (e) {
            ctx.ui.notify(`Error: ${e}`, "error");
          }
          break;

        case "workspaces":
        case "workspace":
          try {
            const output = herdrExec("workspace list");
            ctx.ui.notify(JSON.stringify(parseJson(output), null, 2), "info");
          } catch (e) {
            ctx.ui.notify(`Error: ${e}`, "error");
          }
          break;

        case "read":
          if (!arg) {
            ctx.ui.notify("Usage: /herdr read <pane-id> [lines]", "error");
            return;
          }
          try {
            const [paneId, lines] = arg.split(/\s+/);
            const output = herdrExec(`pane read ${paneId} --source recent --lines ${lines ?? "50"}`);
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
            const output = herdrExec(`pane split ${myPaneId} --direction ${direction} --no-focus`);
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
