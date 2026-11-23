// Run with `npm test`. Checks the generators on a design with every widget; with OUT=<dir>, also writes the
// generated files there so they can be compiled (see README: Rust against oxidizer_api, C# against the game).
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TARGETS, fl, generate, q } from './codegen.ts';
import { assignVars, make } from './model.ts';
import { sample } from './sample.ts';

assert.equal(fl(1), '1.0');
assert.equal(fl(0.5), '0.5');
assert.equal(q('a"b\\c\nd'), '"a\\"b\\\\c\\nd"');

// Names: unique, from labels, radios of a group share one int.
const p = sample();
const { byNode, all } = assignVars(p);
const names = all.map(v => v.name);
assert.equal(new Set(names).size, names.length, 'variable names are unique');
assert.ok(names.includes('frame') && names.includes('warp_guard') && names.includes('show_flight_panel'));
const radios: string[] = [];
JSON.stringify(p, (_k, v) => (v?.kind === 'radio' && radios.push(byNode.get(v.id)!.name), v));
assert.deepEqual(radios, ['frame', 'frame']);

const balanced = (s: string) => {
  let depth = 0;
  for (const ch of s.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\/\/.*$/gm, '')) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    assert.ok(depth >= 0, 'closing brace without opening');
  }
  return depth === 0;
};

for (const t of TARGETS) {
  const code = generate(p, t.id, { name: 'flight_ui' });
  assert.ok(balanced(code), `${t.id}: braces balance`);
  // Every Begin-like call that must be paired is paired.
  const count = (re: RegExp) => (code.match(re) ?? []).length;
  if (t.id === 'cpp') {
    assert.equal(count(/ImGui::Begin\(/g), count(/ImGui::End\(\)/g));
    assert.equal(count(/ImGui::TreeNode\(/g), count(/ImGui::TreePop\(\)/g));
    assert.ok(code.includes('"Stage 1\\0" "2\\0"'), 'combo/list items do not form octal escapes');
  }
  if (t.id === 'rust') assert.ok(code.includes('Needs oxidizer_api 0.9'));
  if (t.id === 'csharp') assert.ok(code.includes('[HarmonyPatch(typeof(Program), "DrawProgramMenusHook")]'));
  if (t.id === 'rhai') assert.ok(code.includes('this.frame = 0;') && code.includes('if radio_button("Orbit", this.frame == 1) { this.frame = 1; }'));
  if (process.env.OUT) {
    mkdirSync(process.env.OUT, { recursive: true });
    writeFileSync(join(process.env.OUT, `flight_ui.${t.ext}`), code);
  }
}

// An empty window still produces valid code.
for (const t of TARGETS) assert.ok(balanced(generate({ windows: [make('window')] }, t.id, { name: 'x' })));

console.log('codegen ok');
