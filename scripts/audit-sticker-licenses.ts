/**
 * 对 dsh-meme 市场目录做许可证/来源审计。
 *
 * 它只证明字段存在、格式合法、同一 id 不重复，不能证明第三方授权真实有效；
 * 真正的版权审核仍需项目 owner 人工确认。默认只报告，`--strict` 遇到缺失即 exit 1。
 *
 * 用法：
 *   bun scripts/audit-sticker-licenses.ts
 *   bun scripts/audit-sticker-licenses.ts --strict
 *   bun scripts/audit-sticker-licenses.ts --json
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO = path.resolve(import.meta.dir, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-license-audit-"));
process.env.MAXMA_DATA_DIR = dataDir;
process.env.MAXMA_BUNDLE_DIR = REPO;
process.env.PI_CODING_AGENT_DIR = path.join(dataDir, "pi");

const strict = process.argv.includes("--strict");
const json = process.argv.includes("--json");

function cleanup() {
  for (let i = 0; i < 20; i++) {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
      return;
    } catch {
      Bun.sleepSync(50);
    }
  }
}

try {
  const { fetchMarketCatalog } = await import("../bun-backend/src/stickers/market");
  const result = await fetchMarketCatalog(true);
  if (!result.ok) {
    console.error(`目录不可达：${result.warning ?? result.sourceUrl}`);
    process.exitCode = 2;
  } else {
    const seen = new Set<string>();
    const issues: string[] = [];
    const warnings: string[] = [];
    const rows = result.packs.map((pack) => {
      const license = pack.license.trim();
      const homepage = pack.homepage.trim();
      if (seen.has(pack.id)) issues.push(`${pack.id}: 重复目录 id`);
      seen.add(pack.id);
      if (!license) issues.push(`${pack.id}: 未声明 license`);
      if (!homepage) warnings.push(`${pack.id}: 未声明 homepage（来源不可点，但不会阻断安装）`);
      if (!/^[a-f0-9]{64}$/i.test(pack.sha256)) issues.push(`${pack.id}: sha256 不是 64 位十六进制`);
      return {
        id: pack.id,
        license: license || "未声明",
        homepage: homepage || "未声明",
        sha256: /^[a-f0-9]{64}$/i.test(pack.sha256) ? "ok" : "invalid",
        count: pack.count,
      };
    });

    if (json) {
      console.log(JSON.stringify({ source: result.source, packs: rows, issues, warnings }, null, 2));
    } else {
      console.log(`目录源：${result.source}`);
      console.log(`包数：${rows.length}`);
      for (const row of rows) {
        console.log(`${row.id}\t${row.license}\t${row.homepage}\t${row.count} 张`);
      }
      if (warnings.length) {
        console.error("\n来源警告（不阻断安装）：");
        for (const warning of warnings) console.error(`- ${warning}`);
      }
      if (issues.length) {
        console.error("\n审计问题：");
        for (const issue of issues) console.error(`- ${issue}`);
      } else {
        console.log("\n✅ 许可证字段审计通过（许可证真实性仍需人工审核）");
      }
    }
    if (strict && issues.length) process.exitCode = 1;
  }
} finally {
  cleanup();
}
