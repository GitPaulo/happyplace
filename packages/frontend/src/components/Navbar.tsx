import { useState, useRef, useEffect } from "react";
import type { ScoresResponse } from "@happyplace/shared";
import { WeightSliders } from "./WeightSliders";
import { SearchBar } from "./SearchBar";

interface NavbarProps {
  sources: ScoresResponse["sources"];
  weights: Record<string, number>;
  onWeightsChange: (weights: Record<string, number>) => void;
  hasCar: boolean;
  onHasCarChange: (hasCar: boolean) => void;
  onNavigate: (lat: number, lng: number) => void;
  onConfigOpen?: () => void;
}

export function Navbar({ sources, weights, onWeightsChange, hasCar, onHasCarChange, onNavigate, onConfigOpen }: NavbarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [settingsOpen]);

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        happyplace
      </div>

      <SearchBar onNavigate={onNavigate} />

      <div ref={dropdownRef} className="navbar-config">
        <button
          className={`navbar-btn ${settingsOpen ? "open" : ""}`}
          onClick={() => {
            const opening = !settingsOpen;
            setSettingsOpen(opening);
            if (opening) onConfigOpen?.();
          }}
        >
          config
        </button>
        {settingsOpen && (
          <div className="settings-dropdown">
            <div className="config-section">
              <div className="config-section-title">Transport mode</div>
              <div className="config-toggle-row">
                <button
                  className={`config-toggle ${!hasCar ? "active" : ""}`}
                  onClick={() => onHasCarChange(false)}
                >
                  Walking
                </button>
                <button
                  className={`config-toggle ${hasCar ? "active" : ""}`}
                  onClick={() => onHasCarChange(true)}
                >
                  Car
                </button>
              </div>
              <div className="config-hint">
                Amenity scores based on 10 min {hasCar ? "drive" : "walk"} radius
              </div>
            </div>
            <div className="panel-divider" />
            <WeightSliders
              sources={sources}
              weights={weights}
              onChange={onWeightsChange}
            />
          </div>
        )}
      </div>
    </nav>
  );
}
