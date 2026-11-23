import { KINDS, assignVars, ident, isAbsolute, list, numbers, type Node, type Project, type Var } from './model.ts';

export type Target = 'csharp' | 'rust' | 'rhai' | 'cpp' | 'c';

export const TARGETS: { id: Target; label: string; ext: string; hl: string }[] = [
  { id: 'csharp', label: 'C# (StarMap + BRUTAL)', ext: 'cs', hl: 'csharp' },
  { id: 'rust', label: 'Rust (Oxidizer)', ext: 'rs', hl: 'rust' },
  { id: 'rhai', label: 'Rhai (Oxidizer)', ext: 'rhai', hl: 'rust' },
  { id: 'cpp', label: 'C++ (Dear ImGui)', ext: 'cpp', hl: 'cpp' },
  { id: 'c', label: 'C (cimgui)', ext: 'c', hl: 'c' },
];

// ---- literals ----

/** A double-quoted string literal (the same escapes work in every target). */
export const q = (s: string) => '"' + String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';

/** A float literal with a decimal point ("1" -> "1.0"); Rust and Rhai need it to be a float. */
export const fl = (n: number) => {
  const s = String(Number(n) || 0);
  return /[.eE]/.test(s) || s.includes('Infinity') || s === 'NaN' ? s : `${s}.0`;
};
const int = (n: any) => String(Math.trunc(Number(n) || 0));
const color = (c: any): number[] => (Array.isArray(c) ? c : [1, 1, 1, 1]).concat([1, 1, 1, 1]).slice(0, 4).map(Number);

/** C/C++ items separated by zeros: adjacent literals, so a digit after \0 isn't read as an octal escape. */
const zeroSep = (items: string[]) => items.map(i => q(i).slice(0, -1) + '\\0"').join(' ') || '"\\0"';

const pascal = (s: string) => s.split(/[^A-Za-z0-9]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join('') || 'MyMod';
const camel = (s: string) => {
  const p = pascal(s);
  return p[0].toLowerCase() + p.slice(1);
};

// ---- the language tables ----

/** One container's code: `pre` lines, then (if `cond`) `if cond { head, children, tail }`, then `post`. */
interface Box {
  guard?: string;
  pre?: string[];
  cond?: string;
  head?: string[];
  /** Before each child (tables: next cell). */
  each?: string[];
  tail?: string[];
  post?: string[];
}

interface Lang {
  allman?: boolean;
  /** `if (c)` or `if c`, without the brace. */
  if(c: string): string;
  ref(v: Var): string;
  cursor(x: number, y: number): string;
  sameLine: string;
  width(w: number): string;
  /** Widgets that size themselves (KSA rows), so no SetNextItemWidth. */
  ownWidth?(n: Node): boolean;
  tooltip(t: string): string;
  leaf(n: Node, v: Var | undefined): string[];
  box(n: Node, v: Var | undefined): Box;
}

const winFlags = (n: Node) =>
  ([['no_title', 'NoTitleBar', 1], ['no_resize', 'NoResize', 2], ['no_move', 'NoMove', 4], ['no_collapse', 'NoCollapse', 32], ['auto_resize', 'AlwaysAutoResize', 64]] as const).filter(([k]) => n.p[k]);
const tableFlags = (n: Node) => ([['borders', 'Borders', 1920], ['row_bg', 'RowBg', 64]] as const).filter(([k]) => n.p[k]);
const cols = (n: Node) => list(n.p.columns);
const ncols = (n: Node) => Math.max(1, cols(n).length);

function cFamily(c: boolean): Lang {
  // C++: ImGui::Name(...) with ImVec2(...); C (cimgui): igName_Overload(...) with (ImVec2){...}.
  const ns = (f: string, cf = f) => (c ? `ig${cf}` : `ImGui::${f}`);
  const v2 = (x: number, y: number) => (c ? `(ImVec2){${fl(x)}f, ${fl(y)}f}` : `ImVec2(${fl(x)}f, ${fl(y)}f)`);
  const nul = c ? 'NULL' : 'nullptr';
  const or = (xs: readonly (readonly [string, string, number])[], prefix: string) => xs.map(x => `${prefix}_${x[1]}`).join(' | ') || '0';
  const f = (n: number) => `${fl(n)}f`;
  const arr = (vals: string[]) => `{ ${vals.join(', ')} }`;
  return {
    if: cond => `if (${cond})`,
    ref: v => v.name,
    cursor: (x, y) => `${ns('SetCursorPos')}(${v2(x, y)});`,
    sameLine: c ? 'igSameLine(0.0f, -1.0f);' : 'ImGui::SameLine();',
    width: w => `${ns('SetNextItemWidth')}(${f(w)});`,
    tooltip: t => `${ns('SetItemTooltip')}("%s", ${q(t)});`,
    leaf(n, v) {
      const p = n.p, L = q(p.label), r = v?.name ?? '';
      switch (n.kind) {
        case 'text': return [c ? `igTextUnformatted(${q(p.text)}, NULL);` : `ImGui::TextUnformatted(${q(p.text)});`];
        case 'text_colored': { const k = color(p.color); return [`${ns('TextColored')}(${c ? `(ImVec4){${k.map(f).join(', ')}}` : `ImVec4(${k.map(f).join(', ')})`}, "%s", ${q(p.text)});`]; }
        case 'text_wrapped': return [`${ns('TextWrapped')}("%s", ${q(p.text)});`];
        case 'separator': return [`${ns('Separator')}();`];
        case 'spacing': return [`${ns('Spacing')}();`];
        case 'button': return [`if (${c ? `igButton(${L}, (ImVec2){0, 0})` : `ImGui::Button(${L})`}) { /* clicked */ }`];
        case 'checkbox': return [`${ns('Checkbox')}(${L}, &${r});`];
        case 'radio': return [`if (${ns('RadioButton', 'RadioButton_Bool')}(${L}, ${r} == ${int(p.option)})) ${r} = ${int(p.option)};`];
        case 'slider_float': return [c ? `igSliderFloat(${L}, &${r}, ${f(p.min)}, ${f(p.max)}, "%.3f", 0);` : `ImGui::SliderFloat(${L}, &${r}, ${f(p.min)}, ${f(p.max)});`];
        case 'slider_int': return [c ? `igSliderInt(${L}, &${r}, ${int(p.min)}, ${int(p.max)}, "%d", 0);` : `ImGui::SliderInt(${L}, &${r}, ${int(p.min)}, ${int(p.max)});`];
        case 'drag_float': return [c ? `igDragFloat(${L}, &${r}, ${f(p.speed)}, ${f(p.min)}, ${f(p.max)}, "%.3f", 0);` : `ImGui::DragFloat(${L}, &${r}, ${f(p.speed)}, ${f(p.min)}, ${f(p.max)});`];
        case 'drag_int': return [c ? `igDragInt(${L}, &${r}, ${f(p.speed)}, ${int(p.min)}, ${int(p.max)}, "%d", 0);` : `ImGui::DragInt(${L}, &${r}, ${f(p.speed)}, ${int(p.min)}, ${int(p.max)});`];
        case 'input_text': return [c ? `igInputText(${L}, ${r}, sizeof(${r}), 0, NULL, NULL);` : `ImGui::InputText(${L}, ${r}, IM_ARRAYSIZE(${r}));`];
        case 'input_multiline': return [c ? `igInputTextMultiline(${L}, ${r}, sizeof(${r}), ${v2(n.w, n.h)}, 0, NULL, NULL);` : `ImGui::InputTextMultiline(${L}, ${r}, IM_ARRAYSIZE(${r}), ${v2(n.w, n.h)});`];
        case 'input_double': return [c ? `igInputDouble(${L}, &${r}, 0.0, 0.0, "%.6f", 0);` : `ImGui::InputDouble(${L}, &${r});`];
        case 'input_int': return [c ? `igInputInt(${L}, &${r}, 1, 100, 0);` : `ImGui::InputInt(${L}, &${r});`];
        case 'combo': return [c ? `igCombo_Str(${L}, &${r}, ${zeroSep(list(p.items))}, -1);` : `ImGui::Combo(${L}, &${r}, ${zeroSep(list(p.items))});`];
        case 'list_box': return [
          '{',
          `    static const char* items[] = ${arr(list(p.items).map(q))};`,
          `    ${ns('ListBox', 'ListBox_Str_arr')}(${L}, &${r}, items, ${c ? 'sizeof(items) / sizeof(items[0])' : 'IM_ARRAYSIZE(items)'}, ${int(p.rows)});`,
          '}',
        ];
        case 'color_edit': return [c ? `igColorEdit4(${L}, ${r}, 0);` : `ImGui::ColorEdit4(${L}, ${r});`];
        case 'selectable': return [c ? `igSelectable_BoolPtr(${L}, &${r}, 0, (ImVec2){0, 0});` : `ImGui::Selectable(${L}, &${r});`];
        case 'progress': return [`${ns('ProgressBar')}(${f(p.fraction)}, ${v2(-1.17549435e-38, 0).replace('-1.17549435e-38f', '-FLT_MIN')}, ${p.overlay ? q(p.overlay) : nul});`];
        case 'plot_lines':
        case 'plot_histogram': {
          const fn = n.kind === 'plot_lines' ? 'PlotLines' : 'PlotHistogram';
          return [
            '{',
            `    static const float values[] = ${arr(numbers(p.values).map(f))};`,
            `    ${ns(fn, `${fn}_FloatPtr`)}(${L}, values, ${c ? 'sizeof(values) / sizeof(values[0])' : 'IM_ARRAYSIZE(values)'}, 0, ${nul}, FLT_MAX, FLT_MAX, ${v2(n.w, n.h)}${c ? ', sizeof(float)' : ''});`,
            '}',
          ];
        }
        case 'readout': return [`${ns('Text')}("%s  %s", ${q(p.key)}, ${q(p.value)});`];
        case 'region_header': return [`${ns('SeparatorText')}(${q(p.label)});`];
        case 'segmented': return list(p.items).flatMap((it, k, all) => [`if (${ns('RadioButton', 'RadioButton_Bool')}(${q(it)}, ${r} == ${k})) ${r} = ${k};`, ...(k < all.length - 1 ? [c ? 'igSameLine(0.0f, -1.0f);' : 'ImGui::SameLine();'] : [])]);
      }
      return [`/* ${n.kind} */`];
    },
    box(n, v) {
      const p = n.p;
      switch (n.kind) {
        case 'window': return {
          guard: v!.name,
          pre: [
            `${ns('SetNextWindowPos')}(${v2(n.x, n.y)}, ImGuiCond_FirstUseEver${c ? ', (ImVec2){0, 0}' : ''});`,
            `${ns('SetNextWindowSize')}(${v2(n.w, n.h)}, ImGuiCond_FirstUseEver);`,
          ],
          cond: `${ns('Begin')}(${q(p.title)}, ${p.closable ? `&${v!.name}` : nul}, ${or(winFlags(n), 'ImGuiWindowFlags')})`,
          post: [`${ns('End')}();`],
        };
        case 'child': return {
          cond: `${ns('BeginChild', 'BeginChild_Str')}(${q(p.id)}, ${v2(n.w, n.h)}, ${p.border ? 'ImGuiChildFlags_Borders' : '0'}${c ? ', 0' : ''})`,
          post: [`${ns('EndChild')}();`],
        };
        case 'header': return { cond: c ? `igCollapsingHeader_TreeNodeFlags(${q(p.label)}, 0)` : `ImGui::CollapsingHeader(${q(p.label)})` };
        case 'tree': return { cond: `${ns('TreeNode', 'TreeNode_Str')}(${q(p.label)})`, tail: [`${ns('TreePop')}();`] };
        case 'tab_bar': return { cond: `${ns('BeginTabBar')}(${q(p.id)}${c ? ', 0' : ''})`, tail: [`${ns('EndTabBar')}();`] };
        case 'tab': return { cond: `${ns('BeginTabItem')}(${q(p.label)}${c ? ', NULL, 0' : ''})`, tail: [`${ns('EndTabItem')}();`] };
        case 'table': return {
          cond: `${ns('BeginTable')}(${q(p.id)}, ${ncols(n)}, ${or(tableFlags(n), 'ImGuiTableFlags')}${c ? ', (ImVec2){0, 0}, 0.0f' : ''})`,
          head: p.headers ? [...cols(n).map(l => `${ns('TableSetupColumn')}(${q(l)}${c ? ', 0, 0.0f, 0' : ''});`), `${ns('TableHeadersRow')}();`] : [],
          each: [`${ns('TableNextColumn')}();`],
          tail: [`${ns('EndTable')}();`],
        };
        case 'popup': return {
          pre: [`if (${c ? `igButton(${q(p.label)}, (ImVec2){0, 0})` : `ImGui::Button(${q(p.label)})`}) ${ns('OpenPopup', 'OpenPopup_Str')}(${q(p.id)}${c ? ', 0' : ''});`, ...(p.tooltip ? [this.tooltip(p.tooltip)] : [])],
          cond: `${ns('BeginPopup')}(${q(p.id)}${c ? ', 0' : ''})`,
          tail: [`${ns('EndPopup')}();`],
        };
      }
      return {};
    },
  };
}

const csharp: Lang = {
  allman: true,
  if: c => `if (${c})`,
  ref: v => `_${camel(v.name)}`,
  cursor: (x, y) => `ImGui.SetCursorPos(new float2(${fl(x)}f, ${fl(y)}f));`,
  sameLine: 'ImGui.SameLine();',
  width: w => `ImGui.SetNextItemWidth(${fl(w)}f);`,
  tooltip: t => `ImGui.SetItemTooltip(${q(t)});`,
  leaf(n, v) {
    const p = n.p, L = q(p.label), r = v ? this.ref(v) : '';
    const f = (x: number) => `${fl(x)}f`;
    switch (n.kind) {
      case 'text': return [`ImGui.Text(${q(p.text)});`];
      case 'text_colored': return [`ImGui.TextColored(new float4(${color(p.color).map(f).join(', ')}), ${q(p.text)});`];
      case 'text_wrapped': return [`ImGui.TextWrapped(${q(p.text)});`];
      case 'separator': return ['ImGui.Separator();'];
      case 'spacing': return ['ImGui.Spacing();'];
      case 'button': return [`if (ImGui.Button(${L})) { /* clicked */ }`];
      case 'checkbox': return [`ImGui.Checkbox(${L}, ref ${r});`];
      case 'radio': return [`if (ImGui.RadioButton(${L}, ${r} == ${int(p.option)})) ${r} = ${int(p.option)};`];
      case 'slider_float': return [`ImGui.SliderFloat(${L}, ref ${r}, ${f(p.min)}, ${f(p.max)});`];
      case 'slider_int': return [`ImGui.SliderInt(${L}, ref ${r}, ${int(p.min)}, ${int(p.max)});`];
      case 'drag_float': return [`ImGui.DragFloat(${L}, ref ${r}, ${f(p.speed)}, ${f(p.min)}, ${f(p.max)});`];
      case 'drag_int': return [`ImGui.DragInt(${L}, ref ${r}, ${f(p.speed)}, ${int(p.min)}, ${int(p.max)});`];
      case 'input_text': return [`ImGui.InputText(${L}, ${r});`];
      case 'input_multiline': return [`ImGui.InputTextMultiline(${L}, ${r}, new float2(${f(n.w)}, ${f(n.h)}));`];
      case 'input_double': return [`ImGui.InputDouble(${L}, ref ${r});`];
      case 'input_int': return [`ImGui.InputInt(${L}, ref ${r});`];
      case 'combo': return [`ImGui.Combo(${L}, ref ${r}, ${q(list(p.items).join('\0') + '\0').replace(/\u0000/g, '\\0')});`];
      case 'list_box': return [
        `if (ImGui.BeginListBox(${L}, new float2(0f, ${int(p.rows)} * ImGui.GetTextLineHeightWithSpacing() + 4f)))`,
        '{',
        `    string[] items = [${list(p.items).map(q).join(', ')}];`,
        `    for (int i = 0; i < items.Length; i++)`,
        `        if (ImGui.Selectable(items[i], ${r} == i)) ${r} = i;`,
        '    ImGui.EndListBox();',
        '}',
      ];
      case 'color_edit': return [`ImGui.ColorEdit4(${L}, ref ${r});`];
      case 'selectable': return [`ImGui.Selectable(${L}, ref ${r});`];
      case 'progress': return [`ImGui.ProgressBar(${f(p.fraction)}${p.overlay ? `, overlay: ${q(p.overlay)}` : ''});`];
      case 'plot_lines': return [`ImGui.PlotLines(${L}, [${numbers(p.values).map(f).join(', ')}], graphSize: new float2(${f(n.w)}, ${f(n.h)}));`];
      case 'plot_histogram': return [`ImGui.PlotHistogram(${L}, [${numbers(p.values).map(f).join(', ')}], graphSize: new float2(${f(n.w)}, ${f(n.h)}));`];
      case 'readout': return [`ImGui.Text(${q(`${p.key}  ${p.value}`)});`];
      case 'region_header': return [`ImGui.Text(${q(p.label)});`, 'ImGui.Separator();'];
      case 'segmented': return list(p.items).flatMap((it, k, all) => [`if (ImGui.RadioButton(${q(it)}, ${r} == ${k})) ${r} = ${k};`, ...(k < all.length - 1 ? ['ImGui.SameLine();'] : [])]);
    }
    return [`// ${n.kind}`];
  },
  box(n, v) {
    const p = n.p;
    const or = (xs: readonly (readonly [string, string, number])[], e: string) => xs.map(x => `${e}.${x[1]}`).join(' | ');
    switch (n.kind) {
      case 'window': {
        const flags = or(winFlags(n), 'ImGuiWindowFlags');
        const r = this.ref(v!);
        return {
          guard: r,
          pre: [`ImGui.SetNextWindowPos(new float2(${fl(n.x)}f, ${fl(n.y)}f), ImGuiCond.FirstUseEver);`, `ImGui.SetNextWindowSize(new float2(${fl(n.w)}f, ${fl(n.h)}f), ImGuiCond.FirstUseEver);`],
          cond: `ImGui.Begin(${q(p.title)}${p.closable ? `, ref ${r}` : ''}${flags ? `, ${flags}` : ''})`,
          post: ['ImGui.End();'],
        };
      }
      case 'child': return { cond: `ImGui.BeginChild(${q(p.id)}, new float2(${fl(n.w)}f, ${fl(n.h)}f)${p.border ? ', ImGuiChildFlags.Borders' : ''})`, post: ['ImGui.EndChild();'] };
      case 'header': return { cond: `ImGui.CollapsingHeader(${q(p.label)})` };
      case 'tree': return { cond: `ImGui.TreeNode(${q(p.label)})`, tail: ['ImGui.TreePop();'] };
      case 'tab_bar': return { cond: `ImGui.BeginTabBar(${q(p.id)})`, tail: ['ImGui.EndTabBar();'] };
      case 'tab': return { cond: `ImGui.BeginTabItem(${q(p.label)})`, tail: ['ImGui.EndTabItem();'] };
      case 'table': {
        const flags = or(tableFlags(n), 'ImGuiTableFlags');
        return {
          cond: `ImGui.BeginTable(${q(p.id)}, ${ncols(n)}${flags ? `, ${flags}` : ''})`,
          head: p.headers ? [...cols(n).map(l => `ImGui.TableSetupColumn(${q(l)});`), 'ImGui.TableHeadersRow();'] : [],
          each: ['ImGui.TableNextColumn();'],
          tail: ['ImGui.EndTable();'],
        };
      }
      case 'popup': return {
        pre: [`if (ImGui.Button(${q(p.label)})) ImGui.OpenPopup(${q(p.id)});`, ...(p.tooltip ? [this.tooltip(p.tooltip)] : [])],
        cond: `ImGui.BeginPopup(${q(p.id)})`,
        tail: ['ImGui.EndPopup();'],
      };
    }
    return {};
  },
};

/** Rust (`self.x`) and Rhai (`this.x`, values returned rather than changed in place) share most names. */
function oxidizer(rhai: boolean): Lang {
  const im = (f: string) => (rhai ? f : `imgui::${f}`);
  const mut = (r: string) => (rhai ? r : `&mut ${r}`);
  // Rust changes the value through &mut; Rhai returns the new value.
  const set = (r: string, call: string) => (rhai ? `${r} = ${call};` : `${call};`);
  const strs = (xs: string[]) => (rhai ? `[${xs.map(q).join(', ')}]` : `&[${xs.map(q).join(', ')}]`);
  return {
    if: c => `if ${c}`,
    ref: v => `${rhai ? 'this' : 'self'}.${v.name}`,
    cursor: (x, y) => `${im('set_cursor_pos')}(${fl(x)}, ${fl(y)});`,
    sameLine: `${im('same_line')}();`,
    width: w => `${im('set_next_item_width')}(${fl(w)});`,
    tooltip: t => `${im('item_tooltip')}(${q(t)});`,
    leaf(n, v) {
      const p = n.p, L = q(p.label), r = v ? this.ref(v) : '';
      switch (n.kind) {
        case 'text': return [`${im('text')}(${q(p.text)});`];
        case 'text_colored': return [`${im('text_colored')}([${color(p.color).map(fl).join(', ')}], ${q(p.text)});`];
        case 'text_wrapped': return [`${im('text_wrapped')}(${q(p.text)});`];
        case 'separator': return [`${im('separator')}();`];
        case 'spacing': return [`${im('spacing')}();`];
        case 'button': return [`if ${im('button')}(${L}) { /* clicked */ }`];
        case 'checkbox': return [set(r, `${im('checkbox')}(${L}, ${mut(r)})`)];
        case 'radio': return [`if ${im('radio_button')}(${L}, ${r} == ${int(p.option)}) { ${r} = ${int(p.option)}; }`];
        case 'slider_float': return [set(r, `${im(rhai ? 'slider' : 'slider_float')}(${L}, ${mut(r)}, ${fl(p.min)}, ${fl(p.max)})`)];
        case 'slider_int': return [set(r, `${im('slider_int')}(${L}, ${mut(r)}, ${int(p.min)}, ${int(p.max)})`)];
        case 'drag_float': return [set(r, `${im('drag_float')}(${L}, ${mut(r)}, ${fl(p.speed)}, ${fl(p.min)}, ${fl(p.max)})`)];
        case 'drag_int': return [set(r, `${im('drag_int')}(${L}, ${mut(r)}, ${fl(p.speed)}, ${int(p.min)}, ${int(p.max)})`)];
        case 'input_text': return [set(r, rhai ? `input_text(${L}, ${r})` : `imgui::input_text(${L}, &mut ${r}, 0)`)];
        case 'input_multiline': return [set(r, rhai ? `input_multiline(${L}, ${r}, ${fl(n.w)}, ${fl(n.h)})` : `imgui::input_text_multiline(${L}, &mut ${r}, ${fl(n.w)}, ${fl(n.h)}, 0)`)];
        case 'input_double': return [set(r, `${im(rhai ? 'input_float' : 'input_double')}(${L}, ${mut(r)})`)];
        case 'input_int': return [set(r, `${im('input_int')}(${L}, ${mut(r)})`)];
        case 'combo': return [set(r, `${im('combo')}(${L}, ${mut(r)}, ${strs(list(p.items))})`)];
        case 'list_box': return [set(r, `${im('list_box')}(${L}, ${mut(r)}, ${strs(list(p.items))}, ${int(p.rows)})`)];
        case 'color_edit': return [set(r, `${im('color_edit')}(${L}, ${mut(r)})`)];
        case 'selectable': return [`if ${im('selectable')}(${L}, ${r}) { ${r} = !${r}; }`];
        case 'progress': return [`${im('progress_bar')}(${fl(p.fraction)}, ${q(p.overlay)});`];
        case 'plot_lines':
        case 'plot_histogram': return [`${im(n.kind)}(${L}, ${rhai ? '' : '&'}[${numbers(p.values).map(fl).join(', ')}], ${fl(n.h)});`];
        case 'readout': return [`${im('text')}(${q(`${p.key}  ${p.value}`)});`];
        case 'region_header': return [`${im('text')}(${q(p.label)});`, `${im('separator')}();`];
        case 'segmented': return list(p.items).flatMap((it, k, all) => [`if ${im('radio_button')}(${q(it)}, ${r} == ${k}) { ${r} = ${k}; }`, ...(k < all.length - 1 ? [`${im('same_line')}();`] : [])]);
      }
      return [`// ${n.kind}`];
    },
    box(n, v) {
      const p = n.p;
      switch (n.kind) {
        case 'window': {
          const flags = winFlags(n);
          const r = this.ref(v!);
          const fl2 = rhai ? flags.reduce((a, x) => a + x[2], 0) : flags.map(x => `imgui::window_flags::${x[0] === 'no_title' ? 'NO_TITLE_BAR' : x[0].toUpperCase()}`).join(' | ') || '0';
          let cond: string;
          if (rhai) cond = flags.length ? `begin_ex(${q(p.title)}, ${fl2})` : `begin(${q(p.title)})`;
          else if (p.closable) cond = `imgui::begin_ex(${q(p.title)}, Some(&mut ${r}), ${fl2})`;
          else cond = flags.length ? `imgui::begin_ex(${q(p.title)}, None, ${fl2})` : `imgui::begin(${q(p.title)})`;
          return {
            guard: r,
            pre: [
              ...(rhai && p.closable ? ['// Rhai windows have no close button: menu() toggles this one.'] : []),
              `${im('set_next_window_pos')}(${fl(n.x)}, ${fl(n.y)});`,
              `${im('set_next_window_size')}(${fl(n.w)}, ${fl(n.h)});`,
            ],
            cond,
            post: [`${im('end')}();`],
          };
        }
        case 'child': return { cond: `${im('begin_child_ex')}(${q(p.id)}, ${fl(n.w)}, ${fl(n.h)}, ${!!p.border})`, post: [`${im('end_child')}();`] };
        case 'header': return { cond: `${im(rhai ? 'header' : 'collapsing_header')}(${q(p.label)})` };
        case 'tree': return { cond: `${im('tree_node')}(${q(p.label)})`, tail: [`${im('tree_pop')}();`] };
        case 'tab_bar': return { cond: `${im('begin_tab_bar')}(${q(p.id)})`, tail: [`${im('end_tab_bar')}();`] };
        case 'tab': return { cond: rhai ? `begin_tab(${q(p.label)})` : `imgui::begin_tab_item(${q(p.label)}, None, 0)`, tail: [`${im(rhai ? 'end_tab' : 'end_tab_item')}();`] };
        case 'table': {
          const flags = tableFlags(n);
          const f = rhai ? String(flags.reduce((a, x) => a + x[2], 0)) : flags.map(x => `imgui::table_flags::${x[0].toUpperCase()}`).join(' | ') || '0';
          return {
            cond: `${im('begin_table')}(${q(p.id)}, ${ncols(n)}, ${f})`,
            head: p.headers ? [...cols(n).map(l => `${im('table_setup_column')}(${q(l)});`), `${im('table_headers_row')}();`] : [],
            each: [`${im('table_next_column')}();`],
            tail: [`${im('end_table')}();`],
          };
        }
        case 'popup': return {
          pre: [`if ${im('button')}(${q(p.label)}) { ${im('open_popup')}(${q(p.id)}); }`, ...(p.tooltip ? [this.tooltip(p.tooltip)] : [])],
          cond: `${im('begin_popup')}(${q(p.id)})`,
          tail: [`${im('end_popup')}();`],
        };
      }
      return {};
    },
  };
}

// ---- KSA look: the game's UI kit (KSA.ConsoleStyle / KSA.ConsoleWidgets; oxidizer_api::ksa_ui; Rhai ksa_*) ----

type KsaTarget = 'csharp' | 'rust' | 'rhai';
const ROW_KINDS = new Set(['checkbox', 'slider_float', 'slider_int', 'drag_float', 'drag_int', 'combo', 'input_text', 'color_edit']);
const VARIANTS: Record<string, [string, string]> = { normal: ['Button', 'button'], primary: ['PrimaryButton', 'primary_button'], positive: ['PositiveButton', 'positive_button'], danger: ['DangerButton', 'danger_button'] };

/** `base` with the widgets KSA's kit has drawn by the kit (the rest stays plain ImGui, in KSA's widget style). */
function ksaLang(base: Lang, t: KsaTarget, mod: string): Lang {
  const cs = t === 'csharp', rs = t === 'rust', rhai = t === 'rhai';
  const w = (csName: string, rsName: string, args = '') => (cs ? `ConsoleWidgets.${csName}(${args})` : rs ? `ksa_ui::${rsName}(${args})` : `ksa_${rsName}(${args})`);
  const st = (csName: string, rsName: string, args = '') => (cs ? `ConsoleStyle.${csName}(${args})` : rs ? `ksa_ui::${rsName}(${args})` : `ksa_${rsName}(${args})`);
  const f = (n: number) => (cs ? `${fl(n)}f` : fl(n));
  const strs = (xs: string[]) => (rs ? `&[${xs.map(q).join(', ')}]` : `[${xs.map(q).join(', ')}]`);
  const unbounded = (n: Node) => Number(n.p.min) === Number(n.p.max);
  const fmin = (n: Node) => (unbounded(n) ? (cs ? 'float.MinValue' : rs ? 'f32::MIN' : '-3.4e38') : f(n.p.min));
  const fmax = (n: Node) => (unbounded(n) ? (cs ? 'float.MaxValue' : rs ? 'f32::MAX' : '3.4e38') : f(n.p.max));
  const imin = (n: Node) => (unbounded(n) ? (cs ? 'int.MinValue' : rs ? 'i32::MIN' : '-2147483648') : int(n.p.min));
  const imax = (n: Node) => (unbounded(n) ? (cs ? 'int.MaxValue' : rs ? 'i32::MAX' : '2147483647') : int(n.p.max));
  const label = (n: Node) => String(n.p.label ?? '').split('##')[0];
  const rhaiText = (r: string, round: boolean) => '`${' + (round ? `(${r} * 100.0).round() / 100.0` : r) + '}`';

  /** The control of a labelled row; `r` is its variable, `id` its widget id. */
  const control = (n: Node, r: string, id: string): string[] => {
    const p = n.p;
    switch (n.kind) {
      case 'checkbox': return [cs ? `ConsoleWidgets.Checkbox(${id}, ref ${r}, false);` : rs ? `ksa_ui::checkbox(${id}, &mut ${r});` : `${r} = ksa_checkbox(${id}, ${r});`];
      case 'slider_float':
      case 'drag_float': {
        const [c, k] = n.kind === 'slider_float' ? ['SliderFloat', 'slider_float'] : ['DragFloat', 'drag_float'];
        const lo = n.kind === 'slider_float' ? f(p.min) : fmin(n), hi = n.kind === 'slider_float' ? f(p.max) : fmax(n);
        if (cs) return [`ConsoleWidgets.${c}(${id}, ref ${r}, ${lo}, ${hi}, ${r}.ToString("F2", CultureInfo.InvariantCulture), false);`];
        if (rs) return [`let text = format!("{:.2}", ${r});`, `ksa_ui::${k}(${id}, &mut ${r}, ${lo}, ${hi}, &text);`];
        return [`${r} = ksa_${k}(${id}, ${r}, ${lo}, ${hi}, ${rhaiText(r, true)});`];
      }
      case 'slider_int':
      case 'drag_int': {
        const [c, k] = n.kind === 'slider_int' ? ['SliderInt', 'slider_int'] : ['DragInt', 'drag_int'];
        const lo = n.kind === 'slider_int' ? int(p.min) : imin(n), hi = n.kind === 'slider_int' ? int(p.max) : imax(n);
        if (cs) return [`ConsoleWidgets.${c}(${id}, ref ${r}, ${lo}, ${hi}, ${r}.ToString(CultureInfo.InvariantCulture), false);`];
        if (rs) return [`let text = ${r}.to_string();`, `ksa_ui::${k}(${id}, &mut ${r}, ${lo}, ${hi}, &text);`];
        return [`${r} = ksa_${k}(${id}, ${r}, ${lo}, ${hi}, ${rhaiText(r, false)});`];
      }
      case 'combo': {
        const items = list(p.items);
        if (rs) return [`ksa_ui::combo(${id}, &mut ${r}, ${strs(items)});`];
        if (rhai) return [`${r} = ksa_combo(${id}, ${r}, ${strs(items)});`];
        return [
          `string[] items = ${strs(items)};`,
          `if (ConsoleWidgets.BeginComboControl(${id}, items[${r}], false))`,
          '{',
          '    for (int i = 0; i < items.Length; i++)',
          `        if (ImGui.Selectable(items[i], ${r} == i)) ${r} = i;`,
          '    ConsoleWidgets.EndComboControl();',
          '}',
        ];
      }
      case 'input_text': return [cs ? `ConsoleWidgets.TextLine(${id}, ref ${r}, false, out _);` : rs ? `ksa_ui::text_line(${id}, &mut ${r});` : `${r} = ksa_text_line(${id}, ${r});`];
      case 'color_edit': return [cs ? `ConsoleWidgets.ColorEdit3(${id}, ref ${r}, false);` : rs ? `ksa_ui::color_edit(${id}, &mut ${r});` : `${r} = ksa_color_edit(${id}, ${r});`];
    }
    return [];
  };

  return {
    ...base,
    ownWidth: n => ROW_KINDS.has(n.kind),
    tooltip: text => `${w('ItemTooltip', 'item_tooltip', q(text))};`,
    leaf(n, v) {
      const p = n.p, r = v ? this.ref(v) : '';
      if (ROW_KINDS.has(n.kind) && v) {
        const lines = [`${w('BeginRow', 'begin_row', q(label(n)))};`, ...control(n, r, q(v.name)), `${w('EndRow', 'end_row')};`];
        // C#'s combo declares `items` and Rust's sliders `text`: each in its own block.
        const scoped = (cs && n.kind === 'combo') || (rs && /^(slider|drag)/.test(n.kind));
        return scoped ? ['{', ...lines.map(l => `    ${l}`), '}'] : lines;
      }
      switch (n.kind) {
        case 'button': {
          const [c, k] = VARIANTS[p.variant] ?? VARIANTS.normal;
          return [`${base.if(w(c, k, q(p.label)))} { /* clicked */ }`];
        }
        case 'separator': return [`${w('Rule', 'rule')};`];
        case 'readout': return [`${w('Readout', 'readout', `${q(p.key)}, ${q(p.value)}`)};`];
        case 'region_header': return [`${w('RegionHeader', 'region_header', q(p.label))};`];
        case 'segmented': return [`${r} = ${w('Segmented', 'segmented', `${q(v!.name)}, ${strs(list(p.items))}, ${r}`)};`];
      }
      return base.leaf.call(this, n, v);
    },
    box(n, v) {
      if (n.kind !== 'window') return base.box.call(this, n, v);
      const p = n.p, r = this.ref(v!);
      const flags = winFlags(n);
      const flagExpr = cs
        ? flags.map(x => `ImGuiWindowFlags.${x[1]}`).join(' | ')
        : rs
          ? flags.map(x => `imgui::window_flags::${x[0] === 'no_title' ? 'NO_TITLE_BAR' : x[0].toUpperCase()}`).join(' | ') || '0'
          : String(flags.reduce((a, x) => a + x[2], 0));
      const id = q(`${mod}_${v!.name}`), title = q(String(p.title ?? '')), sig = q(String(p.signature ?? ''));
      let cond: string;
      if (cs) cond = `ConsoleStyle.BeginWindow(${id}, ${title}, ${sig}${p.closable ? `, ref ${r}` : ''}, new float2(${f(n.w)}, ${f(n.h)})${flagExpr ? `, ${flagExpr}` : ''})`;
      else if (rs) cond = `ksa_ui::begin_window(${id}, ${title}, ${sig}, ${p.closable ? `Some(&mut ${r})` : 'None'}, ${fl(n.w)}, ${fl(n.h)}, ${flagExpr})`;
      else cond = `ksa_begin_window(${id}, ${title}, ${sig}, ${fl(n.w)}, ${fl(n.h)}, ${flagExpr})`;
      return {
        guard: r,
        pre: [
          ...(rhai && p.closable ? ['// Rhai windows have no close button: menu() toggles this one.'] : []),
          cs ? `ImGui.SetNextWindowPos(new float2(${f(n.x)}, ${f(n.y)}), ImGuiCond.FirstUseEver);` : `${rs ? 'imgui::' : ''}set_next_window_pos(${fl(n.x)}, ${fl(n.y)});`,
        ],
        // When BeginWindow returns false the window is already ended: everything else is inside the if.
        cond,
        head: [`${st('BeginBody', 'begin_body')};`, `${st('PushWidgetStyle', 'push_widget_style')};`],
        tail: [
          `${st('PopWidgetStyle', 'pop_widget_style')};`,
          `${st('EndBody', 'end_body')};`,
          `${st('BeginFooter', 'begin_footer')};`,
          ...(p.footer ? [cs ? `ConsoleStyle.FooterStatus(${q(p.footer)}, false);` : `${st('FooterStatus', 'footer_status', q(p.footer))};`] : []),
          `${st('EndFooter', 'end_footer')};`,
          `${st('EndWindow', 'end_window')};`,
        ],
      };
    },
  };
}

// ---- the walk ----

class Out {
  lines: string[] = [];
  allman: boolean;
  depth: number;
  constructor(allman = false, depth = 0) {
    this.allman = allman;
    this.depth = depth;
  }
  line(s: string) {
    for (const l of s.split('\n')) this.lines.push(l ? '    '.repeat(this.depth) + l : '');
  }
  open(head: string) {
    if (this.allman) {
      this.line(head);
      this.line('{');
    } else this.line(`${head} {`);
    this.depth++;
  }
  close() {
    this.depth--;
    this.line('}');
  }
}

function emit(nodes: Node[], parent: Node | undefined, L: Lang, vars: Map<string, Var>, out: Out) {
  const box = parent ? L.box(parent, vars.get(parent.id)) : undefined;
  nodes.forEach((n, i) => {
    for (const l of box?.each ?? []) out.line(l);
    if (isAbsolute(parent)) out.line(L.cursor(n.x, n.y));
    else if (n.p.same_line && i > 0) out.line(L.sameLine);
    const d = KINDS[n.kind];
    if (d.width && n.w > 0 && !L.ownWidth?.(n)) out.line(L.width(n.w));
    if (d.container) container(n, L, vars, out);
    else {
      for (const l of L.leaf(n, vars.get(n.id))) out.line(l);
      if (n.p.tooltip) out.line(L.tooltip(n.p.tooltip));
    }
  });
}

function container(n: Node, L: Lang, vars: Map<string, Var>, out: Out) {
  const b = L.box(n, vars.get(n.id));
  if (b.guard) out.open(L.if(b.guard));
  for (const l of b.pre ?? []) out.line(l);
  if (b.cond) out.open(L.if(b.cond));
  for (const l of b.head ?? []) out.line(l);
  emit(n.children ?? [], n, L, vars, out);
  for (const l of b.tail ?? []) out.line(l);
  if (b.cond) out.close();
  for (const l of b.post ?? []) out.line(l);
  if (b.guard) out.close();
}

function body(p: Project, L: Lang, vars: Map<string, Var>, depth: number): string[] {
  const out = new Out(L.allman, depth);
  p.windows.forEach((w, i) => {
    if (i) out.line('');
    container(w, L, vars, out);
  });
  return out.lines;
}

/** Features that need the widgets added in oxidizer_api 0.9 (not in 0.8.1). */
function needsOxidizer09(p: Project): boolean {
  const fresh = new Set(['readout', 'region_header', 'segmented', 'tree', 'table', 'popup', 'radio', 'selectable', 'list_box', 'slider_int', 'drag_float', 'drag_int', 'text_wrapped', 'spacing', 'plot_lines', 'plot_histogram', 'child']);
  let yes = false;
  const go = (ns: Node[]) => ns.forEach(n => {
    if (fresh.has(n.kind) || n.p.tooltip || (n.kind === 'window' && winFlags(n).length) || (n.kind === 'window' && n.p.closable)) yes = true;
    if (n.children) go(n.children);
  });
  go(p.windows);
  return yes;
}

// ---- per-target files ----

export interface Options { name: string }

export function generate(p: Project, target: Target, o: Options): string {
  const { byNode, all } = assignVars(p);
  const name = ident(o.name, 'my_mod');
  const ksa = !!p.ksa && (target === 'csharp' || target === 'rust' || target === 'rhai');
  const windows = p.windows.map(w => ({ title: String(w.p.title ?? 'Window').split('##')[0], v: byNode.get(w.id)! }));
  switch (target) {
    case 'cpp':
    case 'c': {
      const c = target === 'c';
      const L = cFamily(c);
      const decl = (v: Var) => {
        switch (v.state) {
          case 'bool': return `static bool ${v.name} = ${v.init ? 'true' : 'false'};`;
          case 'int': return `static int ${v.name} = ${int(v.init)};`;
          case 'float': return `static float ${v.name} = ${fl(v.init)}f;`;
          case 'double': return `static double ${v.name} = ${fl(v.init)};`;
          case 'string':
          case 'text': return `static char ${v.name}[1024] = ${q(v.init)};`;
          case 'color': return `static float ${v.name}[4] = { ${color(v.init).map(x => `${fl(x)}f`).join(', ')} };`;
        }
      };
      const ns = (f: string) => (c ? `ig${f}` : `ImGui::${f}`);
      return [
        `// ${name}: generated by ImGui Editor`,
        ...(c ? ['#define CIMGUI_DEFINE_ENUMS_AND_STRUCTS', '#include "cimgui.h"'] : ['#include "imgui.h"']),
        '#include <float.h>',
        '',
        `// The UI's state. ${c ? 'File-level statics' : 'Statics'} keep it between frames.`,
        ...all.map(decl),
        '',
        `void ${name}_draw(void)`.replace('(void)', c ? '(void)' : '()'),
        '{',
        ...body(p, L, byNode, 1),
        '}',
        '',
        '// Call inside a BeginMenu(...) / EndMenu() pair to toggle the windows.',
        `void ${name}_menu(void)`.replace('(void)', c ? '(void)' : '()'),
        '{',
        ...windows.map(w => `    if (${ns(c ? 'MenuItem_Bool' : 'MenuItem')}(${q(w.title)}, ${c ? 'NULL' : 'nullptr'}, ${w.v.name}${c ? ', true' : ''})) ${w.v.name} = !${w.v.name};`),
        '}',
        '',
      ].join('\n');
    }
    case 'csharp': {
      const L = csharp;
      const cls = pascal(name);
      const field = (v: Var) => {
        const f = L.ref(v);
        if (windows.some(w => w.v === v)) return `internal static bool ${winRef(v)} = true;`;
        switch (v.state) {
          case 'bool': return `bool ${f} = ${v.init ? 'true' : 'false'};`;
          case 'int': return `int ${f} = ${int(v.init)};`;
          case 'float': return `float ${f} = ${fl(v.init)}f;`;
          case 'double': return `double ${f} = ${fl(v.init)};`;
          case 'string': return ksa ? `string ${f} = ${q(v.init)};` : `readonly ImInputString ${f} = new(1024, ${q(v.init)}u8);`;
          case 'text': return `readonly ImInputString ${f} = new(1024, ${q(v.init)}u8);`;
          case 'color': return ksa ? `float3 ${f} = new(${color(v.init).slice(0, 3).map(x => `${fl(x)}f`).join(', ')});` : `float4 ${f} = new(${color(v.init).map(x => `${fl(x)}f`).join(', ')});`;
        }
      };
      // Window flags are static (the menu patch toggles them): Show… rather than _show….
      const winRef = (v: Var) => pascal(v.name);
      const plain: Lang = { ...L, ref: v => (windows.some(w => w.v === v) ? winRef(v) : L.ref(v)) };
      const lang = ksa ? ksaLang(plain, 'csharp', name) : plain;
      return [
        `// ${name}: generated by ImGui Editor. A StarMap mod (net10.0, StarMap.API, Lib.Harmony; reference KSA.dll and Brutal.*.dll).`,
        ...(ksa ? ['using System.Globalization;'] : []),
        'using Brutal.ImGuiApi;',
        'using Brutal.Numerics;',
        'using HarmonyLib;',
        'using KSA;',
        'using StarMap.API;',
        '',
        `namespace ${cls};`,
        '',
        '[StarMapMod]',
        `public sealed class ${cls}Ui`,
        '{',
        ...all.map(v => `    ${field(v)}`),
        '',
        '    [StarMapBeforeMain]',
        `    public void Init() => new Harmony(${q(name)}).PatchAll(typeof(${cls}Ui).Assembly);`,
        '',
        '    [StarMapAfterGui]',
        '    public void OnGui(double dt)',
        '    {',
        ...body(p, lang, byNode, 2),
        '    }',
        '}',
        '',
        '/// <summary>Entries in KSA\'s menu bar: KSA calls Program.DrawProgramMenusHook after its own menus.</summary>',
        '[HarmonyPatch(typeof(Program), "DrawProgramMenusHook")]',
        `static class ${cls}Menu`,
        '{',
        '    static void Postfix()',
        '    {',
        '        if (!ImGui.BeginMenu("Mods")) return;',
        ...windows.map(w => `        if (ImGui.MenuItem(${q(w.title)}, selected: ${cls}Ui.${winRef(w.v)})) ${cls}Ui.${winRef(w.v)} = !${cls}Ui.${winRef(w.v)};`),
        '        ImGui.EndMenu();',
        '    }',
        '}',
        '',
      ].join('\n');
    }
    case 'rust': {
      const L = ksa ? ksaLang(oxidizer(false), 'rust', name) : oxidizer(false);
      const ty = (v: Var) => ({ bool: 'bool', int: 'i32', float: 'f32', double: 'f64', string: ksa ? 'String' : 'imgui::TextBuffer', text: 'imgui::TextBuffer', color: ksa ? '[f32; 3]' : '[f32; 4]' })[v.state];
      const val = (v: Var) => {
        switch (v.state) {
          case 'bool': return v.init ? 'true' : 'false';
          case 'int': return int(v.init);
          case 'float':
          case 'double': return fl(v.init);
          case 'string': return ksa ? `String::from(${q(v.init)})` : `imgui::TextBuffer::new(${q(v.init)})`;
          case 'text': return `imgui::TextBuffer::new(${q(v.init)})`;
          case 'color': return `[${color(v.init).slice(0, ksa ? 3 : 4).map(fl).join(', ')}]`;
        }
      };
      return [
        `//! ${name}: generated by ImGui Editor. Needs oxidizer_api ${ksa ? '0.9 (API version 8: the KSA UI kit)' : needsOxidizer09(p) ? '0.9' : '0.8.1'} or later.`,
        '//! Keep a `Ui` in your Mod struct, call `self.ui.draw()` in `Mod::gui` and `self.ui.menu()` in `Mod::menu`.',
        ksa ? 'use oxidizer_api::{imgui, ksa_ui};' : 'use oxidizer_api::imgui;',
        '',
        'pub struct Ui {',
        ...all.map(v => `    pub ${v.name}: ${ty(v)},`),
        '}',
        '',
        'impl Default for Ui {',
        '    fn default() -> Self {',
        '        Ui {',
        ...all.map(v => `            ${v.name}: ${val(v)},`),
        '        }',
        '    }',
        '}',
        '',
        'impl Ui {',
        '    pub fn draw(&mut self) {',
        ...body(p, L, byNode, 2),
        '    }',
        '',
        '    /// Entries in the game\'s Mods menu that show and hide the windows.',
        '    pub fn menu(&mut self) {',
        ...windows.map(w => `        if imgui::menu_item(${q(w.title)}, self.${w.v.name}) { self.${w.v.name} = !self.${w.v.name}; }`),
        '    }',
        '}',
        '',
      ].join('\n');
    }
    case 'rhai': {
      const L = ksa ? ksaLang(oxidizer(true), 'rhai', name) : oxidizer(true);
      const val = (v: Var) => {
        switch (v.state) {
          case 'bool': return v.init ? 'true' : 'false';
          case 'int': return int(v.init);
          case 'float':
          case 'double': return fl(v.init);
          case 'string':
          case 'text': return q(v.init);
          case 'color': return `[${color(v.init).slice(0, ksa ? 3 : 4).map(fl).join(', ')}]`;
        }
      };
      return [
        `// ${name}: generated by ImGui Editor. Needs Oxidizer ${ksa ? 'with the KSA UI kit (API version 8, after 0.14.0)' : needsOxidizer09(p) ? 'with the 0.9 widgets (after 0.14.0)' : '0.14.0'} or later.`,
        '// Merge these into your main.rhai: init() sets up the state, gui() draws, menu() adds Mods menu entries.',
        'fn init() {',
        ...all.map(v => `    this.${v.name} = ${val(v)};`),
        '}',
        '',
        'fn menu() {',
        ...windows.map(w => `    if menu_item(${q(w.title)}, this.${w.v.name}) { this.${w.v.name} = !this.${w.v.name}; }`),
        '}',
        '',
        'fn gui(dt) {',
        ...body(p, L, byNode, 1),
        '}',
        '',
      ].join('\n');
    }
  }
}
