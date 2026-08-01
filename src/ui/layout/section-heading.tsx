import type { ReactNode } from "react";

/**
 * Primitive compartida del encabezado de bloque de setup (P3-49A). Extrae ÚNICAMENTE la estructura
 * visual idéntica que repetían cuatro cards de configuración:
 *
 *   <div className="setup-section-heading">
 *     <p className="eyebrow">…</p>
 *     <h3>…</h3>
 *   </div>
 *
 * Deliberadamente MÍNIMA: sin `variant`, `headingLevel`, `action`, `icon`, `subtitle`, `card`,
 * polimorfismo `as`, configuración genérica, estado, efectos, navegación ni lógica de negocio. La
 * clase la aporta el consumidor, de modo que la primitive no presume el estilo de ninguna feature.
 *
 * El nivel `h3` es fijo a propósito: los cuatro consumidores migrados ya usaban `h3` y cambiarlo
 * alteraría la jerarquía de encabezados. Si en el futuro un consumidor necesitara otro nivel, la
 * decisión debe tomarse explícitamente y no mediante una prop añadida aquí sin evidencia.
 *
 * No usa hooks, no usa `dangerouslySetInnerHTML`, no hace spread indiscriminado de props, no
 * implementa estilos y no importa consumidores ni features.
 */

export interface SectionHeadingProps {
  className: string;
  eyebrow: ReactNode;
  title: ReactNode;
}

export function SectionHeading({ className, eyebrow, title }: SectionHeadingProps) {
  return (
    <div className={className}>
      <p className="eyebrow">{eyebrow}</p>
      <h3>{title}</h3>
    </div>
  );
}
