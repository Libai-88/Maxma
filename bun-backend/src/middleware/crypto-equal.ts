/**
 * middleware/crypto-equal.ts — 定长时间字符串比较（对齐 Python hmac.compare_digest）。
 *
 * Python 侧用 hmac.compare_digest 防时序攻击；Bun/WebCrypto 无同名 API，
 * 这里用「先比长度 + 逐字节 XOR 累积」实现同语义（不提前返回）。
 */

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // 长度不同也消耗一次比较，避免长度泄漏的早退优化
    let acc = 0;
    for (let i = 0; i < ab.length; i++) acc |= ab[i]! ^ bb[i % Math.max(1, bb.length)]!;
    return false;
  }
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}
