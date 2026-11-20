/**
 * tests/workspace-p0.test.ts — Workbench 文件面板 P0 的路径/鉴权/只读契约。
 *
 * 这些是当前实现的验收测试，不是未来功能的能力声明。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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

  test("select-file 不再静默成功", async () => {
    const app = await makeApp();
    const response = await call(app, "/api/select-file?type=file");
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ path: null, reason: "desktop_required" });
  });
});
