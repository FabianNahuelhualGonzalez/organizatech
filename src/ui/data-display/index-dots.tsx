import { DASHBOARD_DOTS_ARIA_LABEL } from "@/lib/dashboard/dashboard-presentation";

export interface IndexDotsProps {
  activeIndex: number;
  count: number;
}

export function IndexDots({ activeIndex, count }: IndexDotsProps) {
  return (
    <div className="dashboard-day-dots" aria-label={DASHBOARD_DOTS_ARIA_LABEL}>
      {Array.from({ length: count }).map((_, index) => (
        <span
          key={index}
          className={`dashboard-day-dot ${index === activeIndex ? "active" : ""}`}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
