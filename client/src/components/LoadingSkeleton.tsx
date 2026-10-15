export function LoadingSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div
      className="video-grid loading-grid"
      aria-label="Loading videos"
      aria-busy="true"
    >
      {Array.from({ length: count }, (_, index) => (
        <div className="loading-card" key={index}>
          <div className="loading-thumbnail" />
          <div className="loading-content">
            <div className="loading-line loading-line-small" />
            <div className="loading-line" />
            <div className="loading-line loading-line-short" />
          </div>
        </div>
      ))}
    </div>
  );
}