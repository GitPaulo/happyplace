import { amenityPanelIcon } from "../utils/amenityIcons";

interface WeightSlidersProps {
  sources: { id: string; name: string; weight: number }[];
  weights: Record<string, number>;
  onChange: (weights: Record<string, number>) => void;
}

export function WeightSliders({ sources, weights, onChange }: WeightSlidersProps) {
  return (
    <div className="weight-sliders">
      <div className="weight-sliders-title">Adjust Weights</div>
      {sources.map((source) => {
        const value = weights[source.id] ?? source.weight;
        return (
          <div key={source.id} className="weight-slider-row">
            <span
              className="weight-slider-icon"
              dangerouslySetInnerHTML={{ __html: amenityPanelIcon(source.id) }}
            />
            <span className="weight-slider-label">{source.name}</span>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={value}
              onChange={(e) =>
                onChange({ ...weights, [source.id]: parseFloat(e.target.value) })
              }
              className="weight-slider-input"
            />
            <span className="weight-slider-value">{value.toFixed(1)}</span>
          </div>
        );
      })}
    </div>
  );
}
