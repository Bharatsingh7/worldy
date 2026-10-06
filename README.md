# 🌍 Worldy — High-Performance 3D Virtual Globe

<div align="center">

[![CesiumJS](https://img.shields.io/badge/CesiumJS-1.146.0-4B9CD3?style=for-the-badge&logo=cesium&logoColor=white)](https://cesium.com/)
[![React](https://img.shields.io/badge/React-19.2-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8.3-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![WebGL](https://img.shields.io/badge/WebGL-Hardware%20Accelerated-990000?style=for-the-badge&logo=webgl&logoColor=white)](https://www.khronos.org/webgl/)
[![Performance](https://img.shields.io/badge/60%20FPS-Smooth%20Inertia-2ED573?style=for-the-badge)](https://github.com/Bharatsingh7/worldy)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

**Explore planet Earth in photorealistic 3D detail. High-resolution satellite imagery, real-time weather clouds, multi-layer overlays, and worldwide geocoding search — powered by open tile services with zero API keys required.**

[✨ Features](#-key-features) • [🚀 Quick Start](#-quick-start) • [🗺️ Data Layers](#-layer-ecosystem) • [🔍 Global Search](#-global-search) • [🎮 Controls](#-controls--navigation) • [🏗️ Architecture](#️-architecture)

</div>

---

## ✨ Key Features

* 🛰️ **Photorealistic Satellite Imagery**: High-res World Imagery (up to 1m resolution via Esri ArcGIS), cloud-free Esri Clarity, NASA Blue Marble global composites, and near-realtime daily satellite passes (NASA VIIRS & MODIS Terra).
* 🗺️ **Diverse Cartographic Styles**: Switch seamlessly between OpenStreetMap, Esri World Topographic, National Geographic World Map, Stadia Stamen Relief, CARTO Dark Matter & Voyager, Ocean Bathymetry, and NASA Black Marble Earth at Night.
* 🔍 **Instant Worldwide Geocoding**: Search for any city, landmark, mountain, country, or coordinate worldwide via integrated OpenStreetMap Nominatim with smart fly-to altitude calculation and keyboard navigation.
* 📑 **Independent Stackable Overlays**: High-zoom vector place labels (CARTO dark labels), administrative international & state boundaries (Esri), road networks (Stamen Toner), public transit networks (MeMoMaps), and live global cloud coverage (OpenWeatherMap).
* 🏔️ **3D Terrain & Elevation**: Global quantized mesh terrain (Cesium World Terrain) with customizable vertical height exaggeration (1× to 10×) and depth testing against terrain geometry.
* ⚡ **Ultra-Smooth 60 FPS Engine**: Built on CesiumJS WebGL rendering with logarithmic depth buffers (no z-fighting), horizon culling, tile preloading (siblings & ancestors), and fine-tuned camera inertia.
* 💎 **Cyber-Glass HUD**: Translucent dark glassmorphism interface with real-time camera telemetry (Latitude, Longitude, Altitude), live FPS monitor, and responsive touch/mouse navigation.
* 🆓 **100% Free & Open Services**: Preconfigured with free public tile endpoints — zero credit cards or paid API keys required.

---

## 🚀 Quick Start

### Prerequisites
* [Node.js](https://nodejs.org/) (v18.0.0 or higher recommended)
* `npm` or `pnpm` / `yarn`

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
| **Stadia Terrain** | Stamen Design | Artistic terrain contours and shaded relief |
| **Dark Matter** | CARTO | Ultra-minimal dark theme tailored for data visualization |
| **Voyager** | CARTO | Clean, modern light theme with subtle street details |
| **Ocean Basemap** | Esri Ocean | Detailed marine bathymetry, continental shelves, and depths |
| **Earth at Night** | NASA Black Marble | Nighttime artificial lighting and city radiance |

### 📑 Transparent Overlays (Stackable)
* 🏷️ **Labels & Places** (*CARTO*): City names, country labels, and points of interest up to zoom level 20.
* 🗂️ **Borders & Boundaries** (*Esri*): International borders, state lines, and administrative divisions.
* 🛤️ **Roads & Transit** (*Stadia / Stamen Toner*): High-contrast road arteries and transit networks.
* ☁️ **Cloud Cover** (*OpenWeatherMap*): Real-time satellite cloud cover composite.
* 🚇 **Public Transport** (*MeMoMaps / OpenStreetMap*): Rail, metro, tram, and bus transit lines.

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
| **Home View** | Click Home icon in Nav Controls | — |
| **Reset North** | Click Compass icon in Nav Controls | — |

---

## 🏗️ Architecture

```
worldy/
├── index.html                   # HTML entry point with Inter & JetBrains Mono fonts
├── vite.config.js               # Vite bundler configuration with vite-plugin-cesium
├── package.json                 # Dependencies & scripts
└── src/
    ├── main.jsx                 # React root mount
    ├── App.jsx                  # Main application layout & global state coordination
    ├── layers.js                # Imagery providers, overlays, and terrain factories
    ├── index.css                # Glassmorphic cyber design system & responsive layout
    └── components/
        ├── Globe.jsx            # Core CesiumJS viewer, scene tuning, and tile caching
        ├── LayerPanel.jsx       # Glassmorphism side panel for toggling basemaps & overlays
        ├── SearchBar.jsx        # Nominatim geocoder with keyboard navigation & fly-to
        ├── NavControls.jsx      # Navigation buttons (zoom, home, compass north-up)
        └── StatusBar.jsx        # Live telemetry (Latitude, Longitude, Altitude, FPS)
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
* [Stadia Maps](https://stadiamaps.com/) & [Stamen Design](https://stamen.com/)
* [USGS National Map](https://www.usgs.gov/programs/national-geospatial-program/national-map)
* [OpenWeatherMap](https://openweathermap.org/)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — see the LICENSE file for details.
