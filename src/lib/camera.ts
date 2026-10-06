import { chordBearing, pointAt, toLngLat, type Path, type XY } from "./geo";
import { progressAt, type LngLat, type Project } from "./project";

export interface CameraState {
  center: LngLat;
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface FrameState {
  /** Arc length the line is drawn to. */
  s: number;
  /** Tip of the line. */
  tip: LngLat;
  /** Direction of travel at the tip, degrees from north. */
  tipBearing: number;
  /** Camera for this frame, or null to leave the map where the user put it. */
  camera: CameraState | null;
}

const STEADINESS = { tight: 0.06, smooth: 0.22, very: 0.45 } as const;

/** Window [a, b] of the given width around s, slid back inside [0, L] near the ends. */
function window(s: number, before: number, after: number, L: number): [number, number] {
  let a = s - before;
  let b = s + after;
  if (a < 0) {
    b = Math.min(L, b - a);
    a = 0;
  }
  if (b > L) {
    a = Math.max(0, a - (b - L));
    b = L;
  }
  return [a, b];
}

/**
 * Everything about one moment of the video, computed purely from the project and the
 * time. Preview and export both call this, so what you scrub is exactly what renders.
 */
export function frameAt(project: Project, path: Path, t: number, viewport: { width: number; height: number }): FrameState {
  const L = path.length;
  const s = progressAt(project, t) * L;
  const tipXY = pointAt(path, s);
  const cam = project.camera;

  // Size of the short side of the frame, in mercator units, at the chosen zoom.
  const zoom = cam.zoom;
  const span = Math.min(viewport.width, viewport.height) / (512 * Math.pow(2, zoom));

  const [ta, tb] = window(s, span * 0.01, span * 0.01, L);
  const tipBearing = chordBearing(path, ta, tb) ?? 0;

  let camera: CameraState | null = null;
  if (cam.mode === "fixed") {
    camera = cam.fixedView;
  } else {
    const w = STEADINESS[cam.steadiness] * span;
    const ahead = cam.lookAhead * span;
    const target = s + ahead;

    // Triangle-weighted average of points around the target: a low-pass filter on the path.
    let cx = 0;
    let cy = 0;
    let wsum = 0;
    for (let k = -6; k <= 6; k++) {
      const weight = 7 - Math.abs(k);
      const p: XY = pointAt(path, target + (k / 6) * w);
      cx += p[0] * weight;
      cy += p[1] * weight;
      wsum += weight;
    }
    const center = toLngLat([cx / wsum, cy / wsum]);

    let bearing = 0;
    if (cam.up === "travel") {
      const reach = Math.max(w, span * 0.05) * 1.6;
      const [a, b] = window(s, reach, reach + ahead, L);
      bearing = chordBearing(path, a, b) ?? 0;
    }
    camera = { center, zoom, bearing, pitch: cam.pitch };
  }

  return { s, tip: toLngLat(tipXY), tipBearing, camera };
}
