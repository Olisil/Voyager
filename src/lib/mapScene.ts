import maplibregl, { type GeoJSONSource, type Map as MLMap, type StyleSpecification } from "maplibre-gl";
import type { FrameState } from "./camera";
import { sliceTo, type Path } from "./geo";
import type { LngLat, Project, ThemeId } from "./project";

export interface Theme {
  id: ThemeId;
  label: string;
  /** land, water, accent — used to draw the swatch */
  swatch: [string, string, string];
  style: string | StyleSpecification;
}

const satellite: StyleSpecification = {
  version: 8,
  sources: {
    sat: {
      type: "raster",
      tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"],
      tileSize: 256,
      maxzoom: 14,
      attribution:
        '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016)',
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0e2230" } },
    { id: "sat", type: "raster", source: "sat" },
  ],
};

export const THEMES: Theme[] = [
  { id: "positron", label: "Light", swatch: ["#f2f2f0", "#cfd8dc", "#b9b9b9"], style: "https://tiles.openfreemap.org/styles/positron" },
  { id: "liberty", label: "Road atlas", swatch: ["#f8f4f0", "#a0c8f0", "#e9ac77"], style: "https://tiles.openfreemap.org/styles/liberty" },
  { id: "bright", label: "Bright", swatch: ["#f8f4f0", "#a0c8f0", "#fdbf6f"], style: "https://tiles.openfreemap.org/styles/bright" },
  { id: "dark", label: "Dark", swatch: ["#0e0e0e", "#252525", "#555"], style: "https://tiles.openfreemap.org/styles/dark" },
  { id: "fiord", label: "Fiord", swatch: ["#45516e", "#38435c", "#7a8aa6"], style: "https://tiles.openfreemap.org/styles/fiord" },
  { id: "satellite", label: "Satellite", swatch: ["#3e5a3a", "#16324a", "#a39572"], style: satellite },
];

const TERRAIN_TILES = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";

export const SRC = { full: "fv-full", drawn: "fv-drawn", tip: "fv-tip", ctrl: "fv-ctrl", dem: "fv-dem" } as const;
export const LYR = {
  hillshade: "fv-hillshade",
  ahead: "fv-ahead",
  casing: "fv-casing",
  line: "fv-line",
  dot: "fv-dot",
  arrow: "fv-arrow",
  ctrl: "fv-ctrl",
  ctrlEnds: "fv-ctrl-ends",
} as const;

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function createMap(container: HTMLElement, project: Project, center?: LngLat, zoom?: number): MLMap {
  const theme = THEMES.find((t) => t.id === project.style.theme) ?? THEMES[0];
  return new maplibregl.Map({
    container,
    style: theme.style,
    center: center ?? [18.07, 59.33],
    zoom: zoom ?? 8,
    attributionControl: { compact: true },
    // Needed so finished frames can be copied off the canvas for the video.
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
    maxCanvasSize: [8192, 8192],
    maxPitch: 70,
    fadeDuration: 0,
  });
}

/** An arrowhead pointing north, in the line colour with a white rim. */
function arrowImage(color: string, px = 2): ImageData {
  const size = 30 * px;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.scale(px, px);
  g.translate(15, 15);
  g.beginPath();
  g.moveTo(0, -12);
  g.lineTo(10, 11);
  g.lineTo(0, 5.5);
  g.lineTo(-10, 11);
  g.closePath();
  g.lineJoin = "round";
  g.shadowColor = "rgba(10, 20, 35, 0.35)";
  g.shadowBlur = 3;
  g.shadowOffsetY = 1;
  g.fillStyle = color;
  g.fill();
  g.shadowColor = "transparent";
  g.lineWidth = 2.4;
  g.strokeStyle = "#fff";
  g.stroke();
  return g.getImageData(0, 0, size, size);
}

function firstSymbolLayer(map: MLMap): string | undefined {
  return map.getStyle().layers?.find((l) => l.type === "symbol")?.id;
}

/** Adds the app's sources and layers. Safe to call again after a style change. */
export function installScene(map: MLMap, project: Project) {
  const st = project.style;
  const below = firstSymbolLayer(map);

  for (const id of [SRC.full, SRC.drawn, SRC.tip, SRC.ctrl]) {
    if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: EMPTY });
  }
  if (!map.getSource(SRC.dem)) {
    map.addSource(SRC.dem, {
      type: "raster-dem",
      tiles: [TERRAIN_TILES],
      tileSize: 256,
      maxzoom: 15,
      encoding: "terrarium",
      attribution:
        '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Terrain tiles: Mapzen &amp; others</a>',
    });
  }

  if (map.hasImage("fv-arrow")) map.updateImage("fv-arrow", arrowImage(st.lineColor));
  else map.addImage("fv-arrow", arrowImage(st.lineColor), { pixelRatio: 2 });

  if (!map.getLayer(LYR.hillshade)) {
    map.addLayer(
      {
        id: LYR.hillshade,
        type: "hillshade",
        source: SRC.dem,
        layout: { visibility: "none" },
        paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#3d4a55" },
      },
      below,
    );
  }
  if (!map.getLayer(LYR.ahead)) {
    map.addLayer(
      {
        id: LYR.ahead,
        type: "line",
        source: SRC.full,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": st.lineColor, "line-opacity": 0.35, "line-width": 2, "line-dasharray": [1.5, 2] },
      },
      below,
    );
  }
  if (!map.getLayer(LYR.casing)) {
    map.addLayer(
      {
        id: LYR.casing,
        type: "line",
        source: SRC.drawn,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-width": st.lineWidth + 4, "line-opacity": 0.9 },
      },
      below,
    );
  }
  if (!map.getLayer(LYR.line)) {
    map.addLayer(
      {
        id: LYR.line,
        type: "line",
        source: SRC.drawn,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": st.lineColor, "line-width": st.lineWidth },
      },
      below,
    );
  }
  if (!map.getLayer(LYR.dot)) {
    map.addLayer({
      id: LYR.dot,
      type: "circle",
      source: SRC.tip,
      paint: {
        "circle-radius": st.lineWidth * 0.9 + 3,
        "circle-color": st.lineColor,
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 2.5,
        "circle-pitch-alignment": "map",
      },
    });
  }
  if (!map.getLayer(LYR.arrow)) {
    map.addLayer({
      id: LYR.arrow,
      type: "symbol",
      source: SRC.tip,
      layout: {
        "icon-image": "fv-arrow",
        "icon-rotate": ["get", "bearing"],
        "icon-rotation-alignment": "map",
        "icon-pitch-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-size": 0.7 + st.lineWidth / 14,
      },
    });
  }
  if (!map.getLayer(LYR.ctrl)) {
    map.addLayer({
      id: LYR.ctrl,
      type: "circle",
      source: SRC.ctrl,
      paint: {
        "circle-radius": 5,
        "circle-color": "#ffffff",
        "circle-stroke-color": "#0057A8",
        "circle-stroke-width": 2,
      },
    });
  }
  if (!map.getLayer(LYR.ctrlEnds)) {
    map.addLayer({
      id: LYR.ctrlEnds,
      type: "circle",
      source: SRC.ctrl,
      filter: ["has", "end"],
      paint: {
        "circle-radius": 7,
        "circle-color": ["match", ["get", "end"], "start", "#0057A8", "#18263A"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2.5,
      },
    });
  }
  applyStyleOptions(map, project);
}

export function applyStyleOptions(map: MLMap, project: Project) {
  if (!map.getLayer(LYR.line)) return;
  const st = project.style;
  map.setPaintProperty(LYR.line, "line-color", st.lineColor);
  map.setPaintProperty(LYR.line, "line-width", st.lineWidth);
  map.setPaintProperty(LYR.casing, "line-width", st.lineWidth + 4);
  map.setPaintProperty(LYR.ahead, "line-color", st.lineColor);
  map.setLayoutProperty(LYR.ahead, "visibility", st.showAhead ? "visible" : "none");
  map.setPaintProperty(LYR.dot, "circle-color", st.lineColor);
  map.setPaintProperty(LYR.dot, "circle-radius", st.lineWidth * 0.9 + 3);
  map.setLayoutProperty(LYR.dot, "visibility", st.symbol === "dot" ? "visible" : "none");
  map.setLayoutProperty(LYR.arrow, "visibility", st.symbol === "arrow" ? "visible" : "none");
  map.setLayoutProperty(LYR.arrow, "icon-size", 0.7 + st.lineWidth / 14);
  if (map.hasImage("fv-arrow")) map.updateImage("fv-arrow", arrowImage(st.lineColor));

  map.setLayoutProperty(LYR.hillshade, "visibility", st.terrain ? "visible" : "none");
  const terrainOn = !!map.getTerrain();
  if (st.terrain && !terrainOn) map.setTerrain({ source: SRC.dem, exaggeration: 1.4 });
  if (!st.terrain && terrainOn) map.setTerrain(null);
}

export function setTheme(map: MLMap, project: Project, onReady: () => void) {
  const theme = THEMES.find((t) => t.id === project.style.theme) ?? THEMES[0];
  map.once("style.load", () => {
    installScene(map, project);
    onReady();
  });
  map.setStyle(theme.style, { diff: false });
}

function src(map: MLMap, id: string): GeoJSONSource | undefined {
  return map.getSource(id) as GeoJSONSource | undefined;
}

function line(coords: LngLat[]): GeoJSON.FeatureCollection {
  if (coords.length < 2) return EMPTY;
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] };
}

/** Editing view: whole route, plus handles for drawn control points. */
export function showEditing(map: MLMap, project: Project, path: Path | null) {
  const full = path ? path.lngLat : [];
  src(map, SRC.full)?.setData(EMPTY);
  src(map, SRC.drawn)?.setData(line(full));
  src(map, SRC.tip)?.setData(EMPTY);
  const pts = project.route.kind === "drawn" ? project.route.points : project.route.points.length ? [project.route.points[0], project.route.points[project.route.points.length - 1]] : [];
  src(map, SRC.ctrl)?.setData({
    type: "FeatureCollection",
    features: pts.map((p, i) => ({
      type: "Feature",
      properties: { i, ...(i === 0 ? { end: "start" } : i === pts.length - 1 ? { end: "finish" } : {}) },
      geometry: { type: "Point", coordinates: p },
    })),
  });
}

/** Animation view: the line drawn up to the frame, the tip, and optionally the camera. */
export function showFrame(map: MLMap, path: Path, frame: FrameState, moveCamera: boolean) {
  src(map, SRC.ctrl)?.setData(EMPTY);
  src(map, SRC.full)?.setData(line(path.lngLat));
  src(map, SRC.drawn)?.setData(line(sliceTo(path, frame.s)));
  src(map, SRC.tip)?.setData({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { bearing: frame.tipBearing }, geometry: { type: "Point", coordinates: frame.tip } }],
  });
  if (moveCamera && frame.camera) map.jumpTo(frame.camera);
}

/** Resolves once every tile and source update for the current view has been drawn. */
export function waitForIdle(map: MLMap, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      map.off("idle", finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    map.on("idle", finish);
    map.triggerRepaint();
  });
}
