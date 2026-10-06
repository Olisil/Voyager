import type { Map as MLMap } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Segmented } from "./components/Controls";
import { MapStage } from "./components/MapStage";
import { CameraPanel, ExportPanel, RoutePanel, StylePanel, type RenderState } from "./components/Panels";
import { frameAt } from "./lib/camera";
import { creditFor, ExportUnsupportedError, renderVideo } from "./lib/exporter";
import { boundsOf, buildPath, parseGpx, routeLengthKm } from "./lib/geo";
import { applyStyleOptions, setTheme, showEditing, showFrame, SRC } from "./lib/mapScene";
import { ASPECTS, newProject, totalTime, type Aspect, type LngLat, type Project } from "./lib/project";
import { autosave, downloadBlob, loadAutosave, readProjectFile, saveProjectFile, slug } from "./lib/storage";

type Step = "route" | "style" | "camera" | "export";
const STEPS: { id: Step; label: string }[] = [
  { id: "route", label: "Route" },
  { id: "style", label: "Style" },
  { id: "camera", label: "Camera" },
  { id: "export", label: "Export" },
];

function fmtTime(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export default function App() {
  const [project, setProject] = useState<Project>(loadAutosave);
  const [history, setHistory] = useState<LngLat[][]>([]);
  const [step, setStep] = useState<Step>("route");
  const [map, setMap] = useState<MLMap | null>(null);
  const [styleVersion, setStyleVersion] = useState(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [drawing, setDrawing] = useState(true);
  const [render, setRender] = useState<RenderState>({ status: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [dragOver, setDragOver] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadedTheme = useRef(project.style.theme);
  const rendering = render.status === "rendering";

  const path = useMemo(() => buildPath(project.route.points, project.route.smooth), [project.route.points, project.route.smooth]);
  const distanceKm = useMemo(() => routeLengthKm(path?.lngLat ?? []), [path]);
  const duration = totalTime(project);

  const patch = useCallback((fn: (p: Project) => Project) => setProject(fn), []);

  const projectRef = useRef(project);
  const dragOrigin = useRef<LngLat[] | null>(null);
  projectRef.current = project;
  const setRoute = useCallback((points: LngLat[], kind: Project["route"]["kind"] = "drawn", commit = true) => {
    if (commit) {
      const before = projectRef.current.route.points;
      setHistory((h) => [...h.slice(-99), before]);
    }
    setProject((p) => ({ ...p, route: { ...p.route, points, kind } }));
  }, []);

  // ---- persistence
  useEffect(() => {
    const id = setTimeout(() => autosave(project), 400);
    return () => clearTimeout(id);
  }, [project]);

  // ---- stage sizing: the map frame keeps the video's shape inside whatever space there is
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ratio = ASPECTS[project.output.aspect];
    const fit = () => {
      const pad = window.innerWidth < 820 ? 12 : 28;
      const aw = Math.max(100, el.clientWidth - pad * 2);
      const ah = Math.max(100, el.clientHeight - pad * 2);
      const w = Math.min(aw, ah * ratio);
      setFrame({ w: Math.floor(w), h: Math.floor(w / ratio) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [project.output.aspect]);

  // ---- map: theme and style options
  useEffect(() => {
    if (!map || loadedTheme.current === project.style.theme) return;
    loadedTheme.current = project.style.theme;
    setTheme(map, project, () => setStyleVersion((v) => v + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, project.style.theme]);

  useEffect(() => {
    if (map) applyStyleOptions(map, project);
  }, [map, styleVersion, project.style]);

  const fitRoute = useCallback(
    (points: LngLat[], animate = true) => {
      const b = boundsOf(points);
      if (!map || !b) return;
      map.fitBounds(b, { padding: Math.min(80, frame.w / 8), duration: animate ? 700 : 0, bearing: 0, pitch: 0, maxZoom: 14 });
    },
    [map, frame.w],
  );

  const onMapReady = useCallback((m: MLMap) => {
    setMap(m);
    setStyleVersion((v) => v + 1);
  }, []);

  // Frame the route once when the map first appears.
  const didFit = useRef(false);
  useEffect(() => {
    if (map && !didFit.current && frame.w > 0) {
      didFit.current = true;
      fitRoute(project.route.points, false);
    }
  }, [map, frame.w, fitRoute, project.route.points]);

  // ---- what the map shows
  const editing = step === "route" && !playing && !previewing;
  useEffect(() => {
    // Not isStyleLoaded(): that stays false while any source is fetching, which is most of the time.
    if (!map || rendering || !map.getSource(SRC.drawn)) return;
    if (editing || !path) {
      showEditing(map, project, path);
      return;
    }
    showFrame(map, path, frameAt(project, path, t, { width: frame.w, height: frame.h }), true);
  }, [map, styleVersion, project, path, t, editing, rendering, frame.w, frame.h]);

  // ---- playback
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      let done = false;
      setT((prev) => {
        const next = prev + dt;
        if (next >= duration) {
          done = true;
          return duration;
        }
        return next;
      });
      if (done) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);

  useEffect(() => {
    if (t > duration) setT(duration);
  }, [t, duration]);

  const togglePlay = useCallback(() => {
    if (!path || rendering) return;
    if (!playing && t >= duration - 0.01) setT(0);
    setPlaying(!playing);
  }, [path, rendering, playing, t, duration]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.code !== "Space" || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tag)) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay]);

  // ---- route editing
  const importGpx = useCallback(
    async (file: File) => {
      try {
        const pts = parseGpx(await file.text());
        setRoute(pts, "gpx");
        setProject((p) => ({ ...p, route: { ...p.route, smooth: false }, name: p.route.points.length ? p.name : file.name.replace(/\.gpx$/i, "") }));
        fitRoute(pts);
        if (map) {
          const b = boundsOf(pts)!;
          const cam = map.cameraForBounds(b, { padding: 40 });
          if (cam?.zoom !== undefined) {
            const z = Math.min(14, Math.round((cam.zoom + 2) * 10) / 10);
            setProject((p) => ({ ...p, camera: { ...p.camera, zoom: z } }));
          }
        }
        setNotice(`Loaded ${pts.length.toLocaleString("en")} track points from ${file.name}.`);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "The GPX file couldn't be read.");
      }
    },
    [setRoute, fitRoute, map],
  );

  const openProject = useCallback(
    async (file: File) => {
      try {
        const p = await readProjectFile(file);
        setProject(p);
        setHistory([]);
        setT(0);
        fitRoute(p.route.points);
        setNotice(`Opened ${p.name}.`);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "That file couldn't be opened.");
      }
    },
    [fitRoute],
  );

  const handleFile = useCallback(
    (file: File) => {
      if (/\.gpx$/i.test(file.name)) importGpx(file);
      else if (/\.json$/i.test(file.name)) openProject(file);
      else setNotice("Drop a .gpx track or a .fardvag.json project file.");
    },
    [importGpx, openProject],
  );

  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragOver(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragOver(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) handleFile(f);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [handleFile]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  // ---- export
  const startRender = useCallback(async () => {
    if (!map || !path) return;
    setPlaying(false);
    const ac = new AbortController();
    abortRef.current = ac;
    if (render.status === "done") URL.revokeObjectURL(render.url);
    setRender({ status: "rendering", frame: 0, frames: Math.round(duration * project.output.fps), elapsedMs: 0 });
    let lock: WakeLockSentinel | null = null;
    try {
      lock = (await navigator.wakeLock?.request("screen").catch(() => null)) ?? null;
      const res = await renderVideo({
        map,
        project,
        path,
        credit: creditFor(project),
        signal: ac.signal,
        onProgress: (p) => setRender({ status: "rendering", ...p }),
      });
      setRender({ status: "done", url: URL.createObjectURL(res.blob), blob: res.blob, width: res.width, height: res.height, codec: res.codec });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") setRender({ status: "idle" });
      else
        setRender({
          status: "error",
          message:
            err instanceof ExportUnsupportedError
              ? err.message
              : `Rendering stopped: ${err instanceof Error ? err.message : String(err)}`,
        });
    } finally {
      lock?.release().catch(() => {});
      abortRef.current = null;
      setStyleVersion((v) => v + 1);
    }
  }, [map, path, project, duration, render]);

  const step_i = STEPS.findIndex((s) => s.id === step);
  const next = STEPS[step_i + 1];

  return (
    <div className={`app${dragOver ? " is-dragover" : ""}`}>
      <aside className="panel">
        <header className="panel-head">
          <div className="brand">
            <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden>
              <rect width="32" height="32" rx="6" fill="var(--sign)" />
              <path d="M7 23c4-1 5-8 9-9s6 3 9-5" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <span>Färdväg</span>
          </div>
          <div className="file-actions">
            <label className="btn btn-small">
              Open
              <input
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) openProject(f);
                  e.target.value = "";
                }}
              />
            </label>
            <button type="button" className="btn btn-small" onClick={() => saveProjectFile(project)}>
              Save
            </button>
            <button
              type="button"
              className="btn btn-small btn-quiet"
              onClick={() => {
                if (!confirm("Start a new trip? Save this one first if you want to keep it.")) return;
                setProject(newProject());
                setHistory([]);
                setT(0);
                setStep("route");
              }}
            >
              New
            </button>
          </div>
        </header>

        <input
          className="project-name"
          aria-label="Trip name"
          value={project.name}
          onChange={(e) => setProject((p) => ({ ...p, name: e.target.value }))}
        />

        <nav className="steps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`step${step === s.id ? " on" : ""}`}
              aria-current={step === s.id ? "step" : undefined}
              disabled={rendering}
              onClick={() => {
                setPlaying(false);
                setPreviewing(false);
                setStep(s.id);
              }}
            >
              <span className="step-num">{i + 1}</span>
              {s.label}
            </button>
          ))}
        </nav>

        <div className="panel-body">
          {step === "route" && (
            <RoutePanel
              project={project}
              patch={patch}
              drawing={drawing}
              setDrawing={setDrawing}
              distanceKm={distanceKm}
              canUndo={history.length > 0}
              onUndo={() => {
                const prev = history[history.length - 1];
                if (!prev) return;
                setHistory((h) => h.slice(0, -1));
                setProject((p) => ({ ...p, route: { ...p.route, points: prev, kind: p.route.kind === "gpx" && prev.length > 0 && prev.length < 400 ? "drawn" : p.route.kind } }));
              }}
              onReverse={() => setRoute([...project.route.points].reverse(), project.route.kind)}
              onClear={() => setRoute([], "drawn")}
              onImport={importGpx}
              onFit={() => fitRoute(project.route.points)}
            />
          )}
          {step === "style" && <StylePanel project={project} patch={patch} />}
          {step === "camera" && (
            <CameraPanel
              project={project}
              patch={patch}
              map={map}
              onFrameRoute={() => {
                const b = boundsOf(project.route.points);
                if (!map || !b) return;
                const cam = map.cameraForBounds(b, { padding: Math.min(80, frame.w / 8) });
                if (!cam?.center || cam.zoom === undefined) return;
                const c = cam.center as { lng: number; lat: number };
                setProject((p) => ({
                  ...p,
                  camera: { ...p.camera, fixedView: { center: [c.lng, c.lat], zoom: cam.zoom!, bearing: 0, pitch: 0 } },
                }));
              }}
            />
          )}
          {step === "export" && (
            <ExportPanel
              project={project}
              patch={patch}
              canRender={!!path && !!map}
              render={render}
              onRender={startRender}
              onCancel={() => abortRef.current?.abort()}
              onDownload={() => render.status === "done" && downloadBlob(render.blob, `${slug(project.name)}-${render.height}p.mp4`)}
            />
          )}
        </div>

        {next && (
          <footer className="panel-foot">
            <button
              type="button"
              className="btn btn-next"
              disabled={rendering}
              onClick={() => {
                setPreviewing(false);
                setStep(next.id);
              }}
            >
              Next: {next.label.toLowerCase()}
            </button>
          </footer>
        )}
      </aside>

      <main className="stage">
        <div className="stage-bar">
          <Segmented<Aspect>
            label="Video shape"
            value={project.output.aspect}
            disabled={rendering}
            options={[
              { value: "16:9", label: "16:9" },
              { value: "9:16", label: "9:16" },
              { value: "1:1", label: "1:1" },
              { value: "4:5", label: "4:5" },
            ]}
            onChange={(v) => setProject((p) => ({ ...p, output: { ...p.output, aspect: v } }))}
          />
          {step === "route" && !editing && !rendering && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                setPlaying(false);
                setPreviewing(false);
              }}
            >
              Back to drawing
            </button>
          )}
          <p className="stage-hint">
            {rendering
              ? "Rendering. Keep this tab open and in front."
              : editing
                ? project.route.kind === "drawn" && drawing
                  ? "Click to add points. Drag to pan."
                  : "Drag to move the map."
                : "Press play or Space to watch the video."}
          </p>
        </div>

        <div className="stage-area" ref={stageRef}>
          <div className={`frame${rendering ? " is-rendering" : ""}`} style={{ width: frame.w, height: frame.h }}>
            {frame.w > 0 && (
              <MapStage
                project={project}
                width={frame.w}
                height={frame.h}
                drawing={editing && drawing && project.route.kind === "drawn" && !rendering}
                onReady={onMapReady}
                onAddPoint={(p) => setRoute([...projectRef.current.route.points, p], "drawn")}
                onMovePoint={(i, p, commit) => {
                  if (!dragOrigin.current) dragOrigin.current = projectRef.current.route.points;
                  const pts = projectRef.current.route.points.slice();
                  pts[i] = p;
                  if (commit) {
                    const before = dragOrigin.current;
                    dragOrigin.current = null;
                    setHistory((h) => [...h.slice(-99), before]);
                  }
                  setProject((pr) => ({ ...pr, route: { ...pr.route, points: pts } }));
                }}
                onRemovePoint={(i) => setRoute(projectRef.current.route.points.filter((_, j) => j !== i), "drawn")}
              />
            )}
          </div>
          {dragOver && <div className="drop-veil">Drop a GPX track or a project file</div>}
        </div>

        <div className="timeline">
          <button
            type="button"
            className="play"
            onClick={togglePlay}
            disabled={!path || rendering}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
                <rect x="4" y="3" width="4" height="14" rx="1" fill="currentColor" />
                <rect x="12" y="3" width="4" height="14" rx="1" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
                <path d="M5 3.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 5 3.5Z" fill="currentColor" />
              </svg>
            )}
          </button>
          <span className="time">
            {fmtTime(t)} <span className="time-total">/ {fmtTime(duration)}</span>
          </span>
          <input
            className="scrub"
            type="range"
            aria-label="Playhead"
            min={0}
            max={duration}
            step={1 / project.output.fps}
            value={Math.min(t, duration)}
            disabled={!path || rendering}
            onChange={(e) => {
              setPlaying(false);
              setPreviewing(true);
              setT(parseFloat(e.target.value));
            }}
            style={{ ["--p" as string]: `${(100 * Math.min(t, duration)) / Math.max(0.01, duration)}%` }}
          />
        </div>
      </main>

      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
