// The safe-area map drawn (docs/design/ui-sandbox.md §3): the viewport as the glass, the four
// corner arcs the frame rounds, the cut hatched on its edge, every usable segment in green with
// its length, and the table of the custom properties the boot wrote. Pure: SVG and table markup as
// strings over the map, the viewport and the corners.
import type { Corners, ViewportSize } from '../../../shared/lib/devices.ts';
import {
  EDGES,
  lengthOf,
  type Edge,
  type SafeAreaMap,
  type Segment,
} from '../../../shared/lib/safeArea.ts';

const px = (n: number): string => String(Math.round(n * 100) / 100);
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** The band a segment is drawn as: 10px deep along its edge. */
const DEPTH = 10;
const segmentRect = (edge: Edge, s: Segment, v: ViewportSize): string => {
  const n = lengthOf(s);
  const [x, y, w, h] =
    edge === 'left'
      ? [0, s.from, DEPTH, n]
      : edge === 'right'
        ? [v.width - DEPTH, s.from, DEPTH, n]
        : edge === 'top'
          ? [s.from, 0, n, DEPTH]
          : [s.from, v.height - DEPTH, n, DEPTH];
  const label =
    edge === 'left' || edge === 'right'
      ? `<text x="${px(x + (edge === 'left' ? DEPTH + 2 : -2))}" y="${px(y + n / 2)}" text-anchor="${edge === 'left' ? 'start' : 'end'}" dominant-baseline="middle">${px(n)}</text>`
      : `<text x="${px(x + n / 2)}" y="${px(y + (edge === 'top' ? DEPTH + 4 : -3))}" text-anchor="middle">${px(n)}</text>`;
  return `<rect class="seg" x="${px(x)}" y="${px(y)}" width="${px(w)}" height="${px(h)}"/>${label}`;
};

const cutRect = (map: SafeAreaMap, v: ViewportSize): string => {
  if (map.cut === null || map.cutEdge === 'none') return '';
  const depth = map.island ? 37 : 30;
  const gap = map.island ? 11 : 0;
  const s = map.cut;
  const n = lengthOf(s);
  const [x, y, w, h] =
    map.cutEdge === 'left'
      ? [gap, s.from, depth, n]
      : map.cutEdge === 'right'
        ? [v.width - depth - gap, s.from, depth, n]
        : map.cutEdge === 'top'
          ? [s.from, gap, n, depth]
          : [s.from, v.height - depth - gap, n, depth];
  return `<rect class="cut" x="${px(x)}" y="${px(y)}" width="${px(w)}" height="${px(h)}" rx="${map.island ? '14' : '6'}"/>`;
};

const arcs = (c: Corners, v: ViewportSize): string => {
  const corner = (r: number, x: number, y: number, sx: number, sy: number): string =>
    r <= 0
      ? ''
      : `<path class="arc" d="M ${px(x)} ${px(y)} L ${px(x + sx * r)} ${px(y)} A ${px(r)} ${px(r)} 0 0 ${sx * sy > 0 ? '0' : '1'} ${px(x)} ${px(y + sy * r)} Z"/>`;
  return [
    corner(c.tl, 0, 0, 1, 1),
    corner(c.tr, v.width, 0, -1, 1),
    corner(c.br, v.width, v.height, -1, -1),
    corner(c.bl, 0, v.height, 1, -1),
  ].join('');
};

/** The SVG's inner markup for a `viewBox="0 0 W H"`. */
export const drawMap = (map: SafeAreaMap, v: ViewportSize, corners: Corners): string =>
  [
    '<defs><pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="hatch-line" x1="0" y1="0" x2="0" y2="4"/></pattern></defs>',
    `<rect class="glass" x="0.3" y="0.3" width="${px(v.width - 0.6)}" height="${px(v.height - 0.6)}" rx="${px(Math.max(corners.tl, corners.tr, corners.br, corners.bl))}"/>`,
    arcs(corners, v),
    cutRect(map, v),
    ...EDGES.flatMap((edge) => map.edges[edge].map((s) => segmentRect(edge, s, v))),
    `<text x="${px(v.width / 2)}" y="${px(v.height / 2)}" text-anchor="middle" dominant-baseline="middle">${px(v.width)} x ${px(v.height)}  cut ${esc(map.cutEdge)}  ear ${px(map.ear)}</text>`,
  ].join('');

/** The variables table's rows. */
export const mapRows = (vars: Readonly<Record<string, string>>): string =>
  Object.keys(vars)
    .map((k) => `<tr><td>${esc(k)}</td><td>${esc(vars[k] ?? '')}</td></tr>`)
    .join('');
