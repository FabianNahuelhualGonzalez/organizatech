import { resolveDashboardDotIndex } from "@/lib/dashboard/dashboard-carousel-state";
import { IndexDots } from "@/ui/data-display/index-dots";

export interface DashboardDayDotsProps {
  day: string;
  weekDays: string[];
}

export function DashboardDayDots({ day, weekDays }: DashboardDayDotsProps) {
  const activeIndex = resolveDashboardDotIndex(weekDays, day);
  return <IndexDots activeIndex={activeIndex} count={weekDays.length} />;
}
