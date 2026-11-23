// Draws the design with real Dear ImGui (jsimgui: ImGui compiled to WebAssembly) and records where every node
// landed on screen, so the editor's overlay can select and drag them.
import { ImGui, ImGuiCol, ImGuiImplWeb, ImGuiStyleVar, ImVec2, ImVec4 } from '@mori2003/jsimgui';
import { FONT_SIZE, KIT, setTheme, type Theme } from './theme.ts';
import { KINDS, isAbsolute, list, numbers, type Node, type Project } from './model.ts';

export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface Placed {
  rects: Map<string, Rect>;
  /** Screen position of window and child-region content origins (what SetCursorPos is relative to). */
  origins: Map<string, { x: number; y: number }>;
}

const WF = { no_title: 1, no_resize: 2, no_move: 4, no_collapse: 32, auto_resize: 64 } as const;
const COND_ALWAYS = 1, COND_FIRST = 4;
const FILL = -1.17549435e-38; // -FLT_MIN: fill the rest of the row
/** Widgets the KSA look draws as a labelled row (ConsoleWidgets.BeginRow). */
const ROW_KINDS = new Set(['checkbox', 'slider_float', 'slider_int', 'drag_float', 'drag_int', 'combo', 'input_text', 'color_edit']);

const S = KIT.style, W = KIT.widgets;
const kv4 = (c: number[] | undefined, fallback: number[] = [1, 1, 1, 1]) => { const x = c ?? fallback; return new ImVec4(x[0], x[1], x[2], x[3]); };
const ku32 = (c: number[] | undefined, fallback?: number[]) => ImGui.ColorConvertFloat4ToU32(kv4(c, fallback));
const px = (v: unknown, d: number) => (typeof v === 'number' ? v : d);

export class Preview {
  placed: Placed = { rects: new Map(), origins: new Map() };
  /** Live widget values in test mode, keyed by node id (jsimgui wants one-element arrays). */
  private state = new Map<string, any[]>();
  private stack: Rect[][] = [];
  private fonts: Partial<Record<Theme, any>> = {};
  private theme: Theme = 'ksa';
  private wantTheme: Theme | undefined = 'ksa';

  /** Switches the preview's look (applied before the next frame). */
  setTheme(t: Theme) {
    this.wantTheme = t;
  }

  private canvas: HTMLCanvasElement;
  private get: () => { project: Project; design: boolean; ksa: boolean };
  /** Drawing KSA's UI kit this frame (the design's KSA look, with a KSA target). */
  private ksa = false;
  constructor(canvas: HTMLCanvasElement, get: () => { project: Project; design: boolean; ksa: boolean }) {
    this.canvas = canvas;
    this.get = get;
  }

  async start(font?: Uint8Array) {
    await ImGuiImplWeb.Init({ canvas: this.canvas, backend: 'webgl2' });
    const io = ImGui.GetIO();
    // Stock Dear ImGui's font (ProggyClean), for the C/C++ look; the first font added is the default.
    this.fonts.default = io.Fonts.AddFontDefaultBitmap();
    if (font) {
      ImGuiImplWeb.LoadFont('JetBrainsMono-Regular.ttf', font);
      this.fonts.ksa = io.Fonts.AddFontFromFileTTF('JetBrainsMono-Regular.ttf', FONT_SIZE.ksa);
    }
    ImGui.StyleColorsDark();
    const frame = () => {
      const c = this.canvas;
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.max(1, c.clientWidth * dpr);
      c.height = Math.max(1, c.clientHeight * dpr);
      if (this.wantTheme) {
        setTheme(this.wantTheme);
        this.theme = this.wantTheme;
        this.wantTheme = undefined;
      }
      ImGuiImplWeb.BeginRender();
      const f = this.fonts[this.theme] ?? this.fonts.default;
      if (f) ImGui.PushFontFloat(f, FONT_SIZE[this.theme]);
      try {
        this.draw();
      } catch (e) {
        console.error(e);
      }
      if (f) ImGui.PopFont();
      ImGuiImplWeb.EndRender();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** Forget test-mode values (after the design changed a widget's initial value). */
  reset(id?: string) {
    if (id) this.state.delete(id);
    else this.state.clear();
    for (const k of [...this.state.keys()]) if (k.startsWith('radio:')) this.state.delete(k);
  }

  private ref<T>(n: Node | string, init: () => T): [T] {
    const key = typeof n === 'string' ? n : n.id;
    let r = this.state.get(key);
    if (!r) this.state.set(key, (r = [init()]));
    return r as [T];
  }

  private draw() {
    const { project, design, ksa } = this.get();
    const placed: Placed = { rects: new Map(), origins: new Map() };
    this.placed = placed;
    this.ksa = ksa;
    for (const w of project.windows) {
      const cond = design ? COND_ALWAYS : COND_FIRST;
      ImGui.SetNextWindowPos(new ImVec2(w.x, w.y), cond);
      if (!w.p.auto_resize) ImGui.SetNextWindowSize(new ImVec2(Math.max(w.w, 32), Math.max(w.h, 32)), cond);
      let flags = 0;
      for (const [k, v] of Object.entries(WF)) if (w.p[k]) flags |= v;
      // In design mode the overlay moves windows; in test mode they behave as in the game.
      if (design) flags |= 4 | 2; // NoMove | NoResize
      ImGui.PushID(w.id);
      if (ksa) {
        this.ksaWindow(w, flags);
        ImGui.PopID();
        continue;
      }
      const open = ImGui.Begin(`${w.p.title || 'Window'}###${w.id}`, w.p.closable ? [true] : null, flags);
      const pos = ImGui.GetWindowPos(), size = ImGui.GetWindowSize();
      placed.origins.set(w.id, { x: pos.x, y: pos.y });
      placed.rects.set(w.id, { x0: pos.x, y0: pos.y, x1: pos.x + size.x, y1: pos.y + size.y });
      if (open) this.children(w);
      ImGui.End();
      ImGui.PopID();
    }
  }

  private children(parent: Node) {
    const abs = isAbsolute(parent);
    (parent.children ?? []).forEach((n, i) => {
      if (parent.kind === 'table') ImGui.TableNextColumn();
      if (abs) ImGui.SetCursorPos(new ImVec2(n.x, n.y));
      else if (n.p.same_line && i > 0) ImGui.SameLine();
      if (KINDS[n.kind].width && n.w > 0) ImGui.SetNextItemWidth(n.w);
      ImGui.PushID(n.id);
      this.stack.push([]);
      try {
        this.node(n);
      } catch (e) {
        // One broken widget shouldn't stop the frame (ImGui aborts on an unbalanced Begin/End).
        ImGui.TextColored(new ImVec4(1, 0.3, 0.3, 1), `${n.kind}: ${e}`);
        console.error(e);
      }
      const rs = this.stack.pop()!;
      ImGui.PopID();
      if (rs.length) {
        const u = rs.reduce((a, r) => ({ x0: Math.min(a.x0, r.x0), y0: Math.min(a.y0, r.y0), x1: Math.max(a.x1, r.x1), y1: Math.max(a.y1, r.y1) }));
        this.placed.rects.set(n.id, u);
        this.stack[this.stack.length - 1]?.push(u);
      }
    });
  }

  /** The rect of the item just drawn, added to the node being drawn. */
  private item() {
    const a = ImGui.GetItemRectMin(), b = ImGui.GetItemRectMax();
    this.stack[this.stack.length - 1]?.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y });
  }

  /** A ConsoleStyle window: title bar (title, signature, close), a scrolling body and a footer. */
  private ksaWindow(w: Node, flags: number) {
    const tb = px(S.TitlebarHeight, 42), fh = px(S.FooterHeight, 50), pad = px(S.TitlebarHorizontalPaddingPx, 10);
    ImGui.PushStyleColorImVec4(ImGuiCol.WindowBg, kv4(S.PanelU32, [0.07, 0.075, 0.08, 1]));
    ImGui.PushStyleColorImVec4(ImGuiCol.Border, kv4(S.HairlineU32, [0.25, 0.27, 0.29, 1]));
    ImGui.PushStyleVar(ImGuiStyleVar.WindowRounding, px(S.WindowRoundingPx, 8));
    ImGui.PushStyleVarX(ImGuiStyleVar.WindowPadding, 0);
    ImGui.PushStyleVarY(ImGuiStyleVar.WindowPadding, 0);
    const open = ImGui.Begin(`${w.p.title || 'Window'}###${w.id}`, null, flags | 1 | 8 | 16 | 32); // no title bar, scrollbar, scrolling, collapse
    ImGui.PopStyleVar(3);
    ImGui.PopStyleColor(2);
    const pos = ImGui.GetWindowPos(), size = ImGui.GetWindowSize();
    this.placed.rects.set(w.id, { x0: pos.x, y0: pos.y, x1: pos.x + size.x, y1: pos.y + size.y });
    const dl = ImGui.GetWindowDrawList();
    const round = px(S.WindowRoundingPx, 8);
    // Title bar.
    dl.AddRectFilled(new ImVec2(pos.x, pos.y), new ImVec2(pos.x + size.x, pos.y + tb), ku32(S.PanelRaisedU32, [0.12, 0.125, 0.137, 1]), round, 48);
    dl.AddLine(new ImVec2(pos.x + 1, pos.y + 1), new ImVec2(pos.x + size.x - 1, pos.y + 1), ku32(S.TopHighlightU32, [1, 1, 1, 0.07]));
    dl.AddLine(new ImVec2(pos.x, pos.y + tb), new ImVec2(pos.x + size.x, pos.y + tb), ku32(S.HairlineU32));
    const fs = ImGui.GetFontSize();
    // Text through the window (jsimgui's AddText draws nothing without a text end).
    const label = (x: number, y: number, c: number[] | undefined, t: string) => {
      ImGui.SetCursorScreenPos(new ImVec2(x, y));
      ImGui.TextColored(kv4(c), t);
    };
    label(pos.x + pad, pos.y + (tb - fs) / 2, S.TextPrimaryU32, String(w.p.title ?? ''));
    let right = pos.x + size.x - pad;
    if (w.p.closable) {
      const cb = px(S.CloseButtonSizePx, 18), cx = right - cb / 2, cy = pos.y + tb / 2, k = cb * 0.28;
      dl.AddLine(new ImVec2(cx - k, cy - k), new ImVec2(cx + k, cy + k), ku32(S.TextMutedU32), 1.5);
      dl.AddLine(new ImVec2(cx - k, cy + k), new ImVec2(cx + k, cy - k), ku32(S.TextMutedU32), 1.5);
      right -= cb + px(S.TitlebarSignatureGapPx, 10);
    }
    const sig = String(w.p.signature ?? '');
    // jsimgui's CalcTextSize has the same problem; KSA's font is monospaced (0.6 em per character).
    if (sig) label(right - sig.length * fs * 0.6, pos.y + (tb - fs) / 2, S.TextMutedU32, sig);
    // Footer.
    dl.AddRectFilled(new ImVec2(pos.x, pos.y + size.y - fh), new ImVec2(pos.x + size.x, pos.y + size.y), ku32(S.PanelRaisedU32), round, 192);
    dl.AddLine(new ImVec2(pos.x, pos.y + size.y - fh), new ImVec2(pos.x + size.x, pos.y + size.y - fh), ku32(S.HairlineU32));
    if (w.p.footer) label(pos.x + px(S.FooterHorizontalPaddingPx, 10), pos.y + size.y - (fh + fs) / 2, S.TextMutedU32, String(w.p.footer));
    if (open) {
      // Body: SetCursorPos in the generated code is relative to it.
      ImGui.SetCursorPos(new ImVec2(0, tb));
      const cp = px(S.ContentPaddingPx, 8);
      ImGui.PushStyleVarX(ImGuiStyleVar.WindowPadding, cp);
      ImGui.PushStyleVarY(ImGuiStyleVar.WindowPadding, cp);
      const body = ImGui.BeginChild('##body', new ImVec2(size.x, Math.max(1, size.y - tb - fh)), 0, 0);
      ImGui.PopStyleVar(2);
      const o = ImGui.GetWindowPos();
      this.placed.origins.set(w.id, { x: o.x, y: o.y });
      if (body) {
        const n = this.pushWidgetStyle();
        this.children(w);
        ImGui.PopStyleVar(2);
        ImGui.PopStyleColor(n);
      }
      ImGui.EndChild();
    }
    ImGui.End();
  }

  /** What ConsoleStyle.PushWidgetStyle looks like (approximated from its theme values): returns colors pushed. */
  private pushWidgetStyle(): number {
    const cols: [number, number[] | undefined][] = [
      [ImGuiCol.Text, S.TextPrimaryU32], [ImGuiCol.TextDisabled, S.TextMutedU32],
      [ImGuiCol.FrameBg, S.InsetU32], [ImGuiCol.FrameBgHovered, S.PanelRaisedU32], [ImGuiCol.FrameBgActive, S.FrameU32],
      [ImGuiCol.Button, S.PanelRaisedU32], [ImGuiCol.ButtonHovered, S.FrameU32], [ImGuiCol.ButtonActive, S.HairlineU32],
      [ImGuiCol.Header, S.PanelRaisedU32], [ImGuiCol.HeaderHovered, S.FrameU32], [ImGuiCol.HeaderActive, S.HairlineU32],
      [ImGuiCol.CheckMark, S.TextPrimaryU32], [ImGuiCol.SliderGrab, S.ActiveToolU32], [ImGuiCol.SliderGrabActive, S.TextPrimaryU32],
      [ImGuiCol.Border, S.HairlineU32], [ImGuiCol.Separator, S.HairlineU32], [ImGuiCol.PopupBg, S.PanelRaisedU32],
      [ImGuiCol.Tab, S.PanelRaisedU32], [ImGuiCol.TabSelected, S.FrameU32], [ImGuiCol.TabHovered, S.FrameU32],
      [ImGuiCol.PlotHistogram, S.ActiveToolU32], [ImGuiCol.TableHeaderBg, S.PanelRaisedU32],
    ];
    let n = 0;
    for (const [i, c] of cols) if (c) { ImGui.PushStyleColorImVec4(i, kv4(c)); n++; }
    ImGui.PushStyleVar(ImGuiStyleVar.FrameRounding, px(S.FrameRoundingPx, 4));
    ImGui.PushStyleVar(ImGuiStyleVar.FrameBorderSize, 1);
    return n;
  }

  /** The KSA kit's version of a widget; false when it has none (drawn as plain ImGui in the widget style). */
  private ksaNode(n: Node): boolean {
    const p = n.p;
    const labelColumn = () => Math.max(96, ImGui.GetContentRegionAvail().x * 0.42);
    const rule = () => {
      const c = ImGui.GetCursorScreenPos(), wdt = ImGui.GetContentRegionAvail().x, h = px(W.RuleHeightPx, 8);
      ImGui.Dummy(new ImVec2(wdt, h));
      ImGui.GetWindowDrawList().AddLine(new ImVec2(c.x, c.y + h / 2), new ImVec2(c.x + wdt, c.y + h / 2), ku32(S.HairlineU32));
    };
    if (ROW_KINDS.has(n.kind)) {
      const x0 = ImGui.GetCursorPosX(), col = labelColumn();
      ImGui.BeginGroup();
      ImGui.AlignTextToFramePadding();
      ImGui.TextColored(kv4(S.TextLabelU32), String(p.label ?? '').split('##')[0]);
      ImGui.SameLine(x0 + col);
      ImGui.SetNextItemWidth(FILL);
      this.plain({ ...n, p: { ...p, label: `##${n.id}` } });
      ImGui.EndGroup();
      this.item();
      if (p.tooltip) ImGui.SetItemTooltip(p.tooltip);
      return true;
    }
    switch (n.kind) {
      case 'button': {
        const v = p.variant ?? 'normal';
        const tint: Record<string, number[] | undefined> = { positive: S.PositiveU32, danger: S.DangerU32 };
        let pushed = 0;
        if (v === 'primary') {
          ImGui.PushStyleColorImVec4(ImGuiCol.Button, kv4(S.ActiveToolU32)); ImGui.PushStyleColorImVec4(ImGuiCol.ButtonHovered, kv4(S.TextPrimaryU32));
          ImGui.PushStyleColorImVec4(ImGuiCol.Text, kv4(S.PanelU32)); pushed = 3;
        } else if (tint[v]) {
          const c = tint[v]!;
          ImGui.PushStyleColorImVec4(ImGuiCol.Button, new ImVec4(c[0], c[1], c[2], 0.18)); ImGui.PushStyleColorImVec4(ImGuiCol.ButtonHovered, new ImVec4(c[0], c[1], c[2], 0.32));
          ImGui.PushStyleColorImVec4(ImGuiCol.Border, kv4(c)); ImGui.PushStyleColorImVec4(ImGuiCol.Text, kv4(c)); pushed = 4;
        }
        ImGui.Button(p.label || ' ', new ImVec2(0, px(W.ButtonHeight, 28)));
        if (pushed) ImGui.PopStyleColor(pushed);
        this.item();
        if (p.tooltip) ImGui.SetItemTooltip(p.tooltip);
        return true;
      }
      case 'separator': rule(); this.item(); return true;
      case 'readout': {
        const x0 = ImGui.GetCursorPosX();
        ImGui.BeginGroup();
        ImGui.TextColored(kv4(S.TextMutedU32), String(p.key ?? ''));
        ImGui.SameLine(x0 + labelColumn());
        ImGui.TextColored(kv4(S.TextPrimaryU32), String(p.value ?? ''));
        ImGui.EndGroup();
        this.item();
        return true;
      }
      case 'region_header':
        ImGui.BeginGroup();
        ImGui.TextColored(kv4(S.TextLabelU32), String(p.label ?? ''));
        rule();
        ImGui.EndGroup();
        this.item();
        return true;
      case 'segmented': {
        const cur = this.ref(n, () => Math.trunc(p.value) || 0);
        ImGui.BeginGroup();
        list(p.items).forEach((it, k) => {
          if (k) ImGui.SameLine(0, 0);
          ImGui.PushStyleColorImVec4(ImGuiCol.Button, kv4(k === cur[0] ? S.FrameU32 : S.InsetU32));
          if (ImGui.Button(it, new ImVec2(0, px(W.ButtonHeight, 28))) && !this.get().design) cur[0] = k;
          ImGui.PopStyleColor(1);
        });
        ImGui.EndGroup();
        this.item();
        if (p.tooltip) ImGui.SetItemTooltip(p.tooltip);
        return true;
      }
    }
    return false;
  }

  private node(n: Node) {
    if (this.ksa && this.ksaNode(n)) return;
    this.plain(n);
  }

  private plain(n: Node) {
    const p = n.p, L = p.label || ' ';
    const tip = () => p.tooltip && ImGui.SetItemTooltip(p.tooltip);
    switch (n.kind) {
      case 'readout': ImGui.Text(`${p.key ?? ''}  ${p.value ?? ''}`); break;
      case 'region_header': ImGui.SeparatorText(String(p.label ?? '')); break;
      case 'segmented': {
        const cur = this.ref(n, () => Math.trunc(p.value) || 0);
        ImGui.BeginGroup();
        list(p.items).forEach((it, k) => {
          if (k) ImGui.SameLine();
          if (ImGui.RadioButton(it, cur[0] === k)) cur[0] = k;
        });
        ImGui.EndGroup();
        break;
      }
      case 'text': ImGui.Text(String(p.text ?? '')); break;
      case 'text_colored': { const c = p.color ?? [1, 1, 1, 1]; ImGui.TextColored(new ImVec4(c[0], c[1], c[2], c[3]), String(p.text ?? '')); break; }
      case 'text_wrapped': ImGui.TextWrapped(String(p.text ?? '')); break;
      case 'separator': ImGui.Separator(); break;
      case 'spacing': ImGui.Spacing(); break;
      case 'button': ImGui.Button(L); break;
      case 'checkbox': ImGui.Checkbox(L, this.ref(n, () => !!p.value)); break;
      case 'radio': {
        // One value per group, shared by its buttons (like the generated code's variable).
        const g = this.ref(`radio:${p.group}`, () => Math.trunc(p.value) || 0);
        if (ImGui.RadioButton(L, g[0] === Math.trunc(p.option))) g[0] = Math.trunc(p.option);
        break;
      }
      case 'slider_float': ImGui.SliderFloat(L, this.ref(n, () => Number(p.value) || 0), Number(p.min), Number(p.max)); break;
      case 'slider_int': ImGui.SliderInt(L, this.ref(n, () => Math.trunc(p.value) || 0), Math.trunc(p.min), Math.trunc(p.max)); break;
      case 'drag_float': ImGui.DragFloat(L, this.ref(n, () => Number(p.value) || 0), Number(p.speed) || 0.1, Number(p.min), Number(p.max)); break;
      case 'drag_int': ImGui.DragInt(L, this.ref(n, () => Math.trunc(p.value) || 0), Number(p.speed) || 1, Math.trunc(p.min), Math.trunc(p.max)); break;
      case 'input_text': ImGui.InputText(L, this.ref(n, () => String(p.value ?? '')), 1024); break;
      case 'input_multiline': ImGui.InputTextMultiline(L, this.ref(n, () => String(p.value ?? '')), 4096, new ImVec2(n.w, n.h)); break;
      case 'input_double': ImGui.InputDouble(L, this.ref(n, () => Number(p.value) || 0)); break;
      case 'input_int': ImGui.InputInt(L, this.ref(n, () => Math.trunc(p.value) || 0)); break;
      case 'combo': ImGui.Combo(L, this.ref(n, () => Math.trunc(p.value) || 0), list(p.items).join('\0') + '\0'); break;
      case 'list_box': {
        const cur = this.ref(n, () => Math.trunc(p.value) || 0);
        const rows = Math.max(1, Math.trunc(p.rows) || 4);
        if (ImGui.BeginListBox(L, new ImVec2(n.w, rows * ImGui.GetTextLineHeightWithSpacing() + 4))) {
          list(p.items).forEach((it, i) => { if (ImGui.Selectable(it, cur[0] === i)) cur[0] = i; });
          ImGui.EndListBox();
        }
        break;
      }
      case 'color_edit': ImGui.ColorEdit4(L, this.ref(n, () => [...(p.value ?? [1, 1, 1, 1])] as [number, number, number, number])[0]); break;
      case 'selectable': ImGui.SelectableBoolPtr(L, this.ref(n, () => !!p.value)); break;
      case 'progress': ImGui.ProgressBar(Number(p.fraction) || 0, new ImVec2(-1.17549435e-38, 0), p.overlay || undefined); break;
      case 'plot_lines': { const v = numbers(p.values); ImGui.PlotLines(L, v, v.length, 0, undefined, Number.MAX_VALUE, Number.MAX_VALUE, new ImVec2(n.w, n.h)); break; }
      case 'plot_histogram': { const v = numbers(p.values); ImGui.PlotHistogram(L, v, v.length, 0, undefined, Number.MAX_VALUE, Number.MAX_VALUE, new ImVec2(n.w, n.h)); break; }

      case 'child': {
        const open = ImGui.BeginChild(p.id || 'child', new ImVec2(n.w, n.h), p.border ? 1 : 0);
        const pos = ImGui.GetWindowPos();
        this.placed.origins.set(n.id, { x: pos.x, y: pos.y });
        if (open) this.children(n);
        ImGui.EndChild();
        this.item();
        return;
      }
      case 'header':
        if (ImGui.CollapsingHeader(L)) { this.item(); this.children(n); } else this.item();
        return;
      case 'tree':
        if (ImGui.TreeNode(L)) { this.item(); this.children(n); ImGui.TreePop(); } else this.item();
        return;
      case 'tab_bar':
        if (ImGui.BeginTabBar(p.id || 'tabs')) { this.children(n); ImGui.EndTabBar(); }
        return;
      case 'tab':
        if (ImGui.BeginTabItem(L)) { this.item(); this.children(n); ImGui.EndTabItem(); } else this.item();
        return;
      case 'table': {
        const cols = Math.max(1, list(p.columns).length);
        if (ImGui.BeginTable(p.id || 'table', cols, (p.borders ? 1920 : 0) | (p.row_bg ? 64 : 0))) {
          if (p.headers) { for (const c of list(p.columns)) ImGui.TableSetupColumn(c); ImGui.TableHeadersRow(); }
          this.children(n);
          ImGui.EndTable();
          this.item();
        }
        return;
      }
      case 'popup': {
        const design = this.get().design;
        if (ImGui.Button(L) && !design) ImGui.OpenPopup(p.id || 'popup');
        this.item();
        tip();
        if (design) {
          // Popups are closed while designing: show their contents inline, indented, so they can be edited.
          ImGui.Indent();
          this.children(n);
          ImGui.Unindent();
        } else if (ImGui.BeginPopup(p.id || 'popup')) {
          this.children(n);
          ImGui.EndPopup();
        }
        return;
      }
    }
    this.item();
    tip();
  }
}

/** The deepest node whose rect holds the point (smallest area wins among overlaps). */
export function hit(placed: Placed, x: number, y: number, ids: string[]): string | undefined {
  let best: string | undefined, area = Infinity;
  for (const id of ids) {
    const r = placed.rects.get(id);
    if (!r || x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
    const a = (r.x1 - r.x0) * (r.y1 - r.y0);
    if (a <= area) { best = id; area = a; }
  }
  return best;
}
