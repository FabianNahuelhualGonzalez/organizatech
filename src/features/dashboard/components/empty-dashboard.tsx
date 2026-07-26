import { Dumbbell } from "lucide-react";

export interface EmptyDashboardProps {
  startRegistration: () => void;
}

export function EmptyDashboard({ startRegistration }: EmptyDashboardProps) {
  return (
    <section className="empty-dashboard">
      <div className="empty-hero">
        <div className="brand-mark empty-logo">
          <Dumbbell size={30} />
        </div>
        <h2>Organizatech</h2>
        <p>Da tu esfuerzo, nosotros analizamos tu progreso</p>
      </div>
      <button className="start-button" onClick={startRegistration}>
        Empecemos a registrar
      </button>
    </section>
  );
}
