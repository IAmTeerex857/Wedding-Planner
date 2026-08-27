export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-mark" aria-label="Timmy and Bisola">
      <span className="brand-monogram">T/B</span>
      {!compact && (
        <span className="brand-copy">
          <strong>Timmy & Bisola</strong>
          <small>Wedding office</small>
        </span>
      )}
    </div>
  )
}
