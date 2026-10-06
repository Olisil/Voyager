import type { Map as MLMap, MapLayerMouseEvent, MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { createMap, installScene, LYR } from "../lib/mapScene";
import type { LngLat, Project } from "../lib/project";

interface Props {
  project: Project;
  width: number;
  height: number;
  /** Drawing is on: clicks add points, handles can be dragged and right-clicked away. */
  drawing: boolean;
  onReady: (map: MLMap) => void;
  onAddPoint: (p: LngLat) => void;
  onMovePoint: (i: number, p: LngLat, commit: boolean) => void;
  onRemovePoint: (i: number) => void;
}

export function MapStage(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const map = createMap(el.current!, latest.current.project);
    mapRef.current = map;

    let dragging: number | null = null;

    const onClick = (e: MapMouseEvent) => {
      if (!latest.current.drawing) return;
      const hit = map.queryRenderedFeatures(e.point, { layers: [LYR.ctrl, LYR.ctrlEnds].filter((l) => map.getLayer(l)) });
      if (hit.length) return;
      latest.current.onAddPoint([e.lngLat.lng, e.lngLat.lat]);
    };
    const onDown = (e: MapLayerMouseEvent) => {
      if (!latest.current.drawing || e.originalEvent.button !== 0) return;
      const i = e.features?.[0]?.properties?.i;
      if (typeof i !== "number") return;
      e.preventDefault();
      dragging = i;
      map.getCanvas().style.cursor = "grabbing";
    };
    const onMove = (e: MapMouseEvent) => {
      if (dragging === null) return;
      latest.current.onMovePoint(dragging, [e.lngLat.lng, e.lngLat.lat], false);
    };
    const onUp = (e: MapMouseEvent) => {
      if (dragging === null) return;
      latest.current.onMovePoint(dragging, [e.lngLat.lng, e.lngLat.lat], true);
      dragging = null;
      map.getCanvas().style.cursor = latest.current.drawing ? "crosshair" : "";
    };
    const onContext = (e: MapLayerMouseEvent) => {
      if (!latest.current.drawing) return;
      const i = e.features?.[0]?.properties?.i;
      if (typeof i === "number") {
        e.preventDefault();
        latest.current.onRemovePoint(i);
      }
    };
    const onEnter = () => {
      if (latest.current.drawing && dragging === null) map.getCanvas().style.cursor = "grab";
    };
    const onLeave = () => {
      if (dragging === null) map.getCanvas().style.cursor = latest.current.drawing ? "crosshair" : "";
    };

    map.once("style.load", () => {
      installScene(map, latest.current.project);
      // Layer-scoped handlers are registered once the layers exist; they survive theme changes
      // because the scene is reinstalled with the same layer ids.
      map.on("click", onClick);
      for (const layer of [LYR.ctrl, LYR.ctrlEnds]) {
        map.on("mousedown", layer, onDown);
        map.on("contextmenu", layer, onContext);
        map.on("mouseenter", layer, onEnter);
        map.on("mouseleave", layer, onLeave);
      }
      map.on("mousemove", onMove);
      map.on("mouseup", onUp);
      latest.current.onReady(map);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = props.drawing ? "crosshair" : "";
    if (props.drawing) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }, [props.drawing]);

  useEffect(() => {
    mapRef.current?.resize();
  }, [props.width, props.height]);

  return <div ref={el} className="map" style={{ width: props.width, height: props.height }} />;
}
