import type { ReactNode } from "react";

export interface CardProps {
  wide?: boolean;
  className?: string;
  children: ReactNode;
}

export function Card({ wide, className, children }: CardProps) {
  const composedClassName = `card${wide ? " wide" : ""}${className ? ` ${className}` : ""}`;

  return <div className={composedClassName}>{children}</div>;
}
