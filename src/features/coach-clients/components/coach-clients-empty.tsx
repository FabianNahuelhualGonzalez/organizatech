import { Search } from "lucide-react";
import type { CoachClientsEmptyView } from "./coach-clients-view";
import styles from "./coach-clients-empty.module.css";

const COPY = {
  active: { title: "Todavía no tienes clientes activos", body: "Cuando un alumno use su código de vinculación, aparecerá aquí.", action: "Agregar mi primer cliente" },
  pending: { title: "No hay solicitudes pendientes", body: "Aquí verás a quienes invitaste y todavía no han usado su código.", action: "Enviar una solicitud" },
  inactive: { title: "No has desvinculado a nadie", body: "Los clientes que dejen de entrenar contigo quedarán guardados aquí.", action: "Ver clientes activos" },
} as const;

export function CoachClientsEmpty({ view, onLink, onShowActive, onClearSearch }: {
  readonly view: CoachClientsEmptyView;
  readonly onLink?: () => void;
  readonly onShowActive?: () => void;
  readonly onClearSearch?: () => void;
}) {
  const copy = view.kind === "search" ? {
    title: `Sin resultados para «${view.queryLabel}»`,
    body: "Revisa el nombre o el correo, o prueba en otra pestaña.", action: "Limpiar búsqueda",
  } : COPY[view.kind];
  const onAction = view.kind === "search" ? onClearSearch : view.kind === "inactive" ? onShowActive : onLink;
  return (
    <div className={styles.empty} data-empty={view.kind}>
      <span className={styles.icon} aria-hidden="true"><Search size={20} /></span>
      <h3 className={styles.title}>{copy.title}</h3>
      <p className={styles.body}>{copy.body}</p>
      <button className={styles.action} type="button" onClick={onAction} disabled={!onAction}>{copy.action}</button>
    </div>
  );
}
