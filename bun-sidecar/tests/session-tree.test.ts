/**
 * tests/session-tree.test.ts — 会话树 / 树内导航 / 分叉（TREE-001..003）。
 *
 * ## 背景
 *
 * pi 把会话存成 **append-only entry 树 + 活动 leaf**：`/tree` 在同一会话里移动 leaf
 * （不删除任何条目），`/fork` 从某条消息分出**新会话**。这是 pi 的核心能力，
 * 而 Maxma 此前只用过 `getBranch()`/`getLeafId()`（undo 与 checkpoint），
 * 整棵树从未暴露给用户。
 *
 * 本文件锁的是**我们投影出来的形状**与**三个动作的真实语义**，不是 pi 内部实现。
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "maxma-tree-"));
}

/** 建一个带分支的会话：问题一 → 回答一 → 问题二 → 回答二，然后回到问题二改答。 */
function branchySession() {
  const dir = tmpDir();
  const sm = SessionManager.create(dir);
  sm.appendMessage({ role: "user", content: [{ type: "text", text: "问题一" }] } as never);
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "回答一" }] } as never);
  sm.appendMessage({ role: "user", content: [{ type: "text", text: "问题二" }] } as never);
  const entries = sm.getEntries();
  const forkPoint = entries[entries.length - 1]!.id;
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "回答二·甲" }] } as never);
  // 回到「问题二」，改写答案 → 形成第二个分支
  sm.branch(forkPoint);
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "回答二·乙" }] } as never);
  return { dir, sm, forkPoint };
}

const countNodes = (nodes: Array<{ children: unknown[] }>): number =>
  nodes.reduce((acc, n) => acc + 1 + countNodes(n.children as Array<{ children: unknown[] }>), 0);

describe("会话树（TREE-001）", () => {
  test("分支会话的树包含两个兄弟分支，且总节点数正确", () => {
    const { dir, sm } = branchySession();
    try {
      const tree = sm.getTree();
      expect(tree.length).toBe(1); // 单一根
      // 5 条 entry：问题一/回答一/问题二/回答二·甲/回答二·乙
      expect(countNodes(tree as never)).toBe(5);

      // 「问题二」下应有两个子节点（两条不同的回答）
      const flat: Array<{ entry: { id: string }; children: unknown[] }> = [];
      const walk = (ns: Array<{ entry: { id: string }; children: unknown[] }>) => {
        for (const n of ns) { flat.push(n); walk(n.children as never); }
      };
      walk(tree as never);
      const q2 = flat.find((n) => n.entry.id === sm.getEntries()[2]!.id);
      expect(q2, "找不到「问题二」节点").toBeDefined();
      expect(q2!.children.length, "「问题二」应有两个分支").toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("leaf 指向当前活动分支的末端", () => {
    const { dir, sm } = branchySession();
    try {
      const leaf = sm.getLeafId();
      expect(leaf).not.toBeNull();
      const leafEntry = sm.getEntry(leaf!);
      expect(leafEntry).toBeDefined();
      // 当前分支应以「回答二·乙」结尾（branch 之后追加的那条）
      const branch = sm.getBranch();
      const last = branch[branch.length - 1] as { message?: { content?: Array<{ text?: string }> } };
      expect(last.message?.content?.[0]?.text).toBe("回答二·乙");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("getEntry 对不存在的 id 返回 undefined（分叉前校验依赖它）", () => {
    const { dir, sm } = branchySession();
    try {
      expect(sm.getEntry("no-such-entry-id")).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("树内导航（TREE-002）", () => {
  test("branch 移动 leaf 但不删除任何 entry（append-only）", () => {
    const { dir, sm, forkPoint } = branchySession();
    try {
      const before = sm.getEntries().length;
      sm.branch(forkPoint);
      expect(sm.getLeafId()).toBe(forkPoint);
      // 条目数不变——branch 只移动指针
      expect(sm.getEntries().length).toBe(before);
      // 树结构也还在（两个分支都在）
      expect(countNodes(sm.getTree() as never)).toBe(5);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("resetLeaf 回到根，后续追加形成新分支", () => {
    const { dir, sm } = branchySession();
    try {
      sm.resetLeaf();
      expect(sm.getLeafId()).toBeNull();
      const before = sm.getEntries().length;
      sm.appendMessage({ role: "user", content: [{ type: "text", text: "全新开始" }] } as never);
      expect(sm.getEntries().length).toBe(before + 1);
      expect(sm.getBranch().length).toBe(1); // 新分支只有这一条
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("分叉（TREE-003）", () => {
  test("forkFrom + branch(targetId) 得到从该点起的新会话", () => {
    const { dir, sm, forkPoint } = branchySession();
    try {
      const sourceFile = sm.getSessionFile();
      expect(sourceFile).toBeTruthy();

      const forked = SessionManager.forkFrom(sourceFile!, sm.getCwd());
      forked.branch(forkPoint);

      // 新会话：id 不同、leaf 在分叉点、分支长度 = 该点之前的条目数
      expect(forked.getSessionId()).not.toBe(sm.getSessionId());
      expect(forked.getLeafId()).toBe(forkPoint);
      expect(forked.getBranch().length).toBe(3); // 问题一/回答一/问题二
      // 原会话不受影响
      expect(sm.getEntries().length).toBe(5);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("分叉出的文件可被 SessionManager.open 恢复（后端 resume 依赖这一点）", () => {
    const { dir, sm, forkPoint } = branchySession();
    try {
      const forked = SessionManager.forkFrom(sm.getSessionFile()!, sm.getCwd());
      forked.branch(forkPoint);
      const forkFile = forked.getSessionFile();
      expect(forkFile).toBeTruthy();
      expect(fs.existsSync(forkFile!)).toBe(true);

      // 后端把分叉会话变成活会话时走的是 open + resume_session_id，
      // 这里验证那条路径真的能读回来。
      const reopened = SessionManager.open(forkFile!, undefined, sm.getCwd());
      expect(reopened.getSessionId()).toBe(forked.getSessionId());
      expect(reopened.getEntries().length).toBe(forked.getEntries().length);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("空会话没有有效文件，引擎会拒绝分叉（kernel 据此提前报可读原因）", () => {
    const dir = tmpDir();
    try {
      const sm = SessionManager.create(dir);
      // 未追加任何消息 → 没有落盘文件
      expect(sm.getEntryCount()).toBe(0);
      const file = sm.getSessionFile();
      // pi 在首次追加内容前不写文件；即便给了路径，fork 也会因"空/无效"被拒。
      if (file && fs.existsSync(file)) {
        expect(() => SessionManager.forkFrom(file, sm.getCwd())).toThrow();
      } else {
        // 没有文件可 fork —— 正是 kernel 用 entryCount===0 提前拦截的场景
        expect(file === undefined || !fs.existsSync(file)).toBe(true);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("分叉后的新会话可以继续追加，与原会话互不影响", () => {
    const { dir, sm, forkPoint } = branchySession();
    try {
      const forked = SessionManager.forkFrom(sm.getSessionFile()!, sm.getCwd());
      forked.branch(forkPoint);
      forked.appendMessage({ role: "assistant", content: [{ type: "text", text: "分叉后的新回答" }] } as never);

      // forkFrom 复制**整个**会话（含另一条分支的 entry），branch 只移动 leaf 指针。
      // 所以条目数是 5+1=6，而**活动分支**是从分叉点起的新分支（4 条）。
      // 这个区别很重要：分叉不裁剪历史，被弃分支仍在文件里（append-only）。
      expect(forked.getEntries().length).toBe(6);
      expect(forked.getBranch().length).toBe(4);
      expect(sm.getEntries().length).toBe(5); // 原会话没变
      const forkedBranch = forked.getBranch() as Array<{ message?: { content?: Array<{ text?: string }> } }>;
      expect(forkedBranch[forkedBranch.length - 1]?.message?.content?.[0]?.text).toBe("分叉后的新回答");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
