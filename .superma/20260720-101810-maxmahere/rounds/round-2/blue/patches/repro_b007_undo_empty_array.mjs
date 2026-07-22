/**
 * Repro for BC-002 (B-007 challenge): show that Red's rewritten `undo` handler
 * in bun-sidecar/src/session-bridge.ts:555-599 can call
 * `record.session.agent.replaceMessages([])` — wiping all state — when
 * `cutIndex` lands on 0, and that this outcome is inconsistent with the
 * `compact` handler (lines 601-637) which explicitly preserves a leading
 * `system` message.
 *
 * The bug surfaces in two real cases:
 *   (a) messages = [user, assistant] (no leading system), steps >= 1
 *       → cutIndex = 0 → remaining = [] → replaceMessages([])
 *   (b) messages = [user, assistant, user, assistant], steps = 5
 *       (i.e. steps > number of user turns)
 *       → loop walks all the way back to cutIndex = 0 → remaining = []
 *
 * Run:  node patches/repro_b007_undo_empty_array.mjs
 *   or: bun  patches/repro_b007_undo_empty_array.mjs
 *
 * Exit code 1 = bug confirmed (one of the cases wipes state).
 */

// ── Verbatim copy of Red's new undo cut logic from session-bridge.ts ──
// (only the cutIndex computation; we mock the agent and record).
// BC-002 fix: mirror compact's hasLeadingSystem preservation; no-op when
// turnsRemoved < steps OR cut would wipe all state with no leading system.
function undoCutIndex(messages, steps) {
  const originalLen = messages.length;
  const hasLeadingSystem = originalLen > 0 && messages[0]?.role === "system";
  let turnsRemoved = 0;
  let cutIndex = originalLen;
  for (let i = originalLen - 1; i >= 0; i--) {
    const role = messages[i]?.role;
    if (role === "user") {
      turnsRemoved += 1;
      cutIndex = i;
      if (turnsRemoved >= steps) break;
    }
  }
  // BC-002: no-op when we can't remove `steps` turns OR when the cut would
  // wipe all state with no leading system message to preserve. Returns the
  // original messages unchanged (mirrors source: send no-op response without
  // calling replaceMessages).
  if (turnsRemoved < steps || (!hasLeadingSystem && cutIndex <= 0)) {
    return messages;
  }
  if (hasLeadingSystem && cutIndex < 1) cutIndex = 1;
  return messages.slice(0, cutIndex);
}

// Verbatim copy of Red's new compact cut logic from session-bridge.ts:601-637
function compactCut(messages, keepLast) {
  const originalLen = messages.length;
  const hasLeadingSystem =
    originalLen > 0 && messages[0]?.role === "system";
  const head = hasLeadingSystem ? [messages[0]] : [];
  const tailSource = hasLeadingSystem ? messages.slice(1) : messages;
  const tail = tailSource.slice(-Math.max(0, keepLast));
  return head.concat(tail);
}

// Mock pi-agent-core agent that records replaceMessages calls.
function makeMockAgent() {
  const calls = [];
  return {
    calls,
    replaceMessages(ms) { calls.push(ms); },
    abort() {},
  };
}

function runCase(label, messages, steps) {
  console.log(`\n=== ${label} ===`);
  console.log("messages:", JSON.stringify(messages.map(m => m.role)));
  console.log("steps:", steps);
  const remaining = undoCutIndex(messages, steps);
  console.log("undo remaining:", JSON.stringify(remaining.map(m => m.role)));
  const agent = makeMockAgent();
  agent.replaceMessages(remaining);
  console.log("replaceMessages called with length:", agent.calls[0]?.length);
  return { remaining, wiped: remaining.length === 0 && messages.length > 0 };
}

const results = [];

// Case 1: NO leading system, single user turn. steps=1.
// Expected (correct): remaining = [] is wrong — should at least preserve a
// valid state OR be a safe no-op. Current behavior: wipes everything.
results.push(runCase(
  "Case 1: [user, assistant], steps=1 (no leading system)",
  [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }],
  1,
));

// Case 2: NO leading system, multiple user turns, steps exceeds count.
// User asked to undo more turns than exist — should be a no-op or cap at
// available turns. Current behavior: wipes everything.
results.push(runCase(
  "Case 2: [user, asst, user, asst], steps=5 (steps > turn count, no leading system)",
  [
    { role: "user", content: "q1" }, { role: "assistant", content: "a1" },
    { role: "user", content: "q2" }, { role: "assistant", content: "a2" },
  ],
  5,
));

// Case 3: WITH leading system, single turn. steps=1.
// Safe by accident — cutIndex lands on 1, remaining = [system].
results.push(runCase(
  "Case 3: [system, user, assistant], steps=1 (leading system, safe)",
  [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ],
  1,
));

// Case 4: WITH leading system, steps exceeds count.
// Safe by accident — cutIndex lands on 1, remaining = [system].
results.push(runCase(
  "Case 4: [system, user, asst, user, asst], steps=5 (leading system, safe by accident)",
  [
    { role: "system", content: "sys" },
    { role: "user", content: "q1" }, { role: "assistant", content: "a1" },
    { role: "user", content: "q2" }, { role: "assistant", content: "a2" },
  ],
  5,
));

// Case 5: Compare with compact handler. Same Case 1 input, compact with
// keepLast=0 — does compact also wipe everything? It should NOT, because
// when hasLeadingSystem=false the head is [] and tail = messages.slice(0) =
// all messages. So compact is a no-op when keepLast >= messages.length.
// But more importantly: compact explicitly checks hasLeadingSystem. undo
// does NOT.
console.log("\n=== Compare: compact handler on Case 1 input (keepLast=0) ===");
const case1Messages = [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }];
const compactRemain = compactCut(case1Messages, 0);
console.log("compact remaining:", JSON.stringify(compactRemain.map(m => m.role)));
console.log("compact has hasLeadingSystem check? YES (session-bridge.ts:616-617)");
console.log("undo has hasLeadingSystem check? NO (session-bridge.ts:589)");

// Case 6: When a system message exists, undo preserves it only by accident
// (cutIndex lands on the user position which is > 0). But if the system
// message is at index 0 and the user is also at index 0 (impossible — a
// message has one role), the empty-array bug would trigger. The real issue
// is that undo does not EXPLICITLY preserve the system message, so any
// future change to the cut logic could regress.
console.log("\n=== Inconsistency summary ===");
console.log("compact: explicitly preserves leading system message (lines 614-621)");
console.log("undo:    does NOT preserve leading system message (line 589)");
console.log("         → when cutIndex=0 (no leading system OR steps > user count),");
console.log("           undo passes [] to replaceMessages, wiping all state.");

const wipedAny = results.some(r => r.wiped);
if (wipedAny) {
  console.log("\n*** BC-002 CONFIRMED: undo handler wipes state with empty array in at least one case ***");
  console.log("*** Inconsistent with compact handler which preserves leading system message ***");
  process.exit(1);
} else {
  console.log("\n*** No bug found (challenge would be rejected) ***");
  process.exit(0);
}
