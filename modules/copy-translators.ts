import fs from "node:fs";
import path from "node:path";
import { addPublicAssets, defineWxtModule } from "wxt/modules";

const SANDBOX_IMPORT = `import { ZU, Zotero, Z, text, innerText, attr, request, requestJSON, requestText, requestDocument, xpath, xpathText, DOMParser, documentHref } from "/sandbox.js";\n`;

const EXPORT_CANDIDATES = [
  "detectWeb",
  "doWeb",
  "detectImport",
  "doImport",
  "detectSearch",
  "doSearch",
  "doExport",
];

/**
 * Extract the leading JSON metadata block from translator source.
 * Returns the parsed object and the end-index, or null.
 */
function extractMetadata(code: string): { metadata: Record<string, unknown>; end: number } | null {
  const trimmed = code.trimStart();
  if (!trimmed.startsWith("{")) return null;

  // Skip leading whitespace / comments
  let i = 0;
  while (i < code.length && code[i] !== "{") i++;
  if (i >= code.length) return null;

  let depth = 0;
  let inStr: string | null = null;
  let esc = false;
  const start = i;

  while (i < code.length) {
    const ch = code[i];
    if (inStr) {
      if (esc) { esc = false; }
      else if (ch === "\\") { esc = true; }
      else if (ch === inStr) { inStr = null; }
    } else {
      if (ch === '"' || ch === "'") { inStr = ch; }
      else if (ch === "{") { depth++; }
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const jsonStr = code.slice(start, i + 1);
          try {
            const metadata = JSON.parse(jsonStr);
            return { metadata, end: i + 1 };
          } catch {
            return null;
          }
        }
      }
    }
    i++;
  }
  return null;
}

function isFunctionDefined(code: string, fnName: string): boolean {
  const patterns = [
    new RegExp(`(^|\\n)\\s*(?:async\\s+)?function\\s+${fnName}\\s*\\(`),
    new RegExp(`(^|\\n)\\s*(?:var|let|const)\\s+${fnName}\\s*=\\s*(?:async\\s+)?function\\b`),
    new RegExp(`(^|\\n)\\s*(?:var|let|const)\\s+${fnName}\\s*=\\s*(?:async\\s+)?\\(`),
    new RegExp(`(^|\\n)\\s*${fnName}\\s*=\\s*(?:async\\s+)?function\\b`),
  ];
  return patterns.some((p) => p.test(code));
}

function removeDuplicateFrameworkWrappers(code: string): string {
  for (const fn of EXPORT_CANDIDATES) {
    const wrapper = `function ${fn}(doc, url) { return FW.${fn}(doc, url); }`;
    let seen = false;
    code = code
      .split("\n")
      .filter((line) => {
        if (line.trim() !== wrapper) return true;
        if (seen) return false;
        seen = true;
        return true;
      })
      .join("\n");
  }
  return code;
}

function patchDocumentLocationAccess(code: string): string {
  return code
    .replace(/\b([A-Za-z_$][\w$]*)\.location\.href\b/g, "documentHref($1)")
    .replace(/\b([A-Za-z_$][\w$]*)\.location\.toString\(\)/g, "documentHref($1)");
}

function patchTranslator(sourceCode: string): string {
  if (sourceCode.includes("from \"/sandbox.js\"")) {
    // Already has sandbox import — ensure it's at the top
    const lines = sourceCode.split("\n");
    const importIdx = lines.findIndex((l) => l.includes("from \"/sandbox.js\""));
    if (importIdx > 1) {
      const importLine = lines.splice(importIdx, 1)[0];
      lines.unshift(importLine);
      sourceCode = lines.join("\n");
    }
  } else {
    sourceCode = SANDBOX_IMPORT + sourceCode;
  }

  // Strip leading import/directive lines before extracting metadata
  const codeAfterImports = sourceCode.replace(/^import\s+.*?;\s*\n/gm, "").replace(/^\s*\n/, "");
  const meta = extractMetadata(codeAfterImports);
  if (meta) {
    // Find the metadata block in the original source
    const metaStart = sourceCode.indexOf(codeAfterImports.trimStart().slice(0, 50));
    if (metaStart >= 0) {
      const before = sourceCode.slice(0, metaStart);
      const after = sourceCode.slice(metaStart + meta.end);
      const exportLine = `export const ZOTERO_TRANSLATOR_INFO = ${JSON.stringify(meta.metadata)};\n`;
      sourceCode = before + exportLine + after;
    }
  }

  sourceCode = removeDuplicateFrameworkWrappers(sourceCode);
  sourceCode = patchDocumentLocationAccess(sourceCode);

  // Remove any existing generated export blocks and add fresh ones
  // Remove old exports object if any
  sourceCode = sourceCode.replace(
    /\n?(?:\/\/ Export translator.*\n)+export\s+const\s+exports\s*=\s*\{[\s\S]*?\};\n*/g,
    "\n"
  );
  sourceCode = sourceCode.replace(
    /\n?\/\/ Export translator functions.*\n?export\s*\{[^}]*\};\s*\n?/g,
    "\n"
  );

  // Detect available functions and build export
  const present = EXPORT_CANDIDATES.filter((fn) => isFunctionDefined(sourceCode, fn));
  if (present.length > 0) {
    sourceCode = sourceCode.trimEnd();
    sourceCode += `\n\nexport { ${present.join(", ")} };\n`;
  }

  return sourceCode;
}

export default defineWxtModule({
  name: "copy-translators",
  setup(wxt) {
    const sourceDir = path.resolve(wxt.config.root, "translators", "zotero");
    const stagedAssetsDir = path.resolve(wxt.config.wxtDir, "copy-translators-assets");
    const stagedTranslatorsDir = path.resolve(stagedAssetsDir, "translators");

    if (!fs.existsSync(sourceDir)) {
      wxt.logger.warn("Translators directory not found:", sourceDir);
      return;
    }

    fs.rmSync(stagedAssetsDir, { recursive: true, force: true });
    fs.mkdirSync(stagedTranslatorsDir, { recursive: true });

    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".js")) continue;

      const sourceFile = path.join(sourceDir, entry.name);
      const stagedFile = path.join(stagedTranslatorsDir, entry.name);

      const sourceCode = fs.readFileSync(sourceFile, "utf-8");
      const patched = patchTranslator(sourceCode);
      fs.writeFileSync(stagedFile, patched, "utf-8");
    }

    const manifestFile = path.resolve(wxt.config.root, "translators", "manifest.json");
    if (fs.existsSync(manifestFile)) {
      fs.copyFileSync(manifestFile, path.join(stagedTranslatorsDir, "manifest.json"));
    }

    addPublicAssets(wxt, stagedAssetsDir);
  },
});
