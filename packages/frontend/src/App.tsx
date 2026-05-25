import { useState, useRef, useCallback } from "react";
import type { CellScore, ScoresResponse } from "@happyplace/shared";
import { Map, type MapHandle } from "./components/Map";
import { ScorePanel } from "./components/ScorePanel";
import { Navbar } from "./components/Navbar";
import { SearchBar } from "./components/SearchBar";

export default function App() {
  const [initialCenter, setInitialCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedCell, setSelectedCell] = useState<CellScore | null>(null);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [sources, setSources] = useState<ScoresResponse["sources"]>([]);
  const [hasCar, setHasCar] = useState(false);
  const mapRef = useRef<MapHandle>(null);

  const handleNavigate = useCallback((lat: number, lng: number) => {
    if (!initialCenter) {
      setInitialCenter({ lat, lng });
    } else {
      mapRef.current?.flyTo(lat, lng);
    }
  }, [initialCenter]);

  if (!initialCenter) {
    return (
      <div className="landing">
        <div className="landing-content">
          <div className="landing-logo">happyplace</div>
          <div className="landing-subtitle">find your ideal neighborhood</div>
          <div className="landing-search">
            <SearchBar onNavigate={handleNavigate} placeholder="search for a city..." autoFocus />
          </div>
          <div className="landing-config">
            <div className="config-toggle-row">
              <button
                className={`config-toggle ${!hasCar ? "active" : ""}`}
                onClick={() => setHasCar(false)}
              >
                Walking
              </button>
              <button
                className={`config-toggle ${hasCar ? "active" : ""}`}
                onClick={() => setHasCar(true)}
              >
                Car
              </button>
            </div>
            <div className="landing-config-hint">
              scoring based on 10 min {hasCar ? "drive" : "walk"} radius
            </div>
          </div>
        </div>
      </div>
    );
  }

  const panelOpen = selectedCell !== null;

  return (
    <div className="app">
      <Navbar
        sources={sources}
        weights={weights}
        onWeightsChange={setWeights}
        hasCar={hasCar}
        onHasCarChange={setHasCar}
        onNavigate={handleNavigate}
        onConfigOpen={() => setSelectedCell(null)}
      />
      <div className="map-container">
        <Map
          ref={mapRef}
          onCellClick={setSelectedCell}
          onSourcesChange={setSources}
          weights={weights}
          hasCar={hasCar}
          panelOpen={panelOpen}
          initialCenter={initialCenter}
        />
      </div>
      {selectedCell && (
        <ScorePanel
          cell={selectedCell}
          onClose={() => setSelectedCell(null)}
        />
      )}
    </div>
  );
}
