import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Cartesian3,
  Math as CesiumMath,
  HeadingPitchRange,
} from 'cesium';

/**
 * SearchBar — geocode cities/places using Nominatim (free, no API key)
 * and fly the camera to the result.
 */
export default function SearchBar({ viewer }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Debounced search via Nominatim
  const search = useCallback((q) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!q || q.trim().length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);

    debounceRef.current = setTimeout(async () => {
      try {
        const encoded = encodeURIComponent(q.trim());
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=8&addressdetails=1&accept-language=en`,
          {
            headers: {
              'User-Agent': 'Worldy/1.0',
            },
          }
        );
        const data = await res.json();

        const mapped = data.map((item) => ({
          id: item.place_id,
          name: item.display_name,
          shortName: getShortName(item),
          type: item.type,
          category: item.category || item.class,
          lat: parseFloat(item.lat),
          lon: parseFloat(item.lon),
          boundingBox: item.boundingbox
            ? item.boundingbox.map(Number)
            : null,
          icon: getPlaceIcon(item.type, item.category || item.class),
        }));

        setResults(mapped);
        setIsOpen(mapped.length > 0);
        setSelectedIndex(-1);
      } catch (err) {
        console.warn('Geocoding error:', err);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 350);
  }, []);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    search(val);
  };

  const flyToResult = useCallback(
    (result) => {
      if (!viewer || viewer.isDestroyed()) return;

      setQuery(result.shortName);
      setIsOpen(false);

      // Calculate altitude based on bounding box size
      let altitude = 50000; // default ~50km
      if (result.boundingBox) {
        const [south, north, west, east] = result.boundingBox;
        const latSpan = Math.abs(north - south);
        const lonSpan = Math.abs(east - west);
        const maxSpan = Math.max(latSpan, lonSpan);

        if (maxSpan > 10) altitude = 3000000;
        else if (maxSpan > 5) altitude = 1500000;
        else if (maxSpan > 1) altitude = 500000;
        else if (maxSpan > 0.1) altitude = 80000;
        else if (maxSpan > 0.01) altitude = 15000;
        else altitude = 5000;
      }

      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(result.lon, result.lat, altitude),
        orientation: {
          heading: CesiumMath.toRadians(0),
          pitch: CesiumMath.toRadians(-45),
          roll: 0,
        },
        duration: 2.0,
      });
    },
    [viewer]
  );

  const handleKeyDown = (e) => {
    if (!isOpen || results.length === 0) {
      if (e.key === 'Escape') {
        setIsOpen(false);
        inputRef.current?.blur();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < results.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : results.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < results.length) {
          flyToResult(results[selectedIndex]);
        } else if (results.length > 0) {
          flyToResult(results[0]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        inputRef.current?.blur();
        break;
    }
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="search-container" ref={containerRef} id="search-bar">
      <div className={`search-input-wrapper glass-panel ${isOpen ? 'open' : ''}`}>
        {/* Search Icon */}
        <svg
          className="search-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>

        <input
          ref={inputRef}
          id="search-input"
          type="text"
          className="search-input"
          placeholder="Search cities, places, landmarks…"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          autoComplete="off"
          spellCheck="false"
        />

        {/* Loading spinner or clear button */}
        {isLoading ? (
          <div className="search-spinner" />
        ) : query.length > 0 ? (
          <button
            className="search-clear-btn"
            onClick={handleClear}
            title="Clear search"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        ) : null}
      </div>

      {/* Results Dropdown */}
      {isOpen && results.length > 0 && (
        <div className="search-results glass-panel" id="search-results">
          {results.map((result, index) => (
            <div
              key={result.id}
              className={`search-result-item ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => flyToResult(result)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="search-result-icon">{result.icon}</span>
              <div className="search-result-info">
                <div className="search-result-name">{result.shortName}</div>
                <div className="search-result-detail">{result.name}</div>
              </div>
              <div className="search-result-coords">
                {result.lat.toFixed(2)}°, {result.lon.toFixed(2)}°
              </div>
            </div>
          ))}
          <div className="search-attribution">
            Powered by OpenStreetMap Nominatim
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────

function getShortName(item) {
  const addr = item.address || {};
  const parts = [];
  if (addr.city || addr.town || addr.village || addr.hamlet) {
    parts.push(addr.city || addr.town || addr.village || addr.hamlet);
  } else if (addr.county) {
    parts.push(addr.county);
  } else if (item.name) {
    parts.push(item.name);
  }
  if (addr.state) parts.push(addr.state);
  if (addr.country) parts.push(addr.country);

  if (parts.length === 0) {
    // Fallback: take first 2 parts of display name
    return item.display_name.split(',').slice(0, 2).join(',').trim();
  }
  return parts.join(', ');
}

function getPlaceIcon(type, category) {
  if (category === 'boundary' || type === 'administrative') return '🏛️';
  if (type === 'city' || type === 'town') return '🏙️';
  if (type === 'village' || type === 'hamlet') return '🏘️';
  if (type === 'country') return '🌍';
  if (type === 'state' || type === 'province') return '🗾';
  if (category === 'natural') return '🏔️';
  if (category === 'waterway' || type === 'river') return '🌊';
  if (category === 'aeroway' || type === 'aerodrome') return '✈️';
  if (type === 'peak' || type === 'volcano') return '⛰️';
  if (category === 'tourism') return '🏛️';
  if (type === 'island') return '🏝️';
  return '📍';
}
