#!/usr/bin/env bun
/**
 * 生成 config/stickers 的 dsh-meme 兼容 index.db + manifest.json。
 * 用法：bun scripts/build-sticker-pack.ts [dir]
 */
import * as path from "node:path";

import { buildBuiltinPack } from "../bun-backend/src/stickers/build";

const dir = path.resolve(
  process.argv[2] || path.join(import.meta.dir, "..", "config", "stickers"),
);
const result = buildBuiltinPack(dir, true);
console.log(
  JSON.stringify(
    { ok: true, dir: result.dir, count: result.count, rebuilt: result.rebuilt },
    null,
    2,
  ),
);
