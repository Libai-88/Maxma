/**
 * tests/workspace-p0.test.ts — Workbench 文件面板 P0 的路径/鉴权/只读契约。
 *
 * 这些是当前实现的验收测试，不是未来功能的能力声明。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { Hono } from "hono";

import { authHeaderFor } from "./_helpers/auth";

let dataDir = "";
let workspaceDir = "";
let prevDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-workspace-data-"));
  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-workspace-root-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(workspaceDir, { recursive: true, force: true });
});

async function makeApp(): Promise<Hono> {
  const { createApp } = await import("../src/server");
  return createApp();
}

async function call(
  app: Hono,
  urlPath: string,
  init?: RequestInit,
  address = "127.0.0.1",
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("x-maxma-token", authHeaderFor(dataDir)["x-maxma-token"] ?? "");
  return app.fetch(
    new Request(`http://localhost${urlPath}`, { ...init, headers }),
    { server: { requestIP: () => ({ address }) } },
  );
}

async function addRoot(app: Hono, rootPath: string): Promise<{ id: string }> {
  const response = await call(app, "/api/workspace/roots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: rootPath }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { root: { id: string } };
  return body.root;
}

describe("workspace P0", () => {
  test("roots/tree/file：添加根、列目录、读文本", async () => {
    fs.mkdirSync(path.join(workspaceDir, "src"));
    fs.writeFileSync(path.join(workspaceDir, "README.md"), "# hello\nworkspace\n", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "src", "main.ts"), "export const x = 1;\n", "utf8");
    const app = await makeApp();
    const root = await addRoot(app, workspaceDir);

    const roots = await call(app, "/api/workspace/roots");
    expect(roots.status).toBe(200);
    const rootsBody = (await roots.json()) as { roots: Array<{ id: string; available: boolean }> };
    expect(rootsBody.roots.some((item) => item.id === root.id && item.available === true)).toBe(true);

    const tree = await call(app, `/api/workspace/tree?root_id=${encodeURIComponent(root.id)}&path=`);
    expect(tree.status).toBe(200);
    const treeBody = (await tree.json()) as { entries: Array<{ name: string; type: string }> };
    expect(treeBody.entries.map((entry) => entry.name)).toContain("README.md");
    expect(treeBody.entries.map((entry) => entry.name)).toContain("src");

    const file = await call(
      app,
      `/api/workspace/file?root_id=${encodeURIComponent(root.id)}&path=${encodeURIComponent("src/main.ts")}`,
    );
    expect(file.status).toBe(200);
    const fileBody = (await file.json()) as { file: { content: string; hash: string; size: number } };
    expect(fileBody.file.content).toContain("export const x");
    expect(fileBody.file.hash).toHaveLength(64);
    expect(fileBody.file.size).toBeGreaterThan(0);
  });

  test("blob：PNG 返回正确 Content-Type 与 nosniff", async () => {
    // 1x1 transparent PNG
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    fs.writeFileSync(path.join(workspaceDir, "dot.png"), png);
    const app = await makeApp();
    const root = await addRoot(app, workspaceDir);

    const response = await call(
      app,
      `/api/workspace/blob?root_id=${encodeURIComponent(root.id)}&path=${encodeURIComponent("dot.png")}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await response.arrayBuffer()).byteLength).toBe(png.byteLength);
  });

  test("blob：Office 容器返回 OOXML MIME，供工作台预览", async () => {
    const cases: Array<[string, string]> = [
      ["report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["book.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ];
    const app = await makeApp();
    const root = await addRoot(app, workspaceDir);
    for (const [name, mime] of cases) {
      fs.writeFileSync(path.join(workspaceDir, name), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      const response = await call(
        app,
        `/api/workspace/blob?root_id=${encodeURIComponent(root.id)}&path=${encodeURIComponent(name)}`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(mime);
      expect((await response.arrayBuffer()).byteLength).toBe(4);
    }
  });

  test("watch：先 ready，落盘后推送 file 事件并带新 mtime/size", async () => {
    fs.writeFileSync(path.join(workspaceDir, "live.docx"), "v1", "utf8");
    const app = await makeApp();
    const root = await addRoot(app, workspaceDir);
    const response = await call(
      app,
      `/api/workspace/watch?root_id=${encodeURIComponent(root.id)}&path=live.docx`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    if (!reader) return;
    const decoder = new TextDecoder();
    let text = decoder.decode((await reader.read()).value);
    expect(text).toContain("event: ready");

    fs.writeFileSync(path.join(workspaceDir, "live.docx"), "version-two", "utf8");
    for (let attempt = 0; attempt < 8 && !text.includes("event: file"); attempt += 1) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    expect(text).toContain("event: file");
    const payloadLine = text.split("\n").find((line) => line.startsWith("data: ") && line.includes("\"state\":\"ready\""));
    expect(payloadLine).toBeTruthy();
    const payload = JSON.parse(payloadLine!.slice("data: ".length)) as { state: string; size: number; path: string };
    expect(payload).toMatchObject({ state: "ready", size: 11, path: "live.docx" });
    await reader.cancel();
  }, 15_000);

  test("watch：越界路径与远端来源被拒绝", async () => {
    fs.writeFileSync(path.join(workspaceDir, "ok.txt"), "ok", "utf8");
    const app = await makeApp();
    const root = await addRoot(app, workspaceDir);
    const escape = await call(
      app,
      `/api/workspace/watch?root_id=${encodeURIComponent(root.id)}&path=${encodeURIComponent("../secret.txt")}`,
    );
    expect([400, 403]).toContain(escape.status);

    const remote = await call(
      app,
      `/api/workspace/watch?root_id=${encodeURIComponent(root.id)}&path=ok.txt`,
      undefined,
      "10.1.2.3",
    );
    expect(remote.status).toBe(403);
    expect(((await remote.json()) as { error?: { code?: string } }).error?.code).toBe("LOOPBACK_ONLY");
  });

  test("路径逃逸：..、绝对路径、UNC、NUL 都被拒绝", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-workspace-outside-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret", "utf8");
    try {
      const app = await makeApp();
      const root = await addRoot(app, workspaceDir);

      for (const bad of ["../secret.txt", "..\\secret.txt", outside, "\\\\server\\share"]) {
        const response = await call(
          app,
          `/api/workspace/file?root_id=${encodeURIComponent(root.id)}&path=${encodeURIComponent(bad)}`,
        );
        expect([403, 400, 404]).toContain(response.status);
      }

      const nul = await call(
        app,
        `/api/workspace/file?root_id=${encodeURIComponent(root.id)}&path=%00secret.txt`,
      );
      expect([400, 403]).toContain(nul.status);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test("symlink/junction 逃逸被拒绝；MaxmaBlocker 命中被拒绝", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-workspace-link-outside-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret", "utf8");
    let linked = false;
    try {
      try {
        fs.symlinkSync(outside, path.join(workspaceDir, "escape"), process.platform === "win32" ? "junction" : "dir");
        linked = true;
      } catch {
        // Windows 无权限创建 junction 时不把环境限制伪装成通过。
      }

      fs.mkdirSync(path.join(workspaceDir, "blocked"));
      fs.writeFileSync(path.join(workspaceDir, "blocked", ".maxma_blocker"), "");
      fs.writeFileSync(path.join(workspaceDir, "blocked", "secret.txt"), "blocked", "utf8");

      const app = await makeApp();
      const root = await addRoot(app, workspaceDir);

      if (linked) {
        const response = await call(
          app,
          `/api/workspace/file?root_id=${encodeURIComponent(root.id)}&path=${encodeURIComponent("escape/secret.txt")}`,
        );
        expect(response.status).toBe(403);
        const body = (await response.json()) as { error?: { code?: string } };
        expect(body.error?.code).toBe("PATH_OUTSIDE_ROOT");
      }

      const blocked = await call(
        app,
        `/api/workspace/file?root_id=${encodeURIComponent(root.id)}&path=${encodeURIComponent("blocked/secret.txt")}`,
      );
      expect(blocked.status).toBe(403);
      const blockedBody = (await blocked.json()) as { error?: { code?: string } };
      expect(blockedBody.error?.code).toBe("PATH_BLOCKED");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test("鉴权与 loopback：无 token 401，非回环 403", async () => {
    const app = await makeApp();
    const unauthorized = await app.fetch(
      new Request("http://localhost/api/workspace/roots"),
      { server: { requestIP: () => ({ address: "127.0.0.1" }) } },
    );
    expect(unauthorized.status).toBe(401);

    const remote = await call(app, "/api/workspace/roots", undefined, "10.1.2.3");
    expect(remote.status).toBe(403);
    expect(((await remote.json()) as { error?: { code?: string } }).error?.code).toBe("LOOPBACK_ONLY");
  });

  test("删除根只撤销授权，不删除磁盘目录", async () => {
    const app = await makeApp();
    const root = await addRoot(app, workspaceDir);
    const response = await call(app, `/api/workspace/roots/${encodeURIComponent(root.id)}`, { method: "DELETE" });
    expect(response.status).toBe(200);
    expect(fs.existsSync(workspaceDir)).toBe(true);

    const roots = await call(app, "/api/workspace/roots");
    expect(((await roots.json()) as { roots: unknown[] }).roots).toHaveLength(0);
  });

  test("PATCH 根标签：改名持久化、空/超长/不存在被拒绝", async () => {
    const app = await makeApp();
    const root = await addRoot(app, workspaceDir);

    const renamed = await call(app, `/api/workspace/roots/${encodeURIComponent(root.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "我的项目" }),
    });
    expect(renamed.status).toBe(200);
    const body = (await renamed.json()) as { root: { id: string; label: string; available: boolean } };
    expect(body.root).toMatchObject({ id: root.id, label: "我的项目", available: true });

    const secondApp = await makeApp();
    const roots = await call(secondApp, "/api/workspace/roots");
    const rootsBody = (await roots.json()) as { roots: Array<{ id: string; label: string }> };
    expect(rootsBody.roots.find((item) => item.id === root.id)?.label).toBe("我的项目");

    const empty = await call(app, `/api/workspace/roots/${encodeURIComponent(root.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "   " }),
    });
    expect(empty.status).toBe(400);

    const tooLong = await call(app, `/api/workspace/roots/${encodeURIComponent(root.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "x".repeat(241) }),
    });
    expect(tooLong.status).toBe(400);

    const missing = await call(app, "/api/workspace/roots/wr_0000000000000000", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "不存在" }),
    });
    expect(missing.status).toBe(404);
  });

  test("search：递归匹配文件名，跳过忽略目录，拒绝空查询", async () => {
    fs.mkdirSync(path.join(workspaceDir, "src", "deep"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, "src", "deep", "needle-notes.md"), "nested\n", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "node_modules", "pkg", "needle-hidden.js"), "hidden\n", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "root-needle.txt"), "root\n", "utf8");
    const app = await makeApp();
    const root = await addRoot(app, workspaceDir);

    const found = await call(app, `/api/workspace/search?root_id=${encodeURIComponent(root.id)}&q=${encodeURIComponent("needle")}`);
    expect(found.status).toBe(200);
    const body = (await found.json()) as { entries: Array<{ path: string }>; truncated: boolean };
    expect(body.entries.map((item) => item.path)).toEqual([
      "root-needle.txt",
      "src/deep/needle-notes.md",
    ]);
    expect(body.truncated).toBe(false);

    const ignored = await call(app, `/api/workspace/search?root_id=${encodeURIComponent(root.id)}&q=needle&show_ignored=1`);
    expect(ignored.status).toBe(200);
    expect(((await ignored.json()) as { entries: Array<{ path: string }> }).entries).toContainEqual(
      expect.objectContaining({ path: "node_modules/pkg/needle-hidden.js" }),
    );

    const empty = await call(app, `/api/workspace/search?root_id=${encodeURIComponent(root.id)}&q=`);
    expect(empty.status).toBe(400);
  });

  test("write：base_hash 保护、原子保存与冲突拒绝", async () => {
    fs.writeFileSync(path.join(workspaceDir, "edit-me.txt"), "first\n", "utf8");
    const app = await makeApp();
    const root = await addRoot(app, workspaceDir);
    const read = await call(app, `/api/workspace/file?root_id=${encodeURIComponent(root.id)}&path=edit-me.txt`);
    const file = ((await read.json()) as { file: { hash: string; content: string } }).file;
    expect(file.content).toBe("first\n");

    const saved = await call(app, "/api/workspace/file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root_id: root.id, path: "edit-me.txt", content: "second\n", base_hash: file.hash }),
    });
    expect(saved.status).toBe(200);
    expect(fs.readFileSync(path.join(workspaceDir, "edit-me.txt"), "utf8")).toBe("second\n");

    const stale = await call(app, "/api/workspace/file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root_id: root.id, path: "edit-me.txt", content: "stale\n", base_hash: file.hash }),
    });
    expect(stale.status).toBe(409);
    expect(fs.readFileSync(path.join(workspaceDir, "edit-me.txt"), "utf8")).toBe("second\n");
  });

  test("git：只读 status/diff，非仓库降级", async () => {
    const run = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: workspaceDir, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
      return result.stdout.trim();
    };
    run("init", "-b", "main");
    run("config", "user.email", "test@example.com");
    run("config", "user.name", "Tester");
    fs.writeFileSync(path.join(workspaceDir, "tracked.txt"), "one\n", "utf8");
    run("add", "tracked.txt");
    run("commit", "-m", "init");
    fs.writeFileSync(path.join(workspaceDir, "tracked.txt"), "two\n", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "new.txt"), "untracked\n", "utf8");

    const app = await makeApp();
    const root = await addRoot(app, workspaceDir);
    const status = await call(app, `/api/git/status?root_id=${encodeURIComponent(root.id)}`);
    expect(status.status).toBe(200);
    const body = (await status.json()) as {
      isRepo: boolean;
      branch: string | null;
      files: Array<{ path: string; untracked: boolean; worktree: string }>;
    };
    expect(body.isRepo).toBe(true);
    expect(body.branch).toBe("main");
    expect(body.files).toContainEqual(expect.objectContaining({ path: "tracked.txt", worktree: "M" }));
    expect(body.files).toContainEqual(expect.objectContaining({ path: "new.txt", untracked: true }));

    const diff = await call(app, `/api/git/diff?root_id=${encodeURIComponent(root.id)}&path=tracked.txt`);
    expect(diff.status).toBe(200);
    const diffBody = (await diff.json()) as { patch: string; untracked: boolean };
    expect(diffBody.patch).toContain("-one");
    expect(diffBody.patch).toContain("+two");
    expect(diffBody.untracked).toBe(false);

    const untrackedDiff = await call(app, `/api/git/diff?root_id=${encodeURIComponent(root.id)}&path=new.txt`);
    expect(untrackedDiff.status).toBe(200);
    expect(((await untrackedDiff.json()) as { untracked: boolean }).untracked).toBe(true);
  });

  test("git：非仓库根返回 isRepo=false", async () => {
    const app = await makeApp();
    const root = await addRoot(app, workspaceDir);
    const response = await call(app, `/api/git/status?root_id=${encodeURIComponent(root.id)}`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { isRepo: boolean }).isRepo).toBe(false);
  });

  test("run：命令在工作区根执行、空命令拒绝", async () => {
    const app = await makeApp();
    const root = await addRoot(app, workspaceDir);
    const response = await call(app, "/api/workspace/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root_id: root.id, command: 'node -e "console.log(process.cwd())"', timeout_ms: 10000 }),
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as { exitCode: number; stdout: string; timedOut: boolean };
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toLowerCase()).toContain(path.basename(workspaceDir).toLowerCase());
    expect(result.timedOut).toBe(false);

    const empty = await call(app, "/api/workspace/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root_id: root.id, command: "" }),
    });
    expect(empty.status).toBe(400);
  });

  test("git 写：stage/commit 需显式确认，不自动 push", async () => {
    const run = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: workspaceDir, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
      return result.stdout.trim();
    };
    run("init", "-b", "main");
    run("config", "user.email", "test@example.com");
    run("config", "user.name", "Tester");
    fs.writeFileSync(path.join(workspaceDir, "a.txt"), "hello\n", "utf8");

    const app = await makeApp();
    const root = await addRoot(app, workspaceDir);
    const staged = await call(app, "/api/git/stage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root_id: root.id, paths: ["a.txt"] }),
    });
    expect(staged.status).toBe(200);
    expect(((await staged.json()) as { files: Array<{ path: string; staged: boolean }> }).files).toContainEqual(
      expect.objectContaining({ path: "a.txt", staged: true }),
    );

    const noConfirm = await call(app, "/api/git/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root_id: root.id, message: "add a", confirm: false }),
    });
    expect(noConfirm.status).toBe(400);

    const committed = await call(app, "/api/git/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root_id: root.id, message: "add a", confirm: true }),
    });
    expect(committed.status).toBe(200);
    const commitBody = (await committed.json()) as { commit: string | null; branch: string | null };
    expect(commitBody.commit).toBeTruthy();
    expect(commitBody.branch).toBe("main");
    expect(run("log", "-1", "--pretty=%s")).toBe("add a");
  });

  test("git 推送：必须显式确认，固定 origin，推送到本地 bare 远端", async () => {
    const run = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: workspaceDir, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
      return result.stdout.trim();
    };
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-bare-"));
    try {
      spawnSync("git", ["init", "--bare", remote], { encoding: "utf8" });
      run("init", "-b", "main");
      run("config", "user.email", "test@example.com");
      run("config", "user.name", "Tester");
      fs.writeFileSync(path.join(workspaceDir, "push.txt"), "v1\n", "utf8");
      run("add", "push.txt");
      run("commit", "-m", "push init");
      run("remote", "add", "origin", remote);

      const app = await makeApp();
      const root = await addRoot(app, workspaceDir);
      const remoteStatus = await call(app, `/api/git/remote?root_id=${encodeURIComponent(root.id)}`);
      expect(remoteStatus.status).toBe(200);
      expect(((await remoteStatus.json()) as { remote: string }).remote).toBe(remote);

      const noConfirm = await call(app, "/api/git/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ root_id: root.id, confirm: false }),
      });
      expect(noConfirm.status).toBe(400);

      const pushed = await call(app, "/api/git/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ root_id: root.id, confirm: true }),
      });
      expect(pushed.status).toBe(200);
      const remoteHead = spawnSync("git", ["--git-dir", remote, "rev-parse", "main"], { encoding: "utf8" });
      expect(remoteHead.status).toBe(0);
      expect(remoteHead.stdout.trim()).toBe(run("rev-parse", "HEAD"));

      const prNoConfirm = await call(app, "/api/git/pr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ root_id: root.id, title: "x", body: "", base: "main", confirm: false }),
      });
      expect(prNoConfirm.status).toBe(400);
    } finally {
      fs.rmSync(remote, { recursive: true, force: true });
    }
  });

  test("select-file 不再静默成功", async () => {
    const app = await makeApp();
    const response = await call(app, "/api/select-file?type=file");
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ path: null, reason: "desktop_required" });
  });
});
