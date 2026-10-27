// terminal-notify: a Cline plugin that raises a desktop notification through
// the terminal Cline runs in. It writes an escape sequence (OSC 777, 9 or 99,
// or a bell, picked for the terminal) to the controlling terminal, so no
// network and no dependencies.
//
// Made by the team behind Agent Terminal: https://4nuva.dev/agent-terminal/
//
// A notification must never get in the way of a session: every hook catches
// its own errors (an error thrown from beforeTool fails the tool call).
import fs from "node:fs";

const ESC = "\x1b";
const BEL = "\x07";
const ST = ESC + "\\";

const FORMATS = ["auto", "osc777", "osc9", "osc99", "all", "bell", "off"];

// Known key and token shapes, masked before any text leaves the session:
// a notification can land on a lock screen or a paired phone.
const SECRETS = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{12,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@\/]+:[^\s@\/]+@/gi, // credentials in a URL
  /\bBearer\s+[A-Za-z0-9._~+\/=-]{8,}/gi,
  /\b(api[_-]?key|token|secret|password|passwd|pwd|authorization)(\s*[=:]\s*)\S+/gi,
  /\b[A-Za-z0-9+\/_-]{40,}={0,2}/g,
];

export function mask(s) {
  for (const re of SECRETS) {
    s = s.replace(re, (m, key, sep) =>
      typeof key === "string" && typeof sep === "string" ? `${key}${sep}***` : "***");
  }
  return s;
}

// One line of plain text: no control characters (C0, DEL, C1), so nothing in
// it can end the escape sequence early or start another one.
export function clean(s) {
  s = String(s == null ? "" : s)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  return mask(s).replace(/\s+/g, " ").trim();
}

function cap(s, n) {
  const chars = Array.from(s);
  return chars.length <= n ? s : chars.slice(0, n - 1).join("") + "…";
}

// The first sentences of a reply, without code blocks or inline code.
export function firstSentences(text, count) {
  let t = String(text || "")
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/^#+\s+/gm, "")
    .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, "$1");
  t = clean(t);
  if (!t) return "";
  const parts = t.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [t];
  return parts.slice(0, count).join(" ").trim();
}

// A setting as an environment variable: `TERMINAL_NOTIFY_<KEY>`.
function option(env, key, fallback) {
  const v = env[`TERMINAL_NOTIFY_${key.toUpperCase()}`];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : fallback;
}

function flag(env, key, fallback) {
  const v = option(env, key, "");
  if (!v) return fallback;
  return !/^(0|false|no|off)$/i.test(v);
}

// Which sequence the terminal shows as a notification.
export function detectFormat(env) {
  const program = String(env.TERM_PROGRAM || "").toLowerCase();
  const term = String(env.TERM || "").toLowerCase();
  // Agent Terminal shows OSC 777 with its title and body, and forwards it to
  // the phones paired with it.
  if (env.AGENT_TERMINAL_SESSION_ID) return "osc777";
  if (env.KITTY_WINDOW_ID || term === "xterm-kitty") return "osc99";
  if (program === "ghostty" || env.GHOSTTY_RESOURCES_DIR || program === "warpterminal" || term.includes("rxvt")) {
    return "osc777";
  }
  if (program === "iterm.app" || program === "wezterm" || env.WT_SESSION || env.ConEmuPID) return "osc9";
  // Terminals with no notification sequence: the bell at least gets a look.
  if (program === "apple_terminal" || program === "vscode") return "bell";
  return "osc9";
}

export function sequence(format, title, body) {
  switch (format) {
    case "osc777":
      // `;` separates the fields, so neither part may hold one.
      return `${ESC}]777;notify;${title.replace(/;/g, ",")};${body.replace(/;/g, ",")}${BEL}`;
    case "osc9": {
      // A body that starts with a number reads as a ConEmu command (`9;4`
      // progress, ...), not as a notification.
      let text = `${title}: ${body}`;
      if (/^[\s᠎​]*[+-]?\p{Nd}/u.test(text)) text = `· ${text}`;
      return `${ESC}]9;${text}${BEL}`;
    }
    case "osc99":
      return `${ESC}]99;;${`${title}: ${body}`.replace(/;/g, ",")}${ST}`;
    case "all":
      // Every notification sequence, for a terminal the detection does not
      // know. A terminal that reads more than one shows more than one. 777
      // goes last: Agent Terminal keeps the last notice of a burst, and 777
      // is the one that carries the title.
      return ["osc9", "osc99", "osc777"].map((f) => sequence(f, title, body)).join("");
    case "bell":
      return BEL;
    default:
      return null;
  }
}

function titleFor(cwd) {
  // Either separator, whatever the platform the plugin runs on.
  const folder = String(cwd || "").split(/[\\/]+/).filter(Boolean).pop() || "Cline";
  return cap(clean(`Cline · ${folder}`), 80);
}

// The notification for a run that ended, or null when it raises none. A
// subagent's runs fire the same hooks: only the main agent's asks for the
// person. A run the person stopped, or that failed, raises nothing.
export function buildDone({ parentAgentId, status, outputText }, cwd, env) {
  if (parentAgentId || status !== "completed") return null;
  const ctx = flag(env, "details", true) ? firstSentences(outputText, 2) : "";
  return { title: titleFor(cwd), body: cap(clean("Task complete" + (ctx ? `: ${ctx}` : "")), 200) };
}

// The notification for a tool call that starts, or null: only `ask_question` is one.
export function buildQuestion({ parentAgentId, toolName, input }, cwd, env) {
  if (parentAgentId || toolName !== "ask_question") return null;
  const q = flag(env, "details", true) ? clean(input && input.question) : "";
  return { title: titleFor(cwd), body: cap(clean("Question" + (q ? `: ${q}` : " waiting")), 200) };
}

// The part of a tool call worth naming: its command, file, URL, ... Cline's
// tools take lists (`commands`, `files`), so the first entry stands for them.
const SUMMARY_KEYS = ["commands", "path", "paths", "files", "url", "urls", "requests", "command", "pattern", "query", "input"];

function firstString(v, depth = 0) {
  if (typeof v === "string") return v;
  if (depth > 3 || !v || typeof v !== "object") return "";
  if (Array.isArray(v)) return firstString(v[0], depth + 1);
  for (const k of SUMMARY_KEYS) {
    const s = firstString(v[k], depth + 1);
    if (s) return s;
  }
  for (const x of Object.values(v)) {
    const s = firstString(x, depth + 1);
    if (s) return s;
  }
  return "";
}

// The notification for a tool call that waits for the person's approval.
export function buildPermission({ parentAgentId, toolName, input }, cwd, env) {
  if (parentAgentId || !toolName || toolName === "ask_question") return null;
  const sum = flag(env, "details", true) ? cap(clean(firstString(input)), 80) : "";
  const body = `Permission needed: ${clean(toolName) || "a tool"}` + (sum ? ` — ${sum}` : "");
  return { title: titleFor(cwd), body: cap(clean(body), 200) };
}

export function render(n, env) {
  let format = option(env, "format", "auto").toLowerCase();
  if (!FORMATS.includes(format)) format = "auto";
  if (format === "off" || !n) return null;
  if (format === "auto") format = detectFormat(env);
  return sequence(format, n.title, n.body);
}

// The sequence goes to the controlling terminal itself: Cline's stdout
// carries its own display, and the plugin runs in a worker thread.
function writeTerminal(seq) {
  let fd;
  try {
    fd = fs.openSync(process.platform === "win32" ? "CONOUT$" : "/dev/tty", "w");
    fs.writeSync(fd, seq);
  } catch {
    // No terminal (CI, a pipe): nothing to show.
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ }
  }
}

function notify(n, env) {
  const seq = render(n, env);
  if (seq) writeTerminal(seq);
}

let cwd = "";

// Cline has no hook for an approval prompt. A tool call the model has issued
// starts (`tool-started`) as soon as it is approved, so one that has not
// started a few seconds after it was issued, or after the call before it
// finished, is waiting for the person. The wait is longer than a plugin hook's
// 3 second limit, so a slow hook is not mistaken for a prompt.
const APPROVAL_WAIT_MS = 4000;
let issued = []; // tool calls of the turn that have not finished, in order
let waiting = null;

function stopWaiting() {
  if (waiting) clearTimeout(waiting);
  waiting = null;
}

function watchNextCall(parentAgentId) {
  stopWaiting();
  const next = issued.find((c) => !c.started);
  if (!next) return;
  waiting = setTimeout(() => {
    waiting = null;
    try {
      notify(buildPermission({ parentAgentId, toolName: next.toolName, input: next.input }, cwd, process.env), process.env);
    } catch {
      // Nothing to show.
    }
  }, APPROVAL_WAIT_MS);
  // The timer must not keep a worker alive that has nothing else to do.
  if (waiting.unref) waiting.unref();
}

function onEvent(event) {
  if (!event) return;
  const parentAgentId = event.snapshot && event.snapshot.parentAgentId;
  switch (event.type) {
    case "assistant-message": {
      const parts = event.message && Array.isArray(event.message.content) ? event.message.content : [];
      issued = parts.filter((p) => p && p.type === "tool-call").map((p) => ({ id: p.toolCallId, toolName: p.toolName, input: p.input, started: false }));
      watchNextCall(parentAgentId);
      break;
    }
    case "tool-started": {
      const call = event.toolCall || {};
      const known = issued.find((c) => c.id === call.toolCallId);
      if (known) known.started = true;
      stopWaiting();
      notify(buildQuestion({ parentAgentId, toolName: call.toolName, input: call.input }, cwd, process.env), process.env);
      break;
    }
    case "tool-finished": {
      const id = event.toolCall && event.toolCall.toolCallId;
      issued = issued.filter((c) => c.id !== id);
      watchNextCall(parentAgentId);
      break;
    }
    case "run-finished":
    case "run-failed":
      issued = [];
      stopWaiting();
      break;
  }
}

const plugin = {
  name: "terminal-notify",
  manifest: { capabilities: ["hooks"] },
  setup(_api, ctx) {
    cwd = (ctx && ctx.workspaceInfo && ctx.workspaceInfo.rootPath) || process.cwd();
  },
  hooks: {
    afterRun(context) {
      try {
        const r = context.result || {};
        notify(buildDone({
          parentAgentId: context.snapshot && context.snapshot.parentAgentId,
          status: r.status,
          outputText: r.outputText,
        }, cwd, process.env), process.env);
      } catch {
        // Nothing to show.
      }
    },
    // `beforeTool` gets the tool object, which Cline cannot pass to a plugin
    // without a warning on every call, so the tool calls come from events,
    // which carry the same calls as plain data.
    onEvent(event) {
      try {
        onEvent(event);
      } catch {
        // Nothing to show.
      }
    },
  },
};

export default plugin;
