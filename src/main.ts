import { TARGETS, generate, type Target } from './codegen.ts';
import { KINDS, assignVars, canHold, find, isAbsolute, make, newId, walk, type Kind, type Node, type Project, type PropDef } from './model.ts';
import { Preview, hit } from './preview.ts';
import { KSA_CAPTURED } from './theme.ts';
import { sample } from './sample.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: (Node_ | string)[]) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && k !== 'list') (e as any)[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
};
type Node_ = globalThis.Node;

// ---- state ----

const STORE = 'imgui-editor/v1';
interface Doc { name: string; target: Target; project: Project }
const load = (): Doc | undefined => {
  try {
    const d = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    return d?.project?.windows ? d : undefined;
  } catch {
    return undefined;
  }
};
let doc: Doc = load() ?? { name: 'my_mod', target: 'csharp', project: sample() };
let sel: string | undefined;
let hover: string | undefined;
let design = true;
const undo: string[] = [];
const redo: string[] = [];

const save = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify(doc));
  } catch { /* private window: the design just isn't remembered */ }
};
const snap = () => JSON.stringify(doc.project);
/** Record the state before a change (for undo), then apply it. */
function change(f: () => void) {
  const before = snap();
  f();
  if (snap() !== before) {
    undo.push(before);
    if (undo.length > 200) undo.shift();
    redo.length = 0;
  }
  refresh();
}
function restore(from: string[], to: string[]) {
  const s = from.pop();
  if (s === undefined) return;
  to.push(snap());
  doc.project = JSON.parse(s);
  if (sel && !find(doc.project, sel)) sel = undefined;
  preview.reset();
  refresh();
}
function refresh() {
  save();
  renderTree();
  renderProps();
  renderCode();
}

const snapTo = (v: number) => {
  const s = Math.max(1, Number(($('snap') as HTMLInputElement).value) || 1);
  return Math.round(v / s) * s;
};

// ---- preview ----

const canvas = $('canvas') as HTMLCanvasElement;
const overlay = $('overlay');
const status = $('status');
const preview = new Preview(canvas, () => ({ project: doc.project, design }));

(async () => {
  let font: Uint8Array | undefined;
  try {
    const buf = await (await fetch(`${import.meta.env.BASE_URL}JetBrainsMono-Regular.ttf`)).arrayBuffer();
    font = new Uint8Array(buf);
    document.fonts.add(new FontFace('JetBrains Mono', buf.slice(0)));
  } catch { /* the default ImGui font is fine */ }
  try {
    await preview.start(font);
    setStatus();
  } catch (e) {
    status.textContent = `Could not start Dear ImGui (WebGL2 needed): ${e}`;
  }
})();

function setStatus(extra = '') {
  status.textContent = (design ? 'Design: drag to move, handles resize, Del deletes, arrows nudge.' : 'Test: the widgets work as in the game.') + (extra ? `  ${extra}` : '');
}

/** Overlay boxes follow the preview every frame (rects come from ImGui's layout). */
const boxes = { hover: el('div', { className: 'box hover' }), sel: el('div', { className: 'box sel' }), drop: el('div', { className: 'box drop' }) };
const handleSE = el('div', { className: 'handle se' });
const handleE = el('div', { className: 'handle e' });
overlay.append(boxes.hover, boxes.drop, boxes.sel);
let dropTarget: string | undefined;

function place(box: HTMLElement, id: string | undefined) {
  const r = id ? preview.placed.rects.get(id) : undefined;
  box.style.display = r ? '' : 'none';
  if (r) Object.assign(box.style, { left: `${r.x0}px`, top: `${r.y0}px`, width: `${r.x1 - r.x0}px`, height: `${r.y1 - r.y0}px` });
}
(function follow() {
  place(boxes.hover, hover !== sel ? hover : undefined);
  place(boxes.sel, sel);
  place(boxes.drop, dropTarget);
  handleSE.remove();
  handleE.remove();
  const f = sel ? find(doc.project, sel) : undefined;
  if (f) {
    const d = KINDS[f.node.kind];
    if (f.node.kind === 'window' && !f.node.p.auto_resize) boxes.sel.append(handleSE);
    else if (['child', 'input_multiline', 'plot_lines', 'plot_histogram'].includes(f.node.kind)) boxes.sel.append(handleSE);
    else if (d.width) boxes.sel.append(handleE);
  }
  requestAnimationFrame(follow);
})();

const allIds = () => {
  const ids: string[] = [];
  walk(doc.project.windows, n => ids.push(n.id));
  return ids;
};
const local = (e: { clientX: number; clientY: number }) => {
  const r = overlay.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

// Moving and resizing with the mouse.
type Drag = { mode: 'move' | 'se' | 'e'; node: Node; x: number; y: number; w: number; h: number; px: number; py: number; before: string };
let drag: Drag | undefined;

overlay.addEventListener('pointerdown', e => {
  if (!design || e.button !== 0) return;
  const pt = local(e);
  const handle = e.target === handleSE ? 'se' : e.target === handleE ? 'e' : undefined;
  const id = handle ? sel : hit(preview.placed, pt.x, pt.y, allIds());
  select(id);
  const f = id ? find(doc.project, id) : undefined;
  if (!f) return;
  const movable = f.node.kind === 'window' || isAbsolute(f.parent);
  if (!handle && !movable) {
    setStatus('Widgets inside headers, trees, tabs, tables and popups flow in order: reorder them in the hierarchy.');
    return;
  }
  const n = f.node;
  let w = n.w, h = n.h;
  const r = preview.placed.rects.get(n.id);
  if (handle && r && !w) w = Math.round(r.x1 - r.x0);
  if (handle && r && !h) h = Math.round(r.y1 - r.y0);
  drag = { mode: handle ?? 'move', node: n, x: n.x, y: n.y, w, h, px: pt.x, py: pt.y, before: snap() };
  overlay.setPointerCapture(e.pointerId);
});
overlay.addEventListener('pointermove', e => {
  const pt = local(e);
  if (!drag) {
    if (design) hover = hit(preview.placed, pt.x, pt.y, allIds());
    return;
  }
  const dx = pt.x - drag.px, dy = pt.y - drag.py, n = drag.node;
  if (drag.mode === 'move') {
    n.x = Math.max(0, snapTo(drag.x + dx));
    n.y = Math.max(0, snapTo(drag.y + dy));
  } else {
    n.w = Math.max(16, snapTo(drag.w + dx));
    if (drag.mode === 'se') n.h = Math.max(16, snapTo(drag.h + dy));
  }
  setStatus(`x ${n.x}  y ${n.y}${n.w ? `  w ${n.w}` : ''}${n.h ? `  h ${n.h}` : ''}`);
});
const endDrag = () => {
  if (!drag) return;
  if (snap() !== drag.before) {
    undo.push(drag.before);
    redo.length = 0;
  }
  drag = undefined;
  setStatus();
  refresh();
};
overlay.addEventListener('pointerup', endDrag);
overlay.addEventListener('pointercancel', endDrag);
overlay.addEventListener('pointerleave', () => { hover = undefined; });

// Dropping new widgets from the palette onto the canvas.
const DRAG_KIND = 'application/x-imgui-kind';
/** The deepest container under the point that can hold `kind`. */
function dropInto(kind: Kind, x: number, y: number): Node | undefined {
  const ids: string[] = [];
  walk(doc.project.windows, (n, parent) => {
    void parent;
    if (canHold(n, kind)) ids.push(n.id);
  });
  const id = hit(preview.placed, x, y, ids);
  return id ? find(doc.project, id)?.node : undefined;
}
overlay.addEventListener('dragover', e => {
  const kind = e.dataTransfer?.types.includes(DRAG_KIND) ? (draggingKind as Kind) : undefined;
  if (!kind || !design) return;
  const pt = local(e);
  const into = dropInto(kind, pt.x, pt.y);
  if (into || kind === 'window') e.preventDefault();
  dropTarget = into?.id;
});
overlay.addEventListener('dragleave', () => { dropTarget = undefined; });
overlay.addEventListener('drop', e => {
  e.preventDefault();
  dropTarget = undefined;
  const kind = (e.dataTransfer?.getData(DRAG_KIND) || draggingKind) as Kind;
  if (!kind || !(kind in KINDS)) return;
  const pt = local(e);
  add(kind, dropInto(kind, pt.x, pt.y), pt);
});
let draggingKind: string | undefined;

/** Adds a new `kind` to `into` (or a sensible place), at the screen point `at` when it's absolutely placed. */
function add(kind: Kind, into?: Node, at?: { x: number; y: number }) {
  if (!into && kind !== 'window') {
    const f = sel ? find(doc.project, sel) : undefined;
    into = f && canHold(f.node, kind) ? f.node : f?.parent && canHold(f.parent, kind) ? f.parent : undefined;
    into ??= doc.project.windows.find(w => canHold(w, kind));
    if (!into) {
      setStatus(`A ${KINDS[kind].label} needs ${KINDS[kind].parent ? `a ${KINDS[KINDS[kind].parent!].label}` : 'a window'} to go in.`);
      return;
    }
  }
  const n = make(kind);
  change(() => {
    if (!into) {
      const k = doc.project.windows.length;
      n.x = snapTo(at?.x ?? 40 + 24 * k);
      n.y = snapTo(at?.y ?? 40 + 24 * k);
      doc.project.windows.push(n);
    } else {
      if (isAbsolute(into)) {
        const o = preview.placed.origins.get(into.id);
        if (at && o) {
          n.x = Math.max(0, snapTo(at.x - o.x));
          n.y = Math.max(0, snapTo(at.y - o.y));
        } else {
          // Below the lowest child.
          const kids = into.children ?? [];
          const r = (id: string) => preview.placed.rects.get(id);
          const bottom = Math.max(into.kind === 'window' ? 30 : 4, ...kids.map(c => (r(c.id) && o ? r(c.id)!.y1 - o.y + 4 : c.y + 24)));
          n.x = 8;
          n.y = snapTo(bottom);
        }
      }
      into.children!.push(n);
    }
    sel = n.id;
  });
}

// ---- palette ----

const palette = $('palette');
for (const group of ['Containers', 'Text', 'Input', 'Display'] as const) {
  const row = el('div');
  for (const [kind, d] of Object.entries(KINDS) as [Kind, (typeof KINDS)[Kind]][]) {
    if (d.group !== group) continue;
    const b = el('button', { draggable: true, title: `Add a ${d.label.toLowerCase()}`, onclick: () => add(kind) }, d.label);
    b.addEventListener('dragstart', e => {
      draggingKind = kind;
      e.dataTransfer!.setData(DRAG_KIND, kind);
      e.dataTransfer!.effectAllowed = 'copy';
    });
    b.addEventListener('dragend', () => { draggingKind = undefined; dropTarget = undefined; });
    row.append(b);
  }
  palette.append(el('div', { className: 'group' }, el('h3', {}, group), row));
}

// ---- hierarchy ----

const tree = $('tree');
const TREE_DRAG = 'application/x-imgui-node';
function renderTree() {
  tree.replaceChildren();
  const row = (n: Node, depth: number, siblings: Node[], parent?: Node) => {
    const d = KINDS[n.kind];
    const name = n.p.title ?? n.p.label ?? n.p.text ?? n.p.id ?? '';
    const tool = (label: string, title: string, f: () => void) => el('button', { title, onclick: (e: Event) => { e.stopPropagation(); f(); } }, label);
    const i = siblings.indexOf(n);
    const item = el('div', { className: `item${n.id === sel ? ' sel' : ''}`, role: 'treeitem', draggable: true, style: `padding-left:${4 + depth * 14}px`, onclick: () => select(n.id) },
      el('span', { className: 'k' }, d.label),
      el('span', {}, String(name).slice(0, 28)),
      el('span', { className: 'tools' },
        tool('↑', 'Move up', () => i > 0 && change(() => siblings.splice(i - 1, 0, ...siblings.splice(i, 1)))),
        tool('↓', 'Move down', () => i < siblings.length - 1 && change(() => siblings.splice(i + 1, 0, ...siblings.splice(i, 1)))),
        tool('⧉', 'Duplicate (Ctrl+D)', () => duplicate(n.id)),
        tool('✕', 'Delete (Del)', () => remove(n.id)),
      ),
    );
    // Drag a row onto another: into it when it can hold it, otherwise before it.
    item.addEventListener('dragstart', e => { e.dataTransfer!.setData(TREE_DRAG, n.id); e.stopPropagation(); });
    item.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes(TREE_DRAG)) { e.preventDefault(); item.classList.add('drop'); } });
    item.addEventListener('dragleave', () => item.classList.remove('drop'));
    item.addEventListener('drop', e => {
      e.preventDefault();
      item.classList.remove('drop');
      const from = find(doc.project, e.dataTransfer!.getData(TREE_DRAG));
      if (!from || from.node === n) return;
      let inside: Node | undefined = n;
      for (let p: Node | undefined = n; p; p = find(doc.project, p.id)?.parent) if (p === from.node) inside = undefined; // not into itself
      if (!inside) return;
      const k = from.node.kind;
      if (canHold(n, k)) change(() => { from.siblings.splice(from.siblings.indexOf(from.node), 1); n.children!.push(from.node); });
      else if (canHold(parent, k) || (!parent && k === 'window')) change(() => { from.siblings.splice(from.siblings.indexOf(from.node), 1); siblings.splice(siblings.indexOf(n), 0, from.node); });
    });
    tree.append(item);
    for (const c of n.children ?? []) row(c, depth + 1, n.children!, n);
  };
  for (const w of doc.project.windows) row(w, 0, doc.project.windows);
  if (!doc.project.windows.length) tree.append(el('p', { className: 'hint' }, 'Empty. Add a Window first.'));
}

// ---- properties ----

const props = $('props');
function renderProps() {
  const f = sel ? find(doc.project, sel) : undefined;
  if (!f) {
    props.replaceChildren(el('p', { className: 'hint' }, 'Select a widget on the canvas or in the hierarchy.'));
    return;
  }
  const n = f.node, d = KINDS[n.kind];
  let before = '';
  const edit = (apply: (v: any) => void, resetState = false) => ({
    onfocus: () => { before = snap(); },
    oninput: (e: Event) => {
      const t = e.target as HTMLInputElement;
      apply(t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value);
      if (resetState) preview.reset(n.id);
      save();
      renderCode();
    },
    onchange: () => {
      if (before && snap() !== before) { undo.push(before); redo.length = 0; }
      before = snap();
      renderTree();
    },
  });
  const field = (def: PropDef) => {
    const val = n.p[def.key];
    const resetState = def.key === 'value' || def.key === 'items';
    let input: HTMLElement;
    switch (def.type) {
      case 'bool': input = el('input', { type: 'checkbox', checked: !!val, ...edit(v => (n.p[def.key] = v), resetState) }); break;
      case 'number': input = el('input', { type: 'number', step: 'any', value: val ?? 0, ...edit(v => (n.p[def.key] = v), resetState) }); break;
      case 'int': input = el('input', { type: 'number', step: 1, value: val ?? 0, ...edit(v => (n.p[def.key] = Math.trunc(v)), resetState) }); break;
      case 'text': input = el('textarea', { value: val ?? '', spellcheck: false, ...edit(v => (n.p[def.key] = v), resetState) }); break;
      case 'color': {
        const c = (val ?? [1, 1, 1, 1]) as number[];
        const hex = '#' + c.slice(0, 3).map(x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
        input = el('input', { type: 'color', value: hex, ...edit(v => { const h = String(v); n.p[def.key] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).concat([c[3] ?? 1]); }, resetState) });
        break;
      }
      default: input = el('input', { value: val ?? '', spellcheck: false, ...edit(v => (n.p[def.key] = v), resetState) });
    }
    return el('label', { className: 'row' }, def.label, input);
  };
  const num = (key: 'x' | 'y' | 'w' | 'h', label: string) => el('label', {}, label, el('input', { type: 'number', step: 1, value: n[key], ...edit(v => (n[key] = Math.max(0, Math.trunc(v)))) }));
  const rows: HTMLElement[] = [el('div', { className: 'kind' }, d.label)];
  const abs = n.kind === 'window' || isAbsolute(f.parent);
  const sized = n.kind === 'window' || ['child', 'input_multiline', 'plot_lines', 'plot_histogram'].includes(n.kind);
  const geo = [...(abs ? [num('x', 'X'), num('y', 'Y')] : []), ...(sized || d.width ? [num('w', d.width && !sized ? 'Width (0 auto)' : 'Width')] : []), ...(sized ? [num('h', 'Height')] : [])];
  if (geo.length) rows.push(el('div', { className: 'xy' }, ...geo));
  if (!abs && f.parent?.kind !== 'table' && f.parent?.kind !== 'tab_bar') rows.push(field({ key: 'same_line', label: 'Same line', type: 'bool' }));
  for (const def of d.props) rows.push(field(def));
  const v = assignVars(doc.project).byNode.get(n.id);
  if (v && n.kind !== 'radio') rows.push(el('label', { className: 'row' }, 'Variable', el('input', { value: n.p.var ?? '', placeholder: v.name, spellcheck: false, ...edit(x => (n.p.var = x)) })));
  if (n.kind === 'window' && n.p.auto_resize) rows.push(el('p', { className: 'hint' }, 'Auto resize ignores the size.'));
  rows.push(el('div', { className: 'code-actions' }, el('button', { onclick: () => duplicate(n.id) }, 'Duplicate'), el('button', { className: 'danger', onclick: () => remove(n.id) }, 'Delete')));
  props.replaceChildren(...rows);
}

function select(id: string | undefined) {
  if (id === sel) return;
  sel = id;
  renderTree();
  renderProps();
}
function remove(id: string) {
  const f = find(doc.project, id);
  if (!f) return;
  change(() => {
    f.siblings.splice(f.siblings.indexOf(f.node), 1);
    if (sel === id) sel = f.parent?.id;
  });
}
function duplicate(id: string) {
  const f = find(doc.project, id);
  if (!f) return;
  const copy: Node = structuredClone(f.node);
  walk([copy], n => { n.id = newId(); delete n.p.var; });
  if (f.node.kind === 'window' || isAbsolute(f.parent)) { copy.x += 16; copy.y += 16; }
  change(() => {
    f.siblings.splice(f.siblings.indexOf(f.node) + 1, 0, copy);
    sel = copy.id;
  });
}

// ---- code ----

const targetSel = $('target') as HTMLSelectElement;
const modName = $('modname') as HTMLInputElement;
const code = $('code').firstElementChild as HTMLElement;
const NOTES: Record<Target, string> = {
  csharp: 'One file for a StarMap mod (needs Harmony).',
  rust: 'A module for an Oxidizer Rust mod.',
  rhai: 'Merge into your mod\'s main.rhai.',
  cpp: 'Plain Dear ImGui.',
  c: 'cimgui (C bindings).',
};
for (const t of TARGETS) targetSel.append(el('option', { value: t.id }, t.label));
function renderCode() {
  targetSel.value = doc.target;
  modName.value = doc.name;
  code.textContent = generate(doc.project, doc.target, { name: doc.name });
  const game = doc.target !== 'c' && doc.target !== 'cpp';
  preview.setTheme(game ? 'ksa' : 'default');
  $('code-note').textContent = `${NOTES[doc.target]} Preview: ${game ? (KSA_CAPTURED ? 'KSA style' : 'KSA font (game colors not captured yet)') : 'default Dear ImGui style'}.`;
}
targetSel.addEventListener('change', () => { doc.target = targetSel.value as Target; save(); renderCode(); });
modName.addEventListener('input', () => { doc.name = modName.value; save(); code.textContent = generate(doc.project, doc.target, { name: doc.name }); });
$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(code.textContent ?? '');
    $('code-note').textContent = 'Copied.';
  } catch {
    $('code-note').textContent = 'Copy failed: select the code and copy it.';
  }
});
const download = (name: string, text: string, type = 'text/plain') => {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('download').addEventListener('click', () => {
  const t = TARGETS.find(t => t.id === doc.target)!;
  download(`${doc.name || 'my_mod'}.${t.ext}`, code.textContent ?? '');
});

// ---- toolbar and keys ----

const setMode = (d: boolean) => {
  design = d;
  $('mode-design').classList.toggle('on', d);
  $('mode-test').classList.toggle('on', !d);
  overlay.classList.toggle('test', !d);
  if (d) preview.reset();
  hover = undefined;
  setStatus();
};
$('mode-design').addEventListener('click', () => setMode(true));
$('mode-test').addEventListener('click', () => setMode(false));
$('undo').addEventListener('click', () => restore(undo, redo));
$('redo').addEventListener('click', () => restore(redo, undo));
$('new').addEventListener('click', () => change(() => { doc.project = { windows: [make('window', 40, 40)] }; sel = doc.project.windows[0].id; }));
$('export').addEventListener('click', () => download(`${doc.name || 'design'}.imgui.json`, JSON.stringify({ format: 'imgui-editor', version: 1, ...doc }, null, 2), 'application/json'));
$('import').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async e => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d?.project?.windows)) throw new Error('not an ImGui Editor design');
    change(() => {
      doc = { name: String(d.name ?? 'my_mod'), target: TARGETS.some(t => t.id === d.target) ? d.target : 'csharp', project: d.project };
      sel = undefined;
    });
    preview.reset();
  } catch (err) {
    setStatus(`Could not open ${file.name}: ${err}`);
  }
  (e.target as HTMLInputElement).value = '';
});

document.addEventListener('keydown', e => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); restore(e.shiftKey ? redo : undo, e.shiftKey ? undo : redo); return; }
  if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); restore(redo, undo); return; }
  if (typing || !design) return;
  if (mod && e.key.toLowerCase() === 'd' && sel) { e.preventDefault(); duplicate(sel); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); remove(sel); return; }
  if (e.key === 'Escape') { select(undefined); return; }
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const f = sel ? find(doc.project, sel) : undefined;
  if (arrows[e.key] && f && (f.node.kind === 'window' || isAbsolute(f.parent))) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    change(() => { f.node.x = Math.max(0, f.node.x + arrows[e.key][0] * step); f.node.y = Math.max(0, f.node.y + arrows[e.key][1] * step); });
  }
});

refresh();
