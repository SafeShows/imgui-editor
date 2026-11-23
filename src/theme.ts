// Preview looks: "ksa" is the game's ImGui style (dumped from the running game by tools/ImGuiStyleDump into
// ksa-style.json) with its JetBrains Mono font; "default" is stock Dear ImGui (dark colors, ProggyClean).
import { ImGui, ImGuiCol, ImVec2, ImVec4 } from '@mori2003/jsimgui';
import ksa from './ksa-style.json';

export type Theme = 'ksa' | 'default';

interface StyleDump {
  vars?: Record<string, number | boolean | number[]>;
  colors?: Record<string, number[]>;
  fontSize?: number;
}

/** Whether ksa-style.json holds the game's real colors (not just the font). */
export const KSA_CAPTURED = !!(ksa as StyleDump).colors;
export const FONT_SIZE: Record<Theme, number> = { ksa: (ksa as StyleDump).fontSize ?? 16, default: 13 };

// Sizes that come from the font and DPI rather than the theme.
const SKIP = new Set(['FontSizeBase', 'FontScaleMain', 'FontScaleDpi']);
let defaults: StyleDump | undefined;

/** Stock style values, read once after StyleColorsDark (so "default" can be restored after "ksa"). */
function snapshot(): StyleDump {
  const s = ImGui.GetStyle() as any;
  const vars: Record<string, any> = {};
  for (const k of Object.keys((ksa as StyleDump).vars ?? {})) {
    const v = s[k];
    vars[k] = v instanceof ImVec2 || (v && typeof v === 'object' && 'x' in v) ? [v.x, v.y] : v;
  }
  return { vars, colors: Object.fromEntries(Object.keys(ImGuiCol).filter(k => !k.startsWith('COUNT')).map(k => [k, (() => { const c = s.Colors[(ImGuiCol as any)[k]]; return [c.x, c.y, c.z, c.w]; })()])) };
}

function apply(d: StyleDump) {
  const s = ImGui.GetStyle() as any;
  for (const [k, v] of Object.entries(d.vars ?? {})) {
    if (SKIP.has(k) || !(k in s)) continue;
    try {
      s[k] = Array.isArray(v) ? new ImVec2(v[0], v[1]) : v;
    } catch { /* a field this ImGui version doesn't have */ }
  }
  if (d.colors) {
    const colors = s.Colors as ImVec4[];
    for (const [k, c] of Object.entries(d.colors)) {
      const i = (ImGuiCol as any)[k];
      if (typeof i === 'number' && i < colors.length) colors[i] = new ImVec4(c[0], c[1], c[2], c[3]);
    }
    s.Colors = colors;
  }
}

/** Call between frames. */
export function setTheme(t: Theme) {
  defaults ??= snapshot();
  apply(defaults);
  if (t === 'ksa') apply(ksa as StyleDump);
}

/** KSA's UI kit theme values (ConsoleStyle colors as [r, g, b, a], sizes in px), for drawing the KSA look. */
export const KIT: { style: Record<string, any>; widgets: Record<string, any> } = {
  style: (ksa as any).ConsoleStyle ?? {},
  widgets: (ksa as any).ConsoleWidgets ?? {},
};
