export function LoadingOverlay() {
  return (
    <div className="loading-overlay">
      <div className="loading-spinner" />
      <span className="loading-text">fetching...</span>
    </div>
  );
}
