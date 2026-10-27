import test from "node:test";
import assert from "node:assert";
import plugin, { buildDone, buildPermission, buildQuestion, detectFormat, mask, render, sequence } from "../plugin.js";

const done = { status: "completed", outputText: "Fixed the bug. Tests pass. More text." };

test("a finished run names the folder and the start of the reply", () => {
  assert.deepStrictEqual(buildDone(done, "/work/my-app", {}), {
    title: "Cline · my-app",
    body: "Task complete: Fixed the bug. Tests pass.",
  });
  assert.strictEqual(buildDone(done, "C:\\src\\app\\", {}).title, "Cline · app");
});

test("subagents, stopped runs and failed runs stay quiet", () => {
  assert.strictEqual(buildDone({ ...done, parentAgentId: "a1" }, "/w", {}), null);
  assert.strictEqual(buildDone({ ...done, status: "aborted" }, "/w", {}), null);
  assert.strictEqual(buildDone({ ...done, status: "failed" }, "/w", {}), null);
});

test("only ask_question is a question", () => {
  const q = buildQuestion({ toolName: "ask_question", input: { question: "Which one?", options: ["a", "b"] } }, "/w/app", {});
  assert.deepStrictEqual(q, { title: "Cline · app", body: "Question: Which one?" });
  assert.strictEqual(buildQuestion({ toolName: "ask_question", input: {} }, "/w", {}).body, "Question waiting");
  assert.strictEqual(buildQuestion({ toolName: "run_commands", input: { command: "ls" } }, "/w", {}), null);
  assert.strictEqual(buildQuestion({ parentAgentId: "a1", toolName: "ask_question", input: {} }, "/w", {}), null);
});

test("a tool call waiting for approval names the tool and what it does", () => {
  const p = (toolName, input, extra = {}) => buildPermission({ toolName, input, ...extra }, "/w/app", {});
  assert.deepStrictEqual(p("run_commands", { commands: ["npm test", "ls"] }), { title: "Cline · app", body: "Permission needed: run_commands — npm test" });
  assert.strictEqual(p("read_files", { files: [{ path: "/w/app/a.ts" }] }).body, "Permission needed: read_files — /w/app/a.ts");
  assert.strictEqual(p("editor", { path: "/w/app/b.ts", command: "create" }).body, "Permission needed: editor — /w/app/b.ts");
  assert.strictEqual(p("skills", {}).body, "Permission needed: skills");
  assert.strictEqual(p("ask_question", { question: "?" }), null);
  assert.strictEqual(p("run_commands", {}, { parentAgentId: "a1" }), null);
});

test("details off shows the event alone", () => {
  const env = { TERMINAL_NOTIFY_DETAILS: "false" };
  assert.strictEqual(buildDone(done, "/w", env).body, "Task complete");
  assert.strictEqual(buildQuestion({ toolName: "ask_question", input: { question: "Secret?" } }, "/w", env).body, "Question waiting");
  assert.strictEqual(buildPermission({ toolName: "run_commands", input: { commands: ["rm -rf x"] } }, "/w", env).body, "Permission needed: run_commands");
});

test("secrets are masked", () => {
  assert.strictEqual(mask("key sk-abcdefghijkl here"), "key *** here");
  assert.strictEqual(mask("token=hunter2abc"), "token=***");
  assert.strictEqual(mask("https://user:pw@example.com/x"), "***example.com/x");
  const n = buildDone({ status: "completed", outputText: "Set Authorization: Bearer abcdefghijklmnop." }, "/w", {});
  assert.ok(!n.body.includes("abcdefghijklmnop"));
});

test("control characters cannot break out of the sequence", () => {
  const n = buildDone({ status: "completed", outputText: "Done\x07\x1b]52;c;AAAA\x07 now\u009c." }, "/w", {});
  assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(n.body));
});

test("terminal detection", () => {
  assert.strictEqual(detectFormat({ AGENT_TERMINAL_SESSION_ID: "s1", WT_SESSION: "x" }), "osc777");
  assert.strictEqual(detectFormat({ KITTY_WINDOW_ID: "1" }), "osc99");
  assert.strictEqual(detectFormat({ TERM_PROGRAM: "ghostty" }), "osc777");
  assert.strictEqual(detectFormat({ TERM_PROGRAM: "iTerm.app" }), "osc9");
  assert.strictEqual(detectFormat({ WT_SESSION: "x" }), "osc9");
  assert.strictEqual(detectFormat({ TERM_PROGRAM: "Apple_Terminal" }), "bell");
  assert.strictEqual(detectFormat({}), "osc9");
});

test("sequences", () => {
  assert.strictEqual(sequence("osc777", "T;t", "a;b"), "\x1b]777;notify;T,t;a,b\x07");
  assert.strictEqual(sequence("osc9", "T", "b"), "\x1b]9;T: b\x07");
  assert.strictEqual(sequence("osc9", "1 T", "b"), "\x1b]9;· 1 T: b\x07");
  assert.strictEqual(sequence("osc99", "T", "b"), "\x1b]99;;T: b\x1b\\");
  assert.strictEqual(sequence("bell", "T", "b"), "\x07");
  assert.ok(sequence("all", "T", "b").endsWith("\x07") && sequence("all", "T", "b").includes("]777;"));
});

test("format setting", () => {
  const n = { title: "T", body: "b" };
  assert.strictEqual(render(n, { TERMINAL_NOTIFY_FORMAT: "off" }), null);
  assert.strictEqual(render(n, { TERMINAL_NOTIFY_FORMAT: "bell" }), "\x07");
  assert.strictEqual(render(n, { TERMINAL_NOTIFY_FORMAT: "nonsense", AGENT_TERMINAL_SESSION_ID: "s" }), "\x1b]777;notify;T;b\x07");
  assert.strictEqual(render(null, {}), null);
});

test("hooks never throw", () => {
  assert.doesNotThrow(() => plugin.hooks.afterRun({}));
  assert.doesNotThrow(() => plugin.hooks.onEvent({}));
  assert.doesNotThrow(() => plugin.hooks.onEvent(undefined));
  assert.doesNotThrow(() => plugin.hooks.onEvent({ type: "tool-started" }));
});
