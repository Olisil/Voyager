import type { Map as MLMap } from "maplibre-gl";
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, canEncodeVideo, type VideoCodec } from "mediabunny";
import { frameAt } from "./camera";
import type { Path } from "./geo";
import { showFrame, waitForIdle } from "./mapScene";
import { outputSize, totalTime, type Project } from "./project";

export interface ExportProgress {
  frame: number;
  frames: number;
  elapsedMs: number;
}

export interface ExportResult {
  blob: Blob;
  width: number;
  height: number;
  seconds: number;
  codec: VideoCodec;
}

export class ExportUnsupportedError extends Error {}

function bitrateFor(width: number, height: number, fps: number) {
  // ~0.15 bits per pixel per frame: crisp lines and labels, sane file sizes.
  return Math.round(width * height * fps * 0.15);
}

async function pickCodec(width: number, height: number, bitrate: number): Promise<VideoCodec> {
  if (typeof VideoEncoder === "undefined") {
    throw new ExportUnsupportedError(
      "This browser can't encode video. Use a recent Chrome, Edge or Safari on a computer to render.",
    );
  }
  // H.264 first: every editor opens it. The others are last resorts for browsers without it.
  for (const codec of ["avc", "hevc", "vp9", "av1"] as VideoCodec[]) {
    if (await canEncodeVideo(codec, { width, height, bitrate })) return codec;
  }
  throw new ExportUnsupportedError(
    `This browser can't encode ${width}×${height} MP4 video. Try a lower resolution, or Chrome on a computer.`,
  );
}

/** Small map credit in the bottom-right corner, as OpenStreetMap's licence asks. */
function drawCredit(g: CanvasRenderingContext2D, width: number, height: number, text: string) {
  const size = Math.max(11, Math.round(Math.min(width, height) * 0.014));
  g.font = `500 ${size}px "Barlow Semi Condensed", system-ui, sans-serif`;
  const pad = Math.round(size * 0.55);
  const w = g.measureText(text).width + pad * 2;
  const h = size + pad * 1.2;
  const x = width - w - pad;
  const y = height - h - pad;
  g.fillStyle = "rgba(255,255,255,0.72)";
  g.fillRect(x, y, w, h);
  g.fillStyle = "rgba(24,38,58,0.9)";
  g.textBaseline = "middle";
  g.fillText(text, x + pad, y + h / 2 + 1);
}

/**
 * Renders the project frame by frame on the live map at full output resolution, waiting
 * for every tile before each capture, and encodes the frames to MP4 in the browser.
 */
export async function renderVideo(opts: {
  map: MLMap;
  project: Project;
  path: Path;
  credit: string;
  signal: AbortSignal;
  onProgress: (p: ExportProgress) => void;
}): Promise<ExportResult> {
  const { map, project, path, signal, onProgress } = opts;
  const { width, height } = outputSize(project.output.aspect, project.output.resolution);
  const fps = project.output.fps;
  const bitrate = bitrateFor(width, height, fps);
  const codec = await pickCodec(width, height, bitrate);

  const mapCanvas = map.getCanvas();
  const container = map.getContainer();
  const cssW = container.clientWidth;
  const cssH = container.clientHeight;
  const viewport = { width: cssW, height: cssH };
  const previousRatio = map.getPixelRatio();

  const frameCanvas = document.createElement("canvas");
  frameCanvas.width = width;
  frameCanvas.height = height;
  const g = frameCanvas.getContext("2d", { alpha: false })!;
  g.imageSmoothingQuality = "high";

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const source = new CanvasSource(frameCanvas, { codec, bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: fps });

  const seconds = totalTime(project);
  const frames = Math.max(1, Math.round(seconds * fps));
  const started = performance.now();

  // Render the same CSS-sized view at a higher pixel ratio: identical framing to the preview.
  map.setPixelRatio(width / cssW);
  const interactive = [map.dragPan, map.scrollZoom, map.boxZoom, map.dragRotate, map.keyboard, map.doubleClickZoom, map.touchZoomRotate];
  interactive.forEach((h) => h.disable());

  try {
    await output.start();
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw new DOMException("Render cancelled", "AbortError");
      const t = i / fps;
      showFrame(map, path, frameAt(project, path, t, viewport), true);
      await waitForIdle(map);
      g.drawImage(mapCanvas, 0, 0, mapCanvas.width, mapCanvas.height, 0, 0, width, height);
      if (project.output.credit) drawCredit(g, width, height, opts.credit);
      await source.add(t, 1 / fps);
      onProgress({ frame: i + 1, frames, elapsedMs: performance.now() - started });
    }
    await output.finalize();
  } catch (err) {
    if (output.state !== "finalized") await output.cancel().catch(() => {});
    throw err;
  } finally {
    map.setPixelRatio(previousRatio);
    interactive.forEach((h) => h.enable());
    map.triggerRepaint();
  }

  const buffer = output.target.buffer;
  if (!buffer) throw new Error("The video came out empty. Try rendering again.");
  return { blob: new Blob([buffer], { type: "video/mp4" }), width, height, seconds, codec };
}

/** Text for the burned-in credit, based on the chosen theme. */
export function creditFor(project: Project): string {
  const parts =
    project.style.theme === "satellite"
      ? ["Sentinel-2 cloudless by EOX (Copernicus data 2016)"]
      : ["© OpenStreetMap contributors", "OpenMapTiles", "OpenFreeMap"];
  if (project.style.terrain) parts.push("Mapzen terrain");
  return parts.join(", ");
}
