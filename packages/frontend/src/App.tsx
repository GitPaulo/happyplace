import { useState, useRef, useCallback } from "react";
import type { CellScore, ScoresResponse } from "@happyplace/shared";
import { Map, type MapHandle } from "./components/Map";
import { ScorePanel } from "./components/ScorePanel";
import { Navbar } from "./components/Navbar";

export default function App() {
  const [selectedCell, setSelectedCell] = useState<CellScore | null>(null);
  const [loading, setLoading] = useState(false);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [sources, setSources] = useState<ScoresResponse["sources"]>([]);
  const [hasCar, setHasCar] = useState(false);
  const mapRef = useRef<MapHandle>(null);

  const handleNavigate = useCallback((lat: number, lng: number) => {
    mapRef.current?.flyTo(lat, lng);
  }, []);

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
          onLoadingChange={setLoading}
          onSourcesChange={setSources}
          weights={weights}
          hasCar={hasCar}
          panelOpen={panelOpen}
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
