import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";

import { formatSigned } from "@/lib/progress/calculations";

export interface TrendValueProps {
  value: number;
  suffix?: string;
}

export function TrendValue({ value, suffix = "" }: TrendValueProps) {
  const tone = value > 0 ? "positive" : value < 0 ? "danger" : "neutral";
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : ArrowRight;

  return (
    <span className={`trend ${tone}`}>
      <Icon size={12} strokeWidth={3} />
      {formatSigned(value)}
      {suffix}
    </span>
  );
}
