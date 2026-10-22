/**
 * Layer definitions for the globe.
 * Each layer defines an imagery provider factory that Cesium can consume.
 * Using free, open tile services — no API keys required.
 */

import {
  OpenStreetMapImageryProvider,
  UrlTemplateImageryProvider,
  WebMapServiceImageryProvider,
  WebMapTileServiceImageryProvider,
  ArcGisMapServerImageryProvider,
  EllipsoidTerrainProvider,
  Credit,
  GeographicTilingScheme,
} from 'cesium';

import CleanTerrainProvider from './terrain/CleanTerrainProvider';

export const ESRI_ELEVATION = 'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer';

// ── Imagery Layer Definitions ────────────────────────────────────

export const IMAGERY_LAYERS = [
  // ─── Satellite Imagery (High Quality, Free) ───────────────────
  {
    id: 'esri-satellite',
    name: 'Esri Satellite',
    description: 'World Imagery — up to 1m resolution',
    icon: '🛰️',
    category: 'satellite',
    quality: 'high',
    createProvider: () =>
      ArcGisMapServerImageryProvider.fromUrl(
        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
      ),
  },
  {
    id: 'esri-clarity',
    name: 'Esri Clarity',
    description: 'Esri World Imagery Clarity — enhanced',
    icon: '🔭',
    category: 'satellite',
    quality: 'high',
    createProvider: () =>
      ArcGisMapServerImageryProvider.fromUrl(
        'https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer'
      ),
  },
  {
    id: 'nasa-bluemarble',
    name: 'NASA Blue Marble',
    description: 'VIIRS true-color composite',
    icon: '🌏',
    category: 'satellite',
    quality: 'medium',
    createProvider: () =>
      new WebMapTileServiceImageryProvider({
        url: 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_ShadedRelief_Bathymetry/default/EPSG4326_500m/{TileMatrix}/{TileRow}/{TileCol}.jpeg',
        layer: 'BlueMarble_ShadedRelief_Bathymetry',
        style: 'default',
        tileMatrixSetID: 'EPSG4326_500m',
        format: 'image/jpeg',
        tilingScheme: new GeographicTilingScheme(),
        maximumLevel: 8,
        credit: new Credit('NASA Global Imagery Browse Services'),
      }),
  },
  {
    id: 'nasa-viirs',
    name: 'NASA VIIRS Earth',
    description: 'VIIRS SNPP corrected reflectance',
    icon: '🛸',
    category: 'satellite',
    quality: 'high',
    createProvider: () => {
      // Use yesterday's date for near-realtime imagery
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const dateStr = d.toISOString().split('T')[0];
      return new WebMapTileServiceImageryProvider({
        url: `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${dateStr}/EPSG4326_250m/{TileMatrix}/{TileRow}/{TileCol}.jpeg`,
        layer: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
        style: 'default',
        tileMatrixSetID: 'EPSG4326_250m',
        format: 'image/jpeg',
        tilingScheme: new GeographicTilingScheme(),
        maximumLevel: 9,
        credit: new Credit('NASA EOSDIS GIBS — VIIRS/SNPP'),
      });
    },
  },
  {
    id: 'nasa-modis-terra',
    name: 'NASA MODIS Terra',
    description: 'MODIS Terra true-color (daily)',
    icon: '🌐',
    category: 'satellite',
    quality: 'medium',
    createProvider: () => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const dateStr = d.toISOString().split('T')[0];
      return new WebMapTileServiceImageryProvider({
        url: `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${dateStr}/EPSG4326_250m/{TileMatrix}/{TileRow}/{TileCol}.jpeg`,
        layer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
        style: 'default',
        tileMatrixSetID: 'EPSG4326_250m',
        format: 'image/jpeg',
        tilingScheme: new GeographicTilingScheme(),
        maximumLevel: 9,
        credit: new Credit('NASA EOSDIS GIBS — MODIS/Terra'),
      });
    },
  },
  {
    id: 'usgs-imagery',
    name: 'USGS Satellite',
    description: 'USGS National Map imagery',
    icon: '📡',
    category: 'satellite',
    quality: 'high',
    createProvider: () =>
      new WebMapServiceImageryProvider({
        url: 'https://basemap.nationalmap.gov/arcgis/services/USGSImageryOnly/MapServer/WMSServer',
        layers: '0',
        parameters: {
          format: 'image/jpeg',
          transparent: false,
        },
        credit: new Credit('USGS National Map'),
      }),
  },

  // ─── Map Tiles ─────────────────────────────────────────────────
  {
    id: 'osm-standard',
    name: 'OpenStreetMap',
    description: 'Standard OSM tiles',
    icon: '🗺️',
    category: 'map',
    createProvider: () =>
      new OpenStreetMapImageryProvider({
        url: 'https://tile.openstreetmap.org/',
      }),
  },
  {
    id: 'esri-topo',
    name: 'Topographic',
    description: 'Esri World Topo Map',
    icon: '⛰️',
    category: 'map',
    createProvider: () =>
      ArcGisMapServerImageryProvider.fromUrl(
        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer'
      ),
  },
  {
    id: 'esri-natgeo',
    name: 'National Geographic',
    description: 'Esri NatGeo World Map',
    icon: '🌍',
    category: 'map',
    createProvider: () =>
      ArcGisMapServerImageryProvider.fromUrl(
        'https://services.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer'
      ),
  },
  {
    id: 'carto-dark',
    name: 'Dark Matter',
    description: 'CARTO dark basemap',
    icon: '🌑',
    category: 'map',
    createProvider: () =>
      new UrlTemplateImageryProvider({
        url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        credit: 'CARTO',
      }),
  },
  {
    id: 'carto-voyager',
    name: 'Voyager',
    description: 'CARTO Voyager light',
    icon: '🧭',
    category: 'map',
    createProvider: () =>
      new UrlTemplateImageryProvider({
        url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
        credit: 'CARTO',
      }),
  },
  {
    id: 'esri-ocean',
    name: 'Ocean',
    description: 'Esri Ocean Basemap',
    icon: '🌊',
    category: 'map',
    createProvider: () =>
      ArcGisMapServerImageryProvider.fromUrl(
        'https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer'
      ),
  },
  {
    id: 'esri-street',
    name: 'World Street',
    description: 'Esri World Street Map',
    icon: '🛣️',
    category: 'map',
    createProvider: () =>
      ArcGisMapServerImageryProvider.fromUrl(
        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer'
      ),
  },

  // ─── Night / Special ───────────────────────────────────────────
  {
    id: 'nasa-nightearth',
    name: 'Earth at Night',
    description: 'NASA VIIRS night lights',
    icon: '🌃',
    category: 'special',
    quality: 'high',
    createProvider: () =>
      new WebMapTileServiceImageryProvider({
        url: 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_Black_Marble/default/2016-01-01/EPSG4326_500m/{TileMatrix}/{TileRow}/{TileCol}.png',
        layer: 'VIIRS_Black_Marble',
        style: 'default',
        tileMatrixSetID: 'EPSG4326_500m',
        format: 'image/png',
        tilingScheme: new GeographicTilingScheme(),
        maximumLevel: 8,
        credit: new Credit('NASA Black Marble — VIIRS/Suomi NPP'),
      }),
  },
];

// ── Overlay Layer Definitions ────────────────────────────────────
// NOTE: All overlays use URL template providers with transparent PNGs
// to ensure they render at all zoom levels (up to z18-z20).

export const OVERLAY_LAYERS = [
  {
    id: 'carto-labels',
    name: 'Labels & Places',
    description: 'City names, place labels (all zoom levels)',
    icon: '🏷️',
    defaultEnabled: false,
    createProvider: () =>
      new UrlTemplateImageryProvider({
        url: 'https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png',
        credit: 'CARTO',
        maximumLevel: 20,
        hasAlphaChannel: true,
      }),
  },
  {
    id: 'esri-boundaries',
    name: 'Borders & Boundaries',
    description: 'Administrative boundaries overlay',
    icon: '🗂️',
    defaultEnabled: false,
    createProvider: () =>
      ArcGisMapServerImageryProvider.fromUrl(
        'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer'
      ),
  },
  {
    id: 'opnv-transport',
    name: 'Public Transport',
    description: 'Bus/tram/rail network overlay',
    icon: '🚇',
    defaultEnabled: false,
    createProvider: () =>
      new UrlTemplateImageryProvider({
        url: 'https://tile.memomaps.de/tilegen/{z}/{x}/{y}.png',
        credit: 'MeMoMaps / OpenStreetMap',
        maximumLevel: 18,
        hasAlphaChannel: true,
      }),
  },
];

// ── Terrain Definitions ──────────────────────────────────────────

export const TERRAIN_OPTIONS = [
  {
    id: 'ellipsoid',
    name: 'Flat (WGS84)',
    description: 'No terrain elevation',
    icon: '⚪',
    createProvider: () => new EllipsoidTerrainProvider(),
  },
  {
    id: 'esri-world',
    name: 'World Terrain',
    description: 'Esri World Elevation 3D, geoid-corrected',
    icon: '🏔️',
    createProvider: ({ bareEarth = true } = {}) => CleanTerrainProvider.fromUrl(ESRI_ELEVATION, { bareEarth }),
  },
];

// ── Layer Categories ─────────────────────────────────────────────

export const CATEGORIES = {
  satellite: { label: 'Satellite Imagery', icon: '🛰️' },
  map: { label: 'Map Tiles', icon: '🗺️' },
  special: { label: 'Night', icon: '✨' },
};

export function getLayersByCategory() {
  const result = {};
  for (const layer of IMAGERY_LAYERS) {
    const cat = layer.category || 'other';
    if (!result[cat]) result[cat] = [];
    result[cat].push(layer);
  }
  return result;
}
