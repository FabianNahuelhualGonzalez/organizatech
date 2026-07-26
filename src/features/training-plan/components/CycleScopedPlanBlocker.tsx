export interface CycleScopedPlanBlockerProps {
  message: string;
}

export function CycleScopedPlanBlocker({ message }: CycleScopedPlanBlockerProps) {
  return (
    <section className="screen">
      <div className="card wide cycle-management-card">
        <p className="eyebrow">Plan cycle-scoped</p>
        <h2>Plan operativo no disponible</h2>
        <p>{message}</p>
      </div>
    </section>
  );
}
