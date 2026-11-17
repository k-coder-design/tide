/** Insights (screens 6–7) arrive in phase 5; until then the tab says so plainly. */
export function InsightsScreen() {
  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Insights</h1>
      </header>
      <section className="card">
        <h2>Charts are on the way</h2>
        <p className="muted">Keep logging — activity per week, desire over time and month comparisons appear here in a coming update.</p>
      </section>
    </div>
  )
}
