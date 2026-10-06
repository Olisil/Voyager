# Färdväg (working title)

Animated route maps for travel films. Draw a route or drop in a GPX file, pick a look and a
camera move, and render an MP4 in the browser. No backend, no accounts.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Node 22+. Rendering needs a browser with WebCodecs H.264 encoding: current Chrome or Edge on
desktop is the reference. Safari works on recent versions; Firefox may fall back to VP9.

## Deploy to Webflow Cloud (mounted on nassau.se)

The app is a plain Vite + React build, which Webflow Cloud supports directly. Don't set `base`
in `vite.config.ts`: Webflow Cloud sets it from the environment's mount path at build time, and
the app only loads assets through bundled imports, so any mount path works.

1. Push this folder to a GitHub repository.
2. In Webflow: site settings for nassau.se, then **Webflow Cloud**, then create a project from
   the repository. Pick a mount path such as `/fardvag`.
3. Publish the Webflow site once so the mount path is live.
4. Every push to the chosen branch redeploys.

Or from a terminal: `npx @webflow/webflow-cli cloud deploy` and choose **Existing site**.

## How it works

| Piece | What it does |
| --- | --- |
| `src/lib/geo.ts` | Route geometry in Web Mercator: spline smoothing, GPX parsing, simplification, arc-length sampling |
| `src/lib/camera.ts` | `frameAt(project, path, t)`: pure function giving line progress, tip and camera for any time. Preview and export share it, so scrubbing shows exactly what renders |
| `src/lib/mapScene.ts` | MapLibre themes, layers and per-frame updates |
| `src/lib/exporter.ts` | Steps through every frame on the live map at output resolution, waits for all tiles, copies the canvas and encodes MP4 with WebCodecs via Mediabunny |
| `src/lib/storage.ts` | Autosave to localStorage, project files (`.fardvag.json`) |

## Data sources and licences

- **Vector maps:** OpenFreeMap (no key, commercial use allowed). Data © OpenStreetMap
  contributors (ODbL) and OpenMapTiles. The export burns in a credit by default.
- **3D terrain:** AWS Open Data terrain tiles (Terrarium encoding), originally by Mapzen.
- **Satellite:** EOX Sentinel-2 cloudless 2016 (CC BY 4.0). Later EOX years are
  non-commercial, and EOX's free tile service has fair-use limits. For a commercial product,
  switch to a paid imagery provider such as MapTiler.

## MVP scope

Done: drawing with drag/remove/undo, GPX import, smoothing, six map themes, 3D terrain, line
colour/width, arrow or dot tip, follow and fixed cameras (zoom, travel-up, look-ahead,
steadiness, tilt), timing with easing and holds, four aspect ratios, 720p/1080p/4K at
24–60 fps, autosave and project files.

Next: multiple legs with transport modes, signs and photo stops, start-to-end camera glide,
multiple scenes per video, place search.
