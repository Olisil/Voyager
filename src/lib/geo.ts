import type { LngLat } from "./project";

/**
 * All animation maths runs in Web Mercator "world" units (0..1 on both axes,
 * y pointing south). Equal distances there are equal distances on screen,
 * which is what makes the line draw at a visually constant speed.
 */
export type XY = [number, number];

export function toXY([lng, lat]: LngLat): XY {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

export function toLngLat([x, y]: XY): LngLat {
  const lng = x * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  return [lng, lat];
}

export function haversineKm(a: LngLat, b: LngLat): number {
  const R = 6371.0088;
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function routeLengthKm(points: LngLat[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1], points[i]);
  return km;
}

/** Centripetal Catmull–Rom through the control points, densified. */
function catmullRom(pts: XY[], perSegment = 16): XY[] {
  if (pts.length < 3) return pts.slice();
  const out: XY[] = [];
  const ext = [pts[0], ...pts, pts[pts.length - 1]];
  const tj = (ti: number, a: XY, b: XY) => ti + Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) + 1e-12;
  for (let i = 0; i < ext.length - 3; i++) {
    const [p0, p1, p2, p3] = [ext[i], ext[i + 1], ext[i + 2], ext[i + 3]];
    const t0 = 0;
    const t1 = tj(t0, p0, p1);
    const t2 = tj(t1, p1, p2);
    const t3 = tj(t2, p2, p3);
    for (let k = 0; k < perSegment; k++) {
      const t = t1 + ((t2 - t1) * k) / perSegment;
      const lerp = (a: XY, b: XY, ta: number, tb: number): XY => {
        const w = tb - ta < 1e-12 ? 0 : (t - ta) / (tb - ta);
        return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
      };
      const a1 = lerp(p0, p1, t0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2);
      const b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Douglas–Peucker in mercator space; keeps long GPS tracks light. */
export function simplify(pts: XY[], tolerance: number): XY[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-30;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / len2));
      const d = Math.hypot(pts[i][0] - (ax + t * dx), pts[i][1] - (ay + t * dy));
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export interface Path {
  xy: XY[];
  lngLat: LngLat[];
  /** cumulative mercator length at each vertex */
  cum: number[];
  length: number;
}

export function buildPath(points: LngLat[], smooth: boolean): Path | null {
  if (points.length < 2) return null;
  let xy = points.map(toXY);
  // Long GPS recordings: simplify until the line is light enough to redraw every frame.
  let tol = 2.5e-8; // ≈ 1 m
  while (xy.length > 3000 && tol < 1e-4) {
    xy = simplify(xy, tol);
    tol *= 2;
  }
  if (smooth) xy = catmullRom(xy, Math.max(2, Math.min(16, Math.floor(20000 / xy.length))));
  // drop zero-length steps
  const clean: XY[] = [xy[0]];
  for (let i = 1; i < xy.length; i++) {
    const p = clean[clean.length - 1];
    if (Math.hypot(xy[i][0] - p[0], xy[i][1] - p[1]) > 1e-14) clean.push(xy[i]);
  }
  if (clean.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < clean.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(clean[i][0] - clean[i - 1][0], clean[i][1] - clean[i - 1][1]));
  }
  return { xy: clean, lngLat: clean.map(toLngLat), cum, length: cum[cum.length - 1] };
}

function segmentAt(path: Path, s: number): number {
  let lo = 0;
  let hi = path.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path.cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Point at mercator arc length s (clamped to the path). */
export function pointAt(path: Path, s: number): XY {
  const d = Math.max(0, Math.min(path.length, s));
  const i = segmentAt(path, d);
  const seg = path.cum[i + 1] - path.cum[i] || 1;
  const w = (d - path.cum[i]) / seg;
  const a = path.xy[i];
  const b = path.xy[i + 1];
  return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
}

/** Coordinates of the path from the start up to arc length s. */
export function sliceTo(path: Path, s: number): LngLat[] {
  if (s <= 0) return [];
  if (s >= path.length) return path.lngLat;
  const i = segmentAt(path, s);
  const out = path.lngLat.slice(0, i + 1);
  out.push(toLngLat(pointAt(path, s)));
  return out;
}

/** Screen bearing (degrees clockwise from north) of the chord between two arc lengths. */
export function chordBearing(path: Path, s0: number, s1: number): number | null {
  const a = pointAt(path, s0);
  const b = pointAt(path, s1);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (Math.hypot(dx, dy) < 1e-14) return null;
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

export function boundsOf(points: LngLat[]): [LngLat, LngLat] | null {
  if (!points.length) return null;
  let [w, s] = points[0];
  let [e, n] = points[0];
  for (const [x, y] of points) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return [
    [w, s],
    [e, n],
  ];
}

/** Reads track points (or route points) from a GPX file. */
export function parseGpx(text: string): LngLat[] {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("The GPX file couldn't be read.");
  for (const tag of ["trkpt", "rtept", "wpt"]) {
    const nodes = Array.from(doc.getElementsByTagNameNS("*", tag));
    const pts: LngLat[] = [];
    for (const n of nodes) {
      const lat = parseFloat(n.getAttribute("lat") ?? "");
      const lon = parseFloat(n.getAttribute("lon") ?? "");
      if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lon, lat]);
    }
    if (pts.length >= 2) return pts;
  }
  throw new Error("No track found in the GPX file. It needs at least two track or route points.");
}
