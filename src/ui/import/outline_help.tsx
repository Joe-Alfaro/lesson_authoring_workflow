/** The aside on every import screen: what a lesson outline must contain. */
export function OutlineHelp() {
  return (
    <aside className="aside panel panel-pad" aria-labelledby="outline-help">
      <h2 id="outline-help">What the outline needs</h2>
      <ol>
        <li>A banner row with grade, unit, anchor text and ISBN.</li>
        <li>A header row, then arc rows, lesson rows, flex days and a totals row.</li>
        <li>Standards codes in the focus and supporting columns, for example RL.6.1, L.6.4.b.</li>
      </ol>
      <p className="caption">
        You&apos;ll see every lesson and any warnings before a unit is created.
      </p>
    </aside>
  )
}
