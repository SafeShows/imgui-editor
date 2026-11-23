// The design: windows holding widgets. Widgets directly in a window or child region are placed absolutely (x, y
// from the content's top-left, i.e. SetCursorPos); inside every other container they flow top to bottom, with an
// optional same-line flag.

export type Kind =
  | 'window' | 'child' | 'header' | 'tree' | 'tab_bar' | 'tab' | 'table' | 'popup'
  | 'text' | 'text_colored' | 'text_wrapped' | 'button' | 'checkbox' | 'radio'
  | 'slider_float' | 'slider_int' | 'drag_float' | 'drag_int'
  | 'input_text' | 'input_multiline' | 'input_double' | 'input_int'
  | 'combo' | 'list_box' | 'color_edit' | 'progress' | 'selectable'
  | 'plot_lines' | 'plot_histogram' | 'separator' | 'spacing';

export type Props = Record<string, any>;

export interface Node {
  id: string;
  kind: Kind;
  x: number;
  y: number;
  /** Item width in pixels (0: ImGui's default). For windows and child regions: their size. */
  w: number;
  h: number;
  p: Props;
  children?: Node[];
}

export interface Project {
  windows: Node[];
}

export type PropType = 'string' | 'text' | 'number' | 'int' | 'bool' | 'color' | 'list' | 'numbers';
export interface PropDef { key: string; label: string; type: PropType }

/** The kind of state a widget keeps between frames (its variable's type). */
export type State = 'bool' | 'int' | 'float' | 'double' | 'string' | 'color';

export interface KindDef {
  label: string;
  group: 'Containers' | 'Text' | 'Input' | 'Display';
  container?: boolean;
  /** Children are absolutely placed (window, child) rather than flowing. */
  absolute?: boolean;
  /** Only allowed inside this kind. */
  parent?: Kind;
  /** Only this kind of children. */
  only?: Kind;
  state?: State;
  /** Honors SetNextItemWidth. */
  width?: boolean;
  defaults: Props;
  props: PropDef[];
  w?: number;
  h?: number;
}

const label: PropDef = { key: 'label', label: 'Label', type: 'string' };
const tip: PropDef = { key: 'tooltip', label: 'Tooltip', type: 'string' };
const v = (type: PropType): PropDef => ({ key: 'value', label: 'Initial value', type });
const items: PropDef = { key: 'items', label: 'Items (comma separated)', type: 'list' };

export const KINDS: Record<Kind, KindDef> = {
  window: {
    label: 'Window', group: 'Containers', container: true, absolute: true, w: 360, h: 260,
    defaults: { title: 'My window', no_title: false, no_resize: false, no_move: false, no_collapse: false, auto_resize: false, closable: false },
    props: [
      { key: 'title', label: 'Title', type: 'string' },
      { key: 'no_title', label: 'No title bar', type: 'bool' },
      { key: 'no_resize', label: 'No resize', type: 'bool' },
      { key: 'no_move', label: 'No move', type: 'bool' },
      { key: 'no_collapse', label: 'No collapse', type: 'bool' },
      { key: 'auto_resize', label: 'Auto resize', type: 'bool' },
      { key: 'closable', label: 'Close button', type: 'bool' },
    ],
  },
  child: {
    label: 'Child region', group: 'Containers', container: true, absolute: true, w: 200, h: 120,
    defaults: { id: 'child', border: true }, props: [{ key: 'id', label: 'Id', type: 'string' }, { key: 'border', label: 'Border', type: 'bool' }],
  },
  header: { label: 'Collapsing header', group: 'Containers', container: true, defaults: { label: 'Section' }, props: [label] },
  tree: { label: 'Tree node', group: 'Containers', container: true, defaults: { label: 'Node' }, props: [label] },
  tab_bar: { label: 'Tab bar', group: 'Containers', container: true, only: 'tab', defaults: { id: 'tabs' }, props: [{ key: 'id', label: 'Id', type: 'string' }] },
  tab: { label: 'Tab', group: 'Containers', container: true, parent: 'tab_bar', defaults: { label: 'Tab' }, props: [label] },
  table: {
    label: 'Table', group: 'Containers', container: true,
    defaults: { id: 'table', columns: 'Name,Value', headers: true, borders: true, row_bg: false },
    props: [
      { key: 'id', label: 'Id', type: 'string' },
      { key: 'columns', label: 'Columns (comma separated)', type: 'list' },
      { key: 'headers', label: 'Header row', type: 'bool' },
      { key: 'borders', label: 'Borders', type: 'bool' },
      { key: 'row_bg', label: 'Row stripes', type: 'bool' },
    ],
  },
  popup: {
    label: 'Popup button', group: 'Containers', container: true,
    defaults: { label: 'Open…', id: 'popup' }, props: [{ key: 'label', label: 'Button label', type: 'string' }, { key: 'id', label: 'Popup id', type: 'string' }, tip],
  },

  text: { label: 'Text', group: 'Text', defaults: { text: 'Hello, kittens!' }, props: [{ key: 'text', label: 'Text', type: 'text' }, tip] },
  text_colored: { label: 'Colored text', group: 'Text', defaults: { text: 'Warning', color: [1, 0.8, 0.2, 1] }, props: [{ key: 'text', label: 'Text', type: 'text' }, { key: 'color', label: 'Color', type: 'color' }, tip] },
  text_wrapped: { label: 'Wrapped text', group: 'Text', defaults: { text: 'A longer paragraph that wraps at the edge of the window.' }, props: [{ key: 'text', label: 'Text', type: 'text' }, tip] },
  separator: { label: 'Separator', group: 'Text', defaults: {}, props: [] },
  spacing: { label: 'Spacing', group: 'Text', defaults: {}, props: [] },

  button: { label: 'Button', group: 'Input', defaults: { label: 'Button' }, props: [label, tip] },
  checkbox: { label: 'Checkbox', group: 'Input', state: 'bool', defaults: { label: 'Enabled', value: true }, props: [label, v('bool'), tip] },
  radio: {
    label: 'Radio button', group: 'Input', defaults: { label: 'Option A', group: 'mode', option: 0, value: 0 },
    props: [label, { key: 'group', label: 'Group variable', type: 'string' }, { key: 'option', label: 'This option\'s number', type: 'int' }, { key: 'value', label: 'Group\'s initial value', type: 'int' }, tip],
  },
  slider_float: { label: 'Slider (float)', group: 'Input', state: 'float', width: true, defaults: { label: 'Throttle', value: 0.5, min: 0, max: 1 }, props: [label, v('number'), { key: 'min', label: 'Min', type: 'number' }, { key: 'max', label: 'Max', type: 'number' }, tip] },
  slider_int: { label: 'Slider (int)', group: 'Input', state: 'int', width: true, defaults: { label: 'Stage', value: 1, min: 0, max: 10 }, props: [label, v('int'), { key: 'min', label: 'Min', type: 'int' }, { key: 'max', label: 'Max', type: 'int' }, tip] },
  drag_float: { label: 'Drag (float)', group: 'Input', state: 'float', width: true, defaults: { label: 'Offset', value: 0, speed: 0.1, min: 0, max: 0 }, props: [label, v('number'), { key: 'speed', label: 'Speed', type: 'number' }, { key: 'min', label: 'Min (= max: none)', type: 'number' }, { key: 'max', label: 'Max', type: 'number' }, tip] },
  drag_int: { label: 'Drag (int)', group: 'Input', state: 'int', width: true, defaults: { label: 'Count', value: 0, speed: 1, min: 0, max: 0 }, props: [label, v('int'), { key: 'speed', label: 'Speed', type: 'number' }, { key: 'min', label: 'Min (= max: none)', type: 'int' }, { key: 'max', label: 'Max', type: 'int' }, tip] },
  input_text: { label: 'Text field', group: 'Input', state: 'string', width: true, defaults: { label: 'Name', value: '' }, props: [label, v('string'), tip] },
  input_multiline: { label: 'Text box', group: 'Input', state: 'string', w: 240, h: 80, defaults: { label: '##notes', value: '' }, props: [label, v('text'), tip] },
  input_double: { label: 'Number field', group: 'Input', state: 'double', width: true, defaults: { label: 'Altitude', value: 0 }, props: [label, v('number'), tip] },
  input_int: { label: 'Int field', group: 'Input', state: 'int', width: true, defaults: { label: 'Count', value: 0 }, props: [label, v('int'), tip] },
  combo: { label: 'Combo', group: 'Input', state: 'int', width: true, defaults: { label: 'Mode', items: 'Prograde,Retrograde,Normal', value: 0 }, props: [label, items, { key: 'value', label: 'Initial index', type: 'int' }, tip] },
  list_box: { label: 'List box', group: 'Input', state: 'int', width: true, defaults: { label: 'Targets', items: 'Earth,Luna,Mars', value: 0, rows: 4 }, props: [label, items, { key: 'value', label: 'Initial index', type: 'int' }, { key: 'rows', label: 'Rows shown', type: 'int' }, tip] },
  color_edit: { label: 'Color edit', group: 'Input', state: 'color', width: true, defaults: { label: 'Color', value: [0.3, 0.6, 1, 1] }, props: [label, v('color'), tip] },
  selectable: { label: 'Selectable', group: 'Input', state: 'bool', defaults: { label: 'Item', value: false }, props: [label, v('bool'), tip] },

  progress: { label: 'Progress bar', group: 'Display', defaults: { fraction: 0.4, overlay: '' }, props: [{ key: 'fraction', label: 'Fraction', type: 'number' }, { key: 'overlay', label: 'Overlay text', type: 'string' }, tip] },
  plot_lines: { label: 'Plot (lines)', group: 'Display', h: 60, defaults: { label: '##plot', values: '0,1,3,2,5,4,6' }, props: [label, { key: 'values', label: 'Values (comma separated)', type: 'numbers' }, tip] },
  plot_histogram: { label: 'Plot (bars)', group: 'Display', h: 60, defaults: { label: '##hist', values: '1,3,2,5,4' }, props: [label, { key: 'values', label: 'Values (comma separated)', type: 'numbers' }, tip] },
};

/** Plain layout props every node has, shown in the inspector. */
export const SAME_LINE: PropDef = { key: 'same_line', label: 'Same line as previous', type: 'bool' };

let counter = 0;
export const newId = () => `n${Date.now().toString(36)}${(counter++).toString(36)}`;

export function make(kind: Kind, x = 8, y = 8): Node {
  const d = KINDS[kind];
  const n: Node = { id: newId(), kind, x, y, w: d.w ?? 0, h: d.h ?? 0, p: structuredClone(d.defaults) };
  if (d.container) n.children = [];
  if (kind === 'tab_bar') n.children!.push(make('tab'));
  return n;
}

export const list = (s: string): string[] => String(s ?? '').split(',').map(x => x.trim()).filter(Boolean);
export const numbers = (s: string): number[] => list(s).map(Number).filter(n => !Number.isNaN(n));

/** Whether children of `parent` are absolutely placed. */
export const isAbsolute = (parent: Node | undefined) => !!parent && !!KINDS[parent.kind].absolute;

export function walk(nodes: Node[], f: (n: Node, parent: Node | undefined) => void, parent?: Node) {
  for (const n of nodes) {
    f(n, parent);
    if (n.children) walk(n.children, f, n);
  }
}

export function find(p: Project, id: string): { node: Node; parent?: Node; siblings: Node[] } | undefined {
  let out: { node: Node; parent?: Node; siblings: Node[] } | undefined;
  const go = (nodes: Node[], parent?: Node) => {
    for (const n of nodes) {
      if (out) return;
      if (n.id === id) out = { node: n, parent, siblings: nodes };
      else if (n.children) go(n.children, n);
    }
  };
  go(p.windows);
  return out;
}

/** Can a `kind` be put inside `parent` (undefined: top level)? */
export function canHold(parent: Node | undefined, kind: Kind): boolean {
  if (!parent) return kind === 'window';
  if (kind === 'window') return false;
  const pd = KINDS[parent.kind];
  if (!pd.container) return false;
  if (pd.only) return kind === pd.only;
  const need = KINDS[kind].parent;
  return !need || need === parent.kind;
}

/** A variable name from a label: "Show orbit##x" -> "show_orbit". */
export function ident(s: string, fallback: string): string {
  const parts = String(s ?? '').split('##');
  const base = (parts[0].trim() ? parts[0] : parts.slice(1).join('_')).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const id = base || fallback;
  return /^[0-9]/.test(id) ? `v_${id}` : id;
}

export const RESERVED = new Set(['self', 'this', 'type', 'fn', 'let', 'mut', 'ref', 'in', 'is', 'as', 'if', 'else', 'for', 'while', 'loop', 'match', 'return', 'true', 'false', 'null', 'new', 'class', 'struct', 'static', 'const', 'default', 'move', 'mod', 'use', 'impl', 'string', 'int', 'float', 'bool', 'double', 'char', 'object', 'base', 'event', 'open', 'end', 'begin']);

export interface Var { name: string; state: State; init: any }

/**
 * Unique variable names for the design's state: node id -> variable, for stateful widgets and closable windows
 * (their "open" flag). Radio buttons of one group share one int variable. `node.p.var` overrides the name.
 */
export function assignVars(p: Project): { byNode: Map<string, Var>; all: Var[] } {
  const taken = new Set<string>();
  const groups = new Map<string, Var>();
  const byNode = new Map<string, Var>();
  const all: Var[] = [];
  const take = (want: string, state: State, init: any): Var => {
    let name = RESERVED.has(want) ? `${want}_` : want;
    for (let i = 2; taken.has(name); i++) name = `${want}_${i}`;
    taken.add(name);
    const v = { name, state, init };
    all.push(v);
    return v;
  };
  walk(p.windows, n => {
    const d = KINDS[n.kind];
    if (n.kind === 'radio') {
      const g = ident(n.p.group, 'mode');
      if (!groups.has(g)) groups.set(g, take(g, 'int', n.p.value ?? 0));
      byNode.set(n.id, groups.get(g)!);
    } else if (d.state) {
      byNode.set(n.id, take(ident(n.p.var || n.p.label, n.kind), d.state, n.p.value));
    } else if (n.kind === 'window') {
      byNode.set(n.id, take(ident(n.p.var || `show_${ident(n.p.title, 'window')}`, 'show_window'), 'bool', true));
    }
  });
  return { byNode, all };
}
