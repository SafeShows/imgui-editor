import { make, type Kind, type Node, type Project } from './model.ts';

const at = (kind: Kind, x: number, y: number, p: Record<string, any> = {}, children?: Node[], size?: [number, number]): Node => {
  const n = make(kind, x, y);
  Object.assign(n.p, p);
  if (size) [n.w, n.h] = size;
  if (children) n.children = children;
  return n;
};
const flow = (kind: Kind, p: Record<string, any> = {}, children?: Node[]) => at(kind, 0, 0, p, children);

/** A design using every widget: the editor's first document, and what the tests generate. */
export function sample(): Project {
  const flight = at('window', 40, 40, { title: 'Flight panel', closable: true, signature: 'FLT', footer: 'Ready' }, [
    at('text_colored', 8, 30, { text: 'ORBIT', color: [0.4, 0.8, 1, 1] }),
    at('checkbox', 8, 52, { label: 'Warp guard', value: true, tooltip: 'Stops warping below 70 km' }),
    at('slider_float', 8, 78, { label: 'Throttle', value: 0.5 }, undefined, [200, 0]),
    at('combo', 8, 104, { label: 'Hold', items: 'Prograde,Retrograde,Stage 1,2' }, undefined, [200, 0]),
    at('radio', 8, 132, { label: 'Surface', group: 'frame', option: 0 }),
    at('radio', 100, 132, { label: 'Orbit', group: 'frame', option: 1 }),
    at('progress', 8, 158, { fraction: 0.62, overlay: 'Fuel 62%' }),
    at('button', 8, 186, { label: 'Stage', variant: 'positive' }),
    at('popup', 70, 186, { label: 'More...', id: 'more' }, [flow('selectable', { label: 'Show orbit' }), flow('selectable', { label: 'Show vehicle', value: true })]),
    at('region_header', 8, 262, { label: 'Status' }),
    at('readout', 8, 296, { key: 'Apoapsis', value: '182.4 km' }),
    at('segmented', 8, 326, { label: 'Frame view', items: 'Surface,Orbit,Target' }),
  ], [360, 420]);

  const tools = at('window', 400, 40, { title: 'Tools', no_collapse: true }, [
    at('tab_bar', 8, 30, { id: 'tools' }, [
      flow('tab', { label: 'Inputs' }, [
        flow('input_text', { label: 'Name', value: 'Kitten 1' }),
        flow('input_double', { label: 'Altitude', value: 70000 }),
        flow('input_int', { label: 'Count', value: 3 }),
        flow('slider_int', { label: 'Stage', value: 2 }),
        flow('drag_float', { label: 'Offset' }),
        flow('drag_int', { label: 'Steps', same_line: false }),
        flow('color_edit', { label: 'Tint' }),
        flow('input_multiline', { label: '##notes', value: 'Notes "quoted" and \\ backslash\nsecond line 100%' }),
      ]),
      flow('tab', { label: 'Data' }, [
        flow('table', { id: 'bodies', columns: 'Body,Radius' }, [
          flow('text', { text: 'Earth' }), flow('text', { text: '6371 km' }),
          flow('text', { text: 'Luna' }), flow('text', { text: '1737 km' }),
        ]),
        flow('list_box', { label: 'Target', items: 'Earth,Luna,Mars,Stage 1,2' }),
        flow('plot_lines', { label: '##alt', values: '0,2,5,9,14,20' }),
        flow('plot_histogram', { label: '##dv', values: '3,1,4,1,5' }),
      ]),
    ]),
    at('header', 8, 330, { label: 'Advanced' }, [
      flow('tree', { label: 'Engines' }, [flow('text_wrapped', {}), flow('separator'), flow('spacing'), flow('text', { text: 'side', same_line: true })]),
    ]),
    at('child', 8, 370, { id: 'log', border: true }, [at('text', 4, 4, { text: 'log line' })], [300, 60]),
  ], [340, 450]);

  return { windows: [flight, tools] };
}
