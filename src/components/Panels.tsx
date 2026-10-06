import type { Map as MLMap } from "maplibre-gl";
import { Field, Section, Segmented, Slider, Toggle } from "./Controls";
import { THEMES } from "../lib/mapScene";
import { outputSize, totalTime, type Project } from "../lib/project";

type Patch = (fn: (p: Project) => Project) => void;

const COLORS = ["#E8461E", "#0057A8", "#F2B705", "#1E8C5A", "#C2187A", "#18263A", "#FFFFFF"];

export function RoutePanel(props: {
  project: Project;
  patch: Patch;
  drawing: boolean;
  setDrawing: (v: boolean) => void;
  distanceKm: number;
  canUndo: boolean;
  onUndo: () => void;
  onReverse: () => void;
  onClear: () => void;
  onImport: (f: File) => void;
  onFit: () => void;
}) {
  const { project, patch } = props;
  const isGpx = project.route.kind === "gpx";
  const n = project.route.points.length;
  return (
    <>
      <Section
        title="Make the route"
        hint={
          isGpx
            ? "This route comes from a GPS recording. Clear it to draw your own instead."
            : "Click the map to place points along your way. Drag a point to move it, right-click it to remove it."
        }
      >
        {!isGpx && (
          <Segmented
            label="Map mode"
            value={props.drawing ? "draw" : "move"}
            options={[
              { value: "draw", label: "Draw" },
              { value: "move", label: "Move map" },
            ]}
            onChange={(v) => props.setDrawing(v === "draw")}
          />
        )}
        <label className="file-drop">
          <input
            type="file"
            accept=".gpx,application/gpx+xml"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) props.onImport(f);
              e.target.value = "";
            }}
          />
          <span className="file-drop-title">Use a GPX file</span>
          <span className="file-drop-hint">From a watch, bike computer or phone. You can also drop it anywhere on the page.</span>
        </label>
      </Section>

      <Section title="Shape">
        <Toggle
          label="Smooth curves"
          hint="Rounds the corners between your points."
          checked={project.route.smooth}
          onChange={(v) => patch((p) => ({ ...p, route: { ...p.route, smooth: v } }))}
        />
        <div className="button-row">
          <button type="button" className="btn" onClick={props.onUndo} disabled={!props.canUndo}>
            Undo
          </button>
          <button type="button" className="btn" onClick={props.onReverse} disabled={n < 2}>
            Reverse
          </button>
          <button type="button" className="btn" onClick={props.onFit} disabled={n < 2}>
            Show all
          </button>
          <button type="button" className="btn btn-quiet" onClick={props.onClear} disabled={n === 0}>
            Clear
          </button>
        </div>
      </Section>

      <dl className="stats">
        <div>
          <dt>Distance</dt>
          <dd>{props.distanceKm < 10 ? props.distanceKm.toFixed(1) : Math.round(props.distanceKm).toLocaleString("en")} km</dd>
        </div>
        <div>
          <dt>{isGpx ? "Track points" : "Points"}</dt>
          <dd>{n.toLocaleString("en")}</dd>
        </div>
      </dl>
    </>
  );
}

export function StylePanel({ project, patch }: { project: Project; patch: Patch }) {
  const st = project.style;
  const set = (s: Partial<Project["style"]>) => patch((p) => ({ ...p, style: { ...p.style, ...s } }));
  return (
    <>
      <Section title="Map">
        <div className="themes" role="radiogroup" aria-label="Map theme">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={st.theme === t.id}
              className={`theme${st.theme === t.id ? " on" : ""}`}
              onClick={() => set({ theme: t.id })}
            >
              <span className="theme-swatch" style={{ background: t.swatch[0] }} aria-hidden>
                <span style={{ background: t.swatch[1] }} />
                <span style={{ background: t.swatch[2] }} />
              </span>
              {t.label}
            </button>
          ))}
        </div>
        <Toggle label="3D mountains" hint="Raises the terrain. Pair it with some tilt in the camera step." checked={st.terrain} onChange={(v) => set({ terrain: v })} />
      </Section>

      <Section title="Line">
        <Field label="Colour">
          <div className="colors">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`color${st.lineColor.toLowerCase() === c.toLowerCase() ? " on" : ""}`}
                style={{ background: c }}
                aria-label={`Line colour ${c}`}
                onClick={() => set({ lineColor: c })}
              />
            ))}
            <label className="color color-custom" aria-label="Custom line colour">
              <input type="color" value={st.lineColor} onChange={(e) => set({ lineColor: e.target.value.toUpperCase() })} />
            </label>
          </div>
        </Field>
        <Slider label="Thickness" value={st.lineWidth} min={2} max={14} step={1} format={(v) => `${v} px`} onChange={(v) => set({ lineWidth: v })} />
        <Field label="At the tip">
          <Segmented
            label="Symbol at the tip"
            value={st.symbol}
            options={[
              { value: "arrow", label: "Arrow" },
              { value: "dot", label: "Dot" },
              { value: "none", label: "Nothing" },
            ]}
            onChange={(v) => set({ symbol: v })}
          />
        </Field>
        <Toggle label="Show the way ahead" hint="A faint dashed line for the part not travelled yet." checked={st.showAhead} onChange={(v) => set({ showAhead: v })} />
      </Section>
    </>
  );
}

export function CameraPanel({ project, patch, map, onFrameRoute }: { project: Project; patch: Patch; map: MLMap | null; onFrameRoute: () => void }) {
  const cam = project.camera;
  const set = (c: Partial<Project["camera"]>) => patch((p) => ({ ...p, camera: { ...p.camera, ...c } }));
  const setTiming = (c: Partial<Project["timing"]>) => patch((p) => ({ ...p, timing: { ...p.timing, ...c } }));
  const useView = () => {
    if (!map) return;
    const c = map.getCenter();
    set({ fixedView: { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() } });
  };
  return (
    <>
      <Section title="Movement">
        <Segmented
          stacked
          label="Camera movement"
          value={cam.mode}
          options={[
            { value: "follow", label: "Follow the line", hint: "Stays with the tip as it travels" },
            { value: "fixed", label: "Fixed view", hint: "Films exactly the view you set" },
          ]}
          onChange={(v) => set({ mode: v })}
        />
      </Section>

      {cam.mode === "follow" ? (
        <Section title="Framing">
          <Slider label="Zoom" value={cam.zoom} min={3} max={16} step={0.1} format={(v) => v.toFixed(1)} ends={["Wide", "Close"]} onChange={(v) => set({ zoom: v })} />
          <button
            type="button"
            className="btn btn-link"
            disabled={!map}
            onClick={() => map && set({ zoom: Math.round(map.getZoom() * 10) / 10, pitch: Math.round(map.getPitch()) })}
          >
            Use the map's current zoom and tilt
          </button>
          <Field label="Which way is up">
            <Segmented
              label="Which way is up"
              value={cam.up}
              options={[
                { value: "travel", label: "Direction of travel" },
                { value: "north", label: "North" },
              ]}
              onChange={(v) => set({ up: v })}
            />
          </Field>
          <Field label="Look ahead">
            <Segmented
              label="Look ahead"
              value={cam.lookAhead}
              options={[
                { value: 0, label: "Tip centred" },
                { value: 0.15, label: "A little" },
                { value: 0.3, label: "More" },
              ]}
              onChange={(v) => set({ lookAhead: v })}
            />
          </Field>
          <Field label="Steadiness">
            <Segmented
              label="Camera steadiness"
              value={cam.steadiness}
              options={[
                { value: "tight", label: "Tight" },
                { value: "smooth", label: "Smooth" },
                { value: "very", label: "Very smooth" },
              ]}
              onChange={(v) => set({ steadiness: v })}
            />
          </Field>
          <Slider label="Tilt" value={cam.pitch} min={0} max={65} step={1} format={(v) => `${v}°`} ends={["Flat", "Flyover"]} onChange={(v) => set({ pitch: v })} />
        </Section>
      ) : (
        <Section
          title="Framing"
          hint={cam.fixedView ? "The video uses the saved view. Move the map and save again to change it." : "Move and zoom the map until the frame shows what you want, then save the view."}
        >
          <div className="button-row">
            <button type="button" className="btn btn-primary" onClick={useView} disabled={!map}>
              Use this view
            </button>
            <button type="button" className="btn" onClick={onFrameRoute} disabled={!map}>
              Frame the whole route
            </button>
          </div>
        </Section>
      )}

      <Section title="Timing">
        <Slider label="Line travel time" value={project.timing.duration} min={3} max={60} step={0.5} format={(v) => `${v} s`} onChange={(v) => setTiming({ duration: v })} />
        <Segmented
          label="Speed"
          value={project.timing.easing}
          options={[
            { value: "ease", label: "Ease in and out" },
            { value: "steady", label: "Steady" },
          ]}
          onChange={(v) => setTiming({ easing: v })}
        />
      </Section>
    </>
  );
}

export type RenderState =
  | { status: "idle" }
  | { status: "rendering"; frame: number; frames: number; elapsedMs: number }
  | { status: "done"; url: string; blob: Blob; width: number; height: number; codec: string }
  | { status: "error"; message: string };

function clock(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ExportPanel(props: {
  project: Project;
  patch: Patch;
  canRender: boolean;
  render: RenderState;
  onRender: () => void;
  onCancel: () => void;
  onDownload: () => void;
}) {
  const { project, patch, render } = props;
  const out = project.output;
  const set = (o: Partial<Project["output"]>) => patch((p) => ({ ...p, output: { ...p.output, ...o } }));
  const setTiming = (c: Partial<Project["timing"]>) => patch((p) => ({ ...p, timing: { ...p.timing, ...c } }));
  const size = outputSize(out.aspect, out.resolution);
  const seconds = totalTime(project);
  const frames = Math.round(seconds * out.fps);
  const busy = render.status === "rendering";

  return (
    <>
      <Section title="Video">
        <Field label="Resolution">
          <Segmented
            label="Resolution"
            value={out.resolution}
            disabled={busy}
            options={[
              { value: 720, label: "720p" },
              { value: 1080, label: "1080p" },
              { value: 2160, label: "4K" },
            ]}
            onChange={(v) => set({ resolution: v })}
          />
        </Field>
        <Field label="Frame rate">
          <Segmented
            label="Frame rate"
            value={out.fps}
            disabled={busy}
            options={[
              { value: 24, label: "24" },
              { value: 25, label: "25" },
              { value: 30, label: "30" },
              { value: 60, label: "60" },
            ]}
            onChange={(v) => set({ fps: v })}
          />
        </Field>
        <Slider label="Still at the start" value={project.timing.holdStart} min={0} max={3} step={0.5} format={(v) => `${v} s`} onChange={(v) => setTiming({ holdStart: v })} />
        <Slider label="Still at the end" value={project.timing.holdEnd} min={0} max={4} step={0.5} format={(v) => `${v} s`} onChange={(v) => setTiming({ holdEnd: v })} />
        <Toggle
          label="Map credit in the corner"
          hint="OpenStreetMap's licence asks for credit wherever the map is shown. Turn it off only if you credit it elsewhere."
          checked={out.credit}
          onChange={(v) => set({ credit: v })}
        />
      </Section>

      <div className="render">
        <p className="render-summary">
          {size.width} × {size.height} MP4, {seconds.toFixed(1)} s, {frames.toLocaleString("en")} frames
        </p>

        {render.status === "rendering" ? (
          <>
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={render.frames} aria-valuenow={render.frame}>
              <span style={{ width: `${(100 * render.frame) / Math.max(1, render.frames)}%` }} />
            </div>
            <p className="hint">
              Frame {render.frame.toLocaleString("en")} of {render.frames.toLocaleString("en")}
              {render.frame > 5 && `, about ${clock((render.elapsedMs / render.frame) * (render.frames - render.frame))} left`}. Keep this tab open and in front.
            </p>
            <button type="button" className="btn" onClick={props.onCancel}>
              Stop rendering
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary btn-big" onClick={props.onRender} disabled={!props.canRender}>
            Render video
          </button>
        )}
        {!props.canRender && render.status !== "rendering" && <p className="hint">Draw a route with at least two points first.</p>}

        {render.status === "error" && (
          <p className="error" role="alert">
            {render.message}
          </p>
        )}
        {render.status === "done" && (
          <div className="result">
            <video src={render.url} controls playsInline muted />
            {render.codec !== "avc" && (
              <p className="hint">
                This browser can't make H.264, so the video uses {render.codec.toUpperCase()}. Some video editors won't open it; render in
                Chrome or Edge for the most compatible file.
              </p>
            )}
            <button type="button" className="btn btn-primary" onClick={props.onDownload}>
              Download MP4
            </button>
          </div>
        )}
      </div>
    </>
  );
}
