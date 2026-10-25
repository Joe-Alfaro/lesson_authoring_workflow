/** The 50-minute pacing ribbon (Launch 5, Lab 10, Learning in Action 30, Look Back 5). */
export function PacingRibbon({ className = '' }: { className?: string }) {
  return (
    <div className={`ribbon ${className}`} aria-hidden="true">
      <i className="launch" style={{ flex: 5 }} />
      <i className="lab" style={{ flex: 10 }} />
      <i className="action" style={{ flex: 30 }} />
      <i className="lookback" style={{ flex: 5 }} />
    </div>
  )
}
