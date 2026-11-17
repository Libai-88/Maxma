/**
 * web/eslint.config.js — ESLint flat config（P1-1）。
 *
 * ## 只对**改动的文件**开闸
 *
 * web/src 有 2.6 万行、从没跑过 lint。一次性对全量开闸等于一次性面对几千条存量
 * 告警，结果必然是"加个 --quiet 眼不见为净"，然后这门就永久失效了。
 * 所以门槛只覆盖本次 diff 触及的文件（见 scripts/lint-changed.mjs）：
 * 存量不动，新写的代码按新规矩来。
 *
 * ## 规则取向
 *
 * 三类真正会造成线上事故的：
 *   1. `react-hooks/rules-of-hooks` —— hook 调用顺序错乱（React 19 下是白屏/状态串台）；
 *   2. `@typescript-eslint/no-floating-promises` —— 漏 await 的 Promise（
 *      WS 重连、持久化、贴纸加载都踩过：异常被静默吞掉，界面停在中间态）；
 *   3. `@typescript-eslint/no-explicit-any` —— 仓库现状是三侧 0 个 any，这条例外是**守住**
 *      既有干净度，不是新要求。
 *
 * 需要类型信息的规则靠 `projectService`（自动挑最近的 tsconfig），
 * 因此 lint 单文件也要能定位到项目——这也是只对改动文件跑的原因之一。
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "scripts/**", // 纯 node 小脚本，不进 React/TS 规则面
      "public/**",
      "*.config.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: dirname,
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // 漏 await：异步失败被静默吞掉的源头。
      "@typescript-eslint/no-floating-promises": "error",
      // 把 async 函数直接塞给同步回调（事件处理器）的常见误用。
      "@typescript-eslint/no-misused-promises": ["warn", { checksVoidReturn: false }],
      // 三侧现状 0 个 any，这里是守成。
      "@typescript-eslint/no-explicit-any": "error",
      // 未用变量：允许 `_` 前缀的显式忽略（契约占位参数）。
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // 空 catch 是"吞错"的形状，仓库现状 0 个。
      "no-empty": ["error", { allowEmptyCatch: false }],
    },
  },
  {
    // 测试文件放宽：bun:test 的断言写法与普通源码不同，且不参与类型敏感规则之外的约束。
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
