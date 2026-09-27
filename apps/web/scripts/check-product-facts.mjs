import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const read = path => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const facts = read("../lib/facts.ts");
const value = key => Number(facts.match(new RegExp(`${key}: (\\d+)`))[1]);
const catalog = read("../../api/src/events/catalog.py").split("EVENT_DEFAULTS:")[1].split("EVENT_DESCRIPTIONS:")[0];
assert.equal(value("disruptionTypes"), [...catalog.matchAll(/^    "[a-z_]+":/gm)].length);
const optimizer = read("../../api/src/optimizer/milp.py");
const weights = optimizer.split("PLAN_WEIGHTS = {")[1].split("@dataclass")[0];
assert.equal(value("recoveryObjectives"), [...weights.matchAll(/^    "[A-D]":/gm)].length);
assert.match(optimizer, new RegExp(`if self.deterministic:[\\s\\S]*?num_search_workers = ${value("replayWorkers")}`));
for (const path of ["../components/landing/recovery-story.tsx", "../app/docs/page.tsx", "../lib/faq.ts"]) {
  const source = read(path);
  assert.match(source, /import.*facts/);
  assert.doesNotMatch(source, /(?:22|11) (?:event|disruption) types|value:\s*22/);
}
console.log("Product facts match event catalog, plan objectives and deterministic solver configuration.");
