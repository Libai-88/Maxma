/**
 * codeintel/symbols.ts — 轻量符号抽取（C2 的索引侧）。
 *
 * TS/JS 走 TypeScript 编译器 API 的 AST，不做正则猜名字；其它语言只做保守的
 * 行级抽取（def/class/function），够用于“先找到大致位置”，不伪装成语义索引。
 * 真正的定义/引用查询另有 Language Service 路径（见 service.ts）。
 */

import * as ts from "typescript";

export type CodeSymbolKind = "function" | "class" | "interface" | "type" | "enum" | "variable" | "method" | "property" | "module";

export interface CodeSymbol {
  name: string;
  kind: CodeSymbolKind;
  line: number;
  column: number;
  container?: string;
  signature?: string;
}

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
const CODE_EXTENSIONS = new Set([...TS_EXTENSIONS, ".py", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".h", ".cpp", ".hpp", ".cs"]);

export function isTypeScriptFile(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return [...TS_EXTENSIONS].some((ext) => lower.endsWith(ext));
}

export function isCodeFile(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return [...CODE_EXTENSIONS].some((ext) => lower.endsWith(ext));
}

function scriptKind(relativePath: string): ts.ScriptKind {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function lineColumn(sourceFile: ts.SourceFile, position: number): { line: number; column: number } {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(position);
  return { line: line + 1, column: character + 1 };
}

function nameText(name: ts.Node | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

/**
 * TS/JS AST 抽取。只记录“可被 goto definition 的命名声明”，不记录每个引用，
 * 避免把索引量放大成噪声。
 */
export function extractTypeScriptSymbols(relativePath: string, content: string): CodeSymbol[] {
  const sourceFile = ts.createSourceFile(
    relativePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(relativePath),
  );
  const symbols: CodeSymbol[] = [];
  const push = (name: string | null, kind: CodeSymbolKind, node: ts.Node, container?: string, signature?: string) => {
    if (!name) return;
    const at = lineColumn(sourceFile, node.getStart(sourceFile));
    symbols.push({ name, kind, line: at.line, column: at.column, ...(container ? { container } : {}), ...(signature ? { signature } : {}) });
  };
  const containerName = (node: ts.Node): string | undefined => {
    let parent: ts.Node | undefined = node.parent;
    while (parent) {
      if (ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isClassExpression(parent)) {
        return nameText(parent.name) ?? "anonymous";
      }
      parent = parent.parent;
    }
    return undefined;
  };

  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node)) push(nameText(node.name), "function", node, undefined, `function ${nameText(node.name) ?? ""}`);
    else if (ts.isClassDeclaration(node)) push(nameText(node.name), "class", node);
    else if (ts.isInterfaceDeclaration(node)) push(nameText(node.name), "interface", node);
    else if (ts.isTypeAliasDeclaration(node)) push(nameText(node.name), "type", node);
    else if (ts.isEnumDeclaration(node)) push(nameText(node.name), "enum", node);
    else if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) push(nameText(node.name), "method", node, containerName(node));
    else if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) push(nameText(node.name), "property", node, containerName(node));
    else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) push(declaration.name.text, "variable", declaration);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return dedupe(symbols);
}

function dedupe(symbols: CodeSymbol[]): CodeSymbol[] {
  const seen = new Set<string>();
  return symbols.filter((symbol) => {
    const key = `${symbol.name}\0${symbol.kind}\0${symbol.line}\0${symbol.column}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const GENERIC_PATTERNS: Array<{ re: RegExp; kind: CodeSymbolKind }> = [
  { re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: "function" },
  { re: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
  { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: "interface" },
  { re: /^\s*(?:export\s+)?(?:type|enum)\s+([A-Za-z_$][\w$]*)/, kind: "type" },
  { re: /^\s*def\s+([A-Za-z_$][\w$]*)/, kind: "function" },
  { re: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_$][\w$]*)/, kind: "function" },
  { re: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_$][\w$]*)/, kind: "function" },
  { re: /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:class|interface|enum)\s+([A-Za-z_$][\w$]*)/, kind: "class" },
];

export function extractGenericSymbols(relativePath: string, content: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const pattern of GENERIC_PATTERNS) {
      const match = pattern.re.exec(line);
      if (!match?.[1]) continue;
      symbols.push({ name: match[1], kind: pattern.kind, line: index + 1, column: match.index + 1 });
      break;
    }
  }
  return dedupe(symbols);
}

export function extractSymbols(relativePath: string, content: string): CodeSymbol[] {
  if (isTypeScriptFile(relativePath)) {
    try {
      return extractTypeScriptSymbols(relativePath, content);
    } catch {
      return extractGenericSymbols(relativePath, content);
    }
  }
  if (isCodeFile(relativePath)) return extractGenericSymbols(relativePath, content);
  return [];
}
