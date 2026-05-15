import { mkdirSync, readFileSync, writeFileSync, globSync } from "fs";
import { join } from "path";

// Fix content script encoding for Edge/Chrome:
// Escape raw control characters and U+FFFD in generated content scripts.
const dirs = globSync(".output/edge-mv3");

for (const dir of dirs) {
  const translatorFiles = globSync("translators/*.js", { cwd: dir });
  const moduleDir = join(dir, "translator-modules");
  mkdirSync(moduleDir, { recursive: true });

  for (const name of translatorFiles) {
    const sourceFile = join(dir, name);
    const source = readFileSync(sourceFile, "utf-8");
    const metadataEnd = findMetadataEnd(source);
    if (metadataEnd === -1) {
      throw new Error(`Could not find translator metadata block in ${sourceFile}`);
    }

    const metadata = source.slice(0, metadataEnd + 1);
    const body = source.slice(metadataEnd + 1);
    const exportNames = [
      "detectWeb",
      "doWeb",
      "detectSearch",
      "doSearch",
      "detectImport",
      "doImport",
      "doExport",
    ].filter((fn) => new RegExp(`(?:function\\s+${fn}\\s*\\(|(?:const|let|var)\\s+${fn}\\s*=)`).test(body));

    const moduleText = [
      'import { Zotero, Z, ZU, request, requestText, requestJSON, text, attr, DOMParser } from "../sandbox.js";',
      `export const ZOTERO_TRANSLATOR_INFO = ${metadata};`,
      body,
      exportNames.length ? `export { ${exportNames.join(", ")} };` : "",
    ].join("\n");

    const moduleName = name.replace(/^translators[\\/]/, "").replace(/\.js$/, ".mjs");
    writeFileSync(join(moduleDir, moduleName), moduleText, "utf-8");
  }

  const files = globSync("content-scripts/*.js", { cwd: dir });

  for (const name of files) {
    const file = join(dir, name);
    const text = readFileSync(file, "utf-8");

    const result = [];
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
        result.push(`\\x${code.toString(16).padStart(2, "0")}`);
      } else if (code === 0xfffd) {
        result.push("\\ufffd");
      } else {
        result.push(text[i]);
      }
    }
    const fixed = result.join("");
    writeFileSync(file, fixed, "utf-8");
    console.log(`Fixed ${file}: ${fixed.length} chars`);
  }
}

function findMetadataEnd(source) {
  let depth = 0;
  let stringQuote = null;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (stringQuote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === stringQuote) {
        stringQuote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      stringQuote = ch;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
