import { useEffect, useState } from "react";
import type { CellScore, SourceScore } from "@happyplace/shared";
import { scoreToColor } from "../utils/colors";
import { amenityPanelIcon } from "../utils/amenityIcons";
import { ScoreBar } from "./ScoreBar";

interface ScorePanelProps {
  cell: CellScore;
  onClose: () => void;
}

export function ScorePanel({ cell, onClose }: ScorePanelProps) {
  const [visible, setVisible] = useState(false);
  const color = scoreToColor(cell.score);
  const hasPartial = cell.breakdown.some((b) => !b.hasData);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    return () => setVisible(false);
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 250);
  };

  const amenities = cell.breakdown.filter((b) => b.category === "amenities");
  const safety = cell.breakdown.filter((b) => b.category === "safety");
  const other = cell.breakdown.filter((b) => b.category === "other");

  const renderGroup = (title: string, items: SourceScore[]) => {
    if (items.length === 0) return null;
    return (
      <div className="panel-breakdown">
        <div className="panel-section-title">{title}</div>
        {items.map((b) => (
          <ScoreBar
            key={b.sourceId}
            label={b.sourceName}
            iconHtml={amenityPanelIcon(b.sourceId)}
            score={b.score}
            details={b.details}
            hasData={b.hasData}
          />
        ))}
      </div>
    );
  };

  return (
    <>
      <div className="panel-backdrop" onClick={handleClose} />
      <div className={`score-panel ${visible ? "score-panel-open" : ""}`}>
        <button className="panel-close" onClick={handleClose}>
          {"\u2715"}
        </button>

        <div className="panel-score-hero">
          <div className="panel-score-ring" style={{ borderColor: color }}>
            <span className="panel-score-number" style={{ color }}>
              {Math.round(cell.score)}
            </span>
            <span className="panel-score-label">/ 100</span>
          </div>
          <div className="panel-score-title">livability score</div>
          <div className="panel-score-coords">
            {cell.cell.centerLat.toFixed(4)}, {cell.cell.centerLng.toFixed(4)}
          </div>
          {hasPartial && (
            <div style={{ color: "#ff8800", fontSize: 10, marginTop: 6 }}>
              partial data -- some sources unavailable
            </div>
          )}
        </div>

        <div className="panel-divider" />

        {renderGroup("Amenities", amenities)}

        {amenities.length > 0 && safety.length > 0 && <div className="panel-divider" />}

        {renderGroup("Safety", safety)}

        {(amenities.length > 0 || safety.length > 0) && other.length > 0 && <div className="panel-divider" />}

        {renderGroup("Other", other)}
      </div>
    </>
  );
}
