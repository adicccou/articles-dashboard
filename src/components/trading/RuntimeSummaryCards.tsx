export function RuntimeSummaryCards({
  cards,
}: {
  cards: Array<{
    label: string;
    value: string | number;
    detail?: string | null;
    tone?: string | null;
  }>;
}) {
  return (
    <div className="custom-lean-summary">
      {cards.map((card) => (
        <div key={card.label}>
          <span>{card.label}</span>
          <strong className={card.tone || undefined}>{card.value}</strong>
          {card.detail ? <small>{card.detail}</small> : null}
        </div>
      ))}
    </div>
  );
}
