export type LngLat = [number, number];

export type ThemeId = "positron" | "liberty" | "bright" | "dark" | "fiord" | "satellite";
export type SymbolId = "arrow" | "dot" | "none";
export type Aspect = "16:9" | "9:16" | "1:1" | "4:5";
export type Resolution = 720 | 1080 | 2160;
export type Fps = 24 | 25 | 30 | 60;

export interface SavedView {
  center: LngLat;
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface Project {
  version: 1;
  name: string;
  route: {
    points: LngLat[];
    /** "drawn" points are editable control points; "gpx" is a recorded track. */
    kind: "drawn" | "gpx";
    smooth: boolean;
  };
  style: {
    theme: ThemeId;
    terrain: boolean;
    lineColor: string;
    lineWidth: number;
    symbol: SymbolId;
    showAhead: boolean;
  };
  camera: {
    mode: "follow" | "fixed";
    zoom: number;
    pitch: number;
    up: "north" | "travel";
    lookAhead: 0 | 0.15 | 0.3;
    steadiness: "tight" | "smooth" | "very";
    fixedView: SavedView | null;
  };
  timing: {
    duration: number;
    holdStart: number;
    holdEnd: number;
    easing: "steady" | "ease";
  };
  output: {
    aspect: Aspect;
    resolution: Resolution;
    fps: Fps;
    credit: boolean;
  };
}

export const ASPECTS: Record<Aspect, number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:5": 4 / 5,
};

/** Output pixel size; the short side equals the chosen resolution. Always even. */
export function outputSize(aspect: Aspect, res: Resolution): { width: number; height: number } {
  const r = ASPECTS[aspect];
  const even = (n: number) => Math.round(n / 2) * 2;
  return r >= 1 ? { width: even(res * r), height: res } : { width: res, height: even(res / r) };
}

export function newProject(): Project {
  return {
    version: 1,
    name: "Untitled trip",
    route: { points: [], kind: "drawn", smooth: true },
    style: {
      theme: "positron",
      terrain: false,
      lineColor: "#E8461E",
      lineWidth: 6,
      symbol: "arrow",
      showAhead: true,
    },
    camera: {
      mode: "follow",
      zoom: 9,
      pitch: 30,
      up: "travel",
      lookAhead: 0.15,
      steadiness: "smooth",
      fixedView: null,
    },
    timing: { duration: 12, holdStart: 1, holdEnd: 1.5, easing: "ease" },
    output: { aspect: "16:9", resolution: 1080, fps: 30, credit: true },
  };
}

/** A short ferry-and-road hop through the Stockholm archipelago, so the editor never opens empty. */
export function demoProject(): Project {
  const p = newProject();
  p.name = "Stockholm to Sandhamn";
  p.route.points = [
    [18.0717, 59.3247],
    [18.1105, 59.3205],
    [18.1702, 59.3343],
    [18.2525, 59.3395],
    [18.3271, 59.3602],
    [18.4122, 59.3533],
    [18.5045, 59.3721],
    [18.6338, 59.3699],
    [18.7581, 59.3866],
    [18.8705, 59.3846],
    [18.9112, 59.2876],
  ];
  return p;
}

/** Merge unknown JSON into a valid project, keeping defaults for anything missing. */
export function coerceProject(raw: unknown): Project {
  const base = newProject();
  if (!raw || typeof raw !== "object") throw new Error("This file isn't a Färdväg project.");
  const r = raw as Partial<Project>;
  if (!r.route || !Array.isArray(r.route.points)) throw new Error("This file isn't a Färdväg project.");
  return {
    ...base,
    ...r,
    version: 1,
    route: { ...base.route, ...r.route },
    style: { ...base.style, ...r.style },
    camera: { ...base.camera, ...r.camera },
    timing: { ...base.timing, ...r.timing },
    output: { ...base.output, ...r.output },
  };
}

export function totalTime(p: Project): number {
  return p.timing.holdStart + p.timing.duration + p.timing.holdEnd;
}

/** Fraction of the route drawn at time t (seconds). */
export function progressAt(p: Project, t: number): number {
  const { holdStart, duration, easing } = p.timing;
  const x = Math.min(1, Math.max(0, (t - holdStart) / Math.max(0.001, duration)));
  return easing === "ease" ? 0.5 - 0.5 * Math.cos(Math.PI * x) : x;
}
