import { readFileSync, writeFileSync, globSync } from "fs";
import { join } from "path";

// Fix content script encoding for Edge/Chrome:
// Escape raw control characters and U+FFFD in generated content scripts.
const dirs = globSync(".output/edge-mv3");

for (const dir of dirs) {
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
