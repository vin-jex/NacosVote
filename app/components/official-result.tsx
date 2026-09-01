type Official = {
  positions: { id: number; name: string; candidates: { id: number; name: string; votes: number }[] }[];
  declarations: number;
};

/**
 * The official result, tallied from the declared choices of confirmed-valid
 * stakeholders. Shown above the anonymous ballot-box tally. Percentages are of
 * the declared votes for that position.
 */
export function OfficialResult({ official }: { official: Official }) {
  return (
    <div className="mt-6 rounded border-2 border-accent p-4">
      <p className="kicker text-accent">Official result</p>
      <p className="field-hint mt-0.5">
        Tallied from {official.declarations} confirmed stakeholder
        {official.declarations === 1 ? '' : 's'} who reported who they voted for. This is the
        result of record.
      </p>

      {official.positions.map((p) => {
        const cast = p.candidates.reduce((s, c) => s + c.votes, 0);
        return (
          <section key={p.id} className="mt-4">
            <h3 className="position-title text-base">{p.name}</h3>
            <p className="field-hint">{cast} declared</p>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {p.candidates.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-b-0">
                    <td className="py-2 pr-3">{c.name}</td>
                    <td className="whitespace-nowrap py-2 text-right tabular-nums">
                      <span className="font-semibold">{c.votes}</span>
                      <span className="ml-2 text-ink/60">
                        {(cast ? (c.votes / cast) * 100 : 0).toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
