# 🌍 Worldy — High-Performance 3D Virtual Globe

<div align="center">

[![CesiumJS](https://img.shields.io/badge/CesiumJS-1.146.0-4B9CD3?style=for-the-badge&logo=cesium&logoColor=white)](https://cesium.com/)
[![React](https://img.shields.io/badge/React-19.2-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8.3-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![WebGL](https://img.shields.io/badge/WebGL-Hardware%20Accelerated-990000?style=for-the-badge&logo=webgl&logoColor=white)](https://www.khronos.org/webgl/)
[![Performance](https://img.shields.io/badge/60%20FPS-Smooth%20Inertia-2ED573?style=for-the-badge)](https://github.com/Bharatsingh7/worldy)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

**Explore planet Earth in photorealistic 3D detail. High-resolution satellite imagery, live worldwide flight tracking with route forecasts, multi-layer overlays, and worldwide geocoding search — powered by open tile services with zero API keys required.**

[✨ Features](#-key-features) • [🚀 Quick Start](#-quick-start) • [🗺️ Data Layers](#-layer-ecosystem) • [🔍 Global Search](#-global-search) • [🎮 Controls](#-controls--navigation) • [🏗️ Architecture](#️-architecture)

</div>

---

## ✨ Key Features

* 🛰️ **Photorealistic Satellite Imagery**: High-res World Imagery (up to 1m resolution via Esri ArcGIS), cloud-free Esri Clarity, NASA Blue Marble global composites, and near-realtime daily satellite passes (NASA VIIRS & MODIS Terra).
* 🗺️ **Diverse Cartographic Styles**: Switch seamlessly between OpenStreetMap, Esri World Topographic, National Geographic World Map, CARTO Dark Matter & Voyager, Ocean Bathymetry, and NASA Black Marble Earth at Night.
* 🔍 **Instant Worldwide Geocoding**: Search for any city, landmark, mountain, country, or coordinate worldwide via integrated OpenStreetMap Nominatim with smart fly-to altitude calculation and keyboard navigation.
* 📑 **Independent Stackable Overlays**: High-zoom vector place labels (CARTO dark labels), administrative international & state boundaries (Esri), and public transit networks (MeMoMaps), each with its own opacity slider.
* 🏔️ **3D Terrain & Elevation**: Keyless global terrain (Esri World Elevation 3D) with customizable vertical height exaggeration (1× to 10×) and depth testing against terrain geometry.
* ✈️ **Live Flight Tracking**: ~10–15k aircraft worldwide (OpenSky + adsb.lol), military-flagged aircraft, origin → destination routes, past track, ETA, follow camera, and a forecast simulator that projects every plane up to 2 hours ahead.
* 🧭 **Layer system**: switch on ships (AIS, incl. military), satellites (incl. publicly catalogued military), nuclear power plants, military bases, mapped bunkers, earthquakes, wildfires/storms/volcanoes, rain radar and day/night. Layers that are off cost nothing.
* 📐 **Draw, measure & analyse**: mark points, lines, areas, boxes and circles with the mouse. Get area/length with real-world comparisons, terrain elevation of just that area, nearby features, a base map applied only there, what's visible from a point, and which satellites are overhead.
* 🌊 **What-if simulations**: landslide runout, flood / sea-level rise and tsunami (earthquake → ocean travel time → coastal flooding), computed with simplified physical models in C.
* ⚙️ **Light on the GPU**: renders on demand, not 60 fps nonstop. Eco / Balanced / Quality modes; heavy maths runs in C compiled to WebAssembly in a Web Worker.
* 💎 **Cyber-Glass HUD**: Translucent dark glassmorphism interface with real-time camera telemetry (Latitude, Longitude, Altitude), live FPS monitor, and responsive touch/mouse navigation.
* 🆓 **Free & open services**: no paid keys. One optional free key (aisstream.io) unlocks worldwide ships.

---

## 🚀 Quick Start

### Prerequisites
* [Node.js](https://nodejs.org/) 22+ (the ship relay uses Node's built-in WebSocket)
* `clang` with the wasm32 target, to rebuild the C core (optional: a prebuilt `public/wasm/worldy.wasm` is committed)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/Bharatsingh7/worldy.git
cd worldy

# 2. Install dependencies
npm install

# 3. Start the local development server
npm run dev
```

Navigate to **`http://localhost:3000`** in your browser.

**Optional: worldwide ships.** Get a free key at [aisstream.io](https://aisstream.io) (sign in with GitHub), then `cp .env.example .env` and paste it as `AISSTREAM_KEY`. Restart `npm run dev`. The key stays on the local dev/preview server; without it, ships are shown for the Baltic Sea only.

### Production Build

```bash
# Build optimized production bundle
npm run build

# Preview production build locally
npm run preview
```

---

## 🗺️ Layer Ecosystem

Worldy connects directly to free tile servers and geospatial data providers:

### 🛰️ Satellite Imagery (Base Layers)
| Layer | Provider | Max Resolution | Highlights |
| :--- | :--- | :--- | :--- |
| **Esri Satellite** | ArcGIS World Imagery | **~1m / pixel** | Commercial-grade global satellite & aerial photography |
| **Esri Clarity** | ArcGIS Imagery Clarity | ~1m / pixel | Filtered for minimal cloud cover and maximum contrast |
| **NASA Blue Marble** | NASA EOSDIS GIBS | ~500m / pixel | Iconic true-color composite with ocean bathymetry |
| **NASA VIIRS** | Suomi NPP (Daily) | ~250m / pixel | Daily updated true-color global earth imagery |
| **NASA MODIS** | Terra Satellite (Daily) | ~250m / pixel | Daily morning satellite pass composite |
| **USGS Satellite** | USGS National Map | High-Res | High-resolution orthoimagery across North America |

### 🗺️ Map Tiles (Base Layers)
| Layer | Style | Description |
| :--- | :--- | :--- |
| **OpenStreetMap** | Standard | Community-driven street and land-use mapping |
| **Topographic** | Esri Topo | Elevation contour hillshades, water bodies, and parks |
| **National Geographic** | Esri NatGeo | Classic NatGeo cartographic typography and boundaries |
| **Dark Matter** | CARTO | Ultra-minimal dark theme tailored for data visualization |
| **Voyager** | CARTO | Clean, modern light theme with subtle street details |
| **Ocean Basemap** | Esri Ocean | Detailed marine bathymetry, continental shelves, and depths |
| **Earth at Night** | NASA Black Marble | Nighttime artificial lighting and city radiance |

### 📑 Transparent Overlays (Stackable)
* 🏷️ **Labels & Places** (*CARTO*): City names, country labels, and points of interest up to zoom level 20.
* 🗂️ **Borders & Boundaries** (*Esri*): International borders, state lines, and administrative divisions.
* 🚇 **Public Transport** (*MeMoMaps / OpenStreetMap*): Rail, metro, tram, and bus transit lines.

---

## ✈️ Live Flights

Open the **Flights** tab in the side panel.

| Feed | Source | Used when |
| :--- | :--- | :--- |
| Global positions | [OpenSky Network](https://opensky-network.org/) `/states/all` | Zoomed out (every 90 s) |
| Regional detail | [adsb.lol](https://adsb.lol/) `/v2/point` | Zoomed in below ~3,000 km (every 8 s) |
| Military | adsb.lol `/v2/mil` | Always (every 15 s) |
| Route, airline, aircraft | [adsbdb](https://www.adsbdb.com/) | When you select a plane |
| Past track | OpenSky `/tracks/all` | When you select a plane |

* **Click a plane** for its route (origin → destination), progress, ETA, altitude, speed and squawk. **Follow** locks the camera to it.
* **Filters**: All / Military / Airborne, plus a min/max altitude band. Search by callsign, registration or ICAO hex.
* **Forecast simulation**: drag *Ahead* (0–120 min). Planes with a known route fly the great circle to their destination and descend on a ~3° slope; the rest hold course. Marked **SIMULATED** while active.
* Between polls, positions are dead-reckoned every frame so motion stays smooth.

**Limits.** Only aircraft broadcasting ADS-B/MLAT appear. Stealth aircraft and military flights with their transponders off are not in any public feed. Anonymous OpenSky access has a daily credit limit (~100 global refreshes); the remaining credits are shown in the Flights tab. Routes come from published schedules and are flagged when they don't match the aircraft's position.

**Hosting note.** OpenSky and adsb.lol don't send CORS headers, so the browser reaches them through the Vite proxy (`/api/opensky`, `/api/adsb` in `vite.config.js`). This works with `npm run dev` and `npm run preview`. A static host (e.g. GitHub Pages) would need an equivalent small proxy.

---

## 🧭 Data Layers (Layers tab)

| Layer | Source | Notes |
| :--- | :--- | :--- |
| Ships (AIS) | [Digitraffic](https://www.digitraffic.fi/en/marine-traffic/) (Baltic, keyless) · [aisstream.io](https://aisstream.io) (worldwide, free key) | Filter: military & law enforcement (AIS types 35/55), cargo/tankers, passenger |
| Satellites | [CelesTrak](https://celestrak.org) groups | Stations, military, Earth imaging, GNSS, weather, GEO, Starlink. Cached 2 h. Click for ground track, coverage circle, "now over", passes |
| Nuclear power plants | [GeoNuclearData](https://github.com/cristianst85/GeoNuclearData) (WNA/IAEA) | Operating / building / shut down |
| Military bases & airfields | OpenStreetMap (Overpass) | Loads by area when zoomed in below ~800 km |
| Mapped bunkers | OpenStreetMap `military=bunker` | Publicly mapped only, mostly historic |
| Earthquakes | [USGS](https://earthquake.usgs.gov/earthquakes/feed/) | 24 h / 7 days, M2.5+ / M4.5+ |
| Natural events | [NASA EONET](https://eonet.gsfc.nasa.gov/) | Wildfires, storms, volcanoes, ice |
| Rain radar | [RainViewer](https://www.rainviewer.com/api.html) | Latest frame |
| Day / night | computed | Terminator and sub-solar point |

**What public data can't show:** aircraft and ships with transponders off (including most warships and stealth flights), classified satellites, and hidden or classified facilities. Only what is publicly broadcast or mapped appears.

---

## 📐 Tools & Simulations (Tools tab)

Draw a **point, line, area, box or circle**, then:

* **Size & comparison**: geodesic area, perimeter or length, e.g. "≈ 2.4 × Manhattan".
* **Elevation here**: terrain sampled over the shape, with min/max/mean and slope, plus a hillshaded colour map draped only inside it. Lines get an elevation profile with climb and descent.
* **Nearby features**: settlements, hospitals, schools, airports, power plants, water, military sites and attractions inside the shape (OpenStreetMap).
* **Apply a map to this area only**: any base map, clipped to the shape's bounding box.
* **What can I see from here** (point): viewshed within 5 km, including Earth curvature.
* **Satellites overhead now** (point): satellites from the enabled groups above 10°.

**Simulations** (areas):

| Simulation | Model |
| :--- | :--- |
| Landslide | Volume = area × depth → reach angle from Scheidegger (1973); multiple-flow-direction routing along an energy line; deposits relax to a 12° angle of repose |
| Flood / sea-level rise | Connected "bathtub" fill from the sea, or from the area's lowest point if it has no sea |
| Tsunami | Mw → rupture size (Strasser 2010) and slip → initial wave; travel time at √(g·depth) over NOAA ETOPO bathymetry; Green's-law shoaling; run-up ≈ 2 × near-shore wave; inland reach from Hills & Mader (1997) |

Each result lists affected settlements and spells out its assumptions. These are screening estimates, not certified hazard models.

---

## ⚙️ Performance & the C core

* The globe **renders only when something changes**. Planes, ships and satellites update a few times a second on a shared ticker instead of every frame, and nothing animates in a hidden tab.
* **Settings → Performance** sets the GPU cost: *Eco* (75% resolution, no anti-aliasing, coarse tiles, 30 fps cap), *Balanced* (default) or *Quality* (full DPI, 4× MSAA).
* GPU load comes from rendering, so these settings are what lower it. The CPU-heavy maths is plain C in [`wasm/`](wasm/), compiled to WebAssembly with `clang` (no Emscripten, no libc), and runs in a Web Worker so the page stays responsive:

| File | Does |
| :--- | :--- |
| `geo.c` | Geodesic distance, polygon area/perimeter, polygon masks, batch dead reckoning of aircraft |
| `sgp4.c` | SGP4 orbit propagation (matches satellite.js for low orbits), ground tracks, pass prediction |
| `terrain.c` | Elevation statistics, slope, hillshaded colour maps, viewshed |
| `landslide.c` · `tsunami.c` · `flood.c` | The simulations above |

Rebuild with `npm run build:wasm` (also runs automatically before `dev` and `build`).

---

## 🔍 Global Search

The floating search bar allows effortless travel across the planet:
* **Global Geocoding**: Powered by OpenStreetMap Nominatim with debounced requests (350ms).
* **Keyboard Navigation**: Use <kbd>↑</kbd> and <kbd>↓</kbd> arrows to browse candidates, <kbd>Enter</kbd> to fly, and <kbd>Esc</kbd> to dismiss.
* **Intelligent Fly-To**: Automatically computes bounding box dimensions to determine the ideal camera altitude (zooms closer for buildings/neighborhoods, higher for countries).

---

## 🎮 Controls & Navigation

| Action | Mouse | Touch |
| :--- | :--- | :--- |
| **Rotate / Pan Globe** | Left-click + drag | Single-finger drag |
| **Zoom In / Out** | Scroll wheel / Right-click drag | Two-finger pinch |
| **Tilt Perspective** | Middle-click drag / <kbd>Ctrl</kbd> + Left-click drag | Two-finger vertical drag |
| **Home View** | Home button or <kbd>H</kbd> | — |
| **Reset North** | Compass button or <kbd>N</kbd> | — |
| **Zoom buttons** | <kbd>+</kbd> / <kbd>-</kbd> | — |
| **Focus search** | <kbd>/</kbd> | — |
| **Toggle side panel** | <kbd>L</kbd> | — |
| **Close card / cancel drawing** | <kbd>Esc</kbd> | — |
| **Save screenshot** | Camera button or <kbd>P</kbd> | — |
| **Share this view** | Copy the URL (camera and base map are kept in it) | — |

---

## 🏗️ Architecture

```
worldy/
├── index.html                   # HTML entry point with Inter & JetBrains Mono fonts
├── vite.config.js               # Vite config: Cesium, API proxies, aisstream relay
├── server/aisRelay.js           # Dev/preview middleware: worldwide AIS from aisstream.io
├── wasm/                        # C compute core → public/wasm/worldy.wasm (build.sh)
└── src/
    ├── main.jsx                 # React root mount
    ├── App.jsx                  # Main application layout & global state coordination
    ├── layers.js                # Imagery providers, overlays, and terrain factories
    ├── index.css                # Glassmorphic cyber design system & responsive layout
    ├── perf.js · ticker.js · camera.js · urlState.js   # performance modes, animation ticker, terrain-safe camera, shareable URL
    ├── compute/                 # wasm loader, compute worker, promise client
    ├── datalayers/              # layer registry + ships, satellites, nuclear, OSM sites, quakes, events, radar, day/night
    ├── tools/                   # drawing, grids/terrain sampling, analyses & simulations
    ├── flights/
    │   ├── api.js               # OpenSky / adsb.lol / adsbdb fetchers, normalised flight shape
    │   ├── predict.js           # Great-circle dead reckoning, route forecast, ETA
    │   ├── FlightLayer.js       # Cesium billboards, selected track/route, picking, follow cam
    │   └── useFlights.js        # Polling, merging, filters, selection state
    └── components/
        ├── Globe.jsx            # Core CesiumJS viewer, scene tuning, and tile caching
        ├── LayerPanel.jsx       # Tabbed side panel: Map / Layers / Tools / Settings
        ├── DataLayersPanel.jsx  # Layers tab with per-layer options
        ├── ToolsPanel.jsx       # Draw, analyse, simulate
        ├── InfoCard.jsx · ResultCard.jsx   # Picked item details · tool results
        ├── SettingsPanel.jsx    # Performance modes
        ├── FlightPanel.jsx      # Flight filters, search, forecast slider, feed status
        ├── FlightInfoCard.jsx   # Selected aircraft: route, progress, ETA, live numbers
        ├── SearchBar.jsx        # Nominatim geocoder with keyboard navigation & fly-to
        ├── NavControls.jsx      # Compass (north-up), zoom, home
        └── StatusBar.jsx        # Lat/Lon/Alt/FPS, flight count, data attribution
```

---

## 🛠️ Tech Stack

* **Rendering Engine**: [CesiumJS](https://cesium.com/platform/cesiumjs/) — Industry-standard WebGL 3D globe and map engine
* **Framework**: [React 19](https://react.dev/)
* **Bundler**: [Vite 8](https://vitejs.dev/) with `vite-plugin-cesium`
* **Styling**: Vanilla CSS with custom glassmorphism design system
* **Geocoding API**: [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org/)
* **Linter**: [Oxlint](https://oxc.rs/)

---

## 📜 Attributions & Credits

Worldy utilizes open data and services provided by:
* [Esri ArcGIS Online](https://www.esri.com/)
* [NASA EOSDIS GIBS](https://www.earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs)
* [OpenStreetMap contributors](https://www.openstreetmap.org/)
* [CARTO](https://carto.com/)
* [USGS National Map](https://www.usgs.gov/programs/national-geospatial-program/national-map)
* [OpenSky Network](https://opensky-network.org/), [adsb.lol](https://adsb.lol/) (ODbL), [adsbdb](https://www.adsbdb.com/)
* [MeMoMaps](https://memomaps.de/)
* [Fintraffic Digitraffic](https://www.digitraffic.fi/) (CC BY 4.0), [aisstream.io](https://aisstream.io/)
* [CelesTrak](https://celestrak.org/), [GeoNuclearData](https://github.com/cristianst85/GeoNuclearData) (ODbL), [USGS](https://www.usgs.gov/), [NASA EONET](https://eonet.gsfc.nasa.gov/), [RainViewer](https://www.rainviewer.com/), [NOAA ETOPO](https://www.ncei.noaa.gov/products/etopo-global-relief-model)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — see the LICENSE file for details.
