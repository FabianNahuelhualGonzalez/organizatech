"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Shell accesible compartido para los modales existentes (P3-48A, remediado tras auditoría).
 * Resuelve la brecha identificada en el inventario P3-46: los modales declaraban `role="dialog"` +
 * `aria-modal` pero no gestionaban foco ni teclado.
 *
 * Es una primitive PEQUEÑA y especializada, no un modal universal: etiqueta accesible, cierre, si
 * el cierre está permitido, clase visual de la card y children.
 *
 * Deliberadamente NO hace: cerrar al pulsar el backdrop (los modales actuales no lo hacen), tocar
 * `document.body`/scroll global/navegación, usar repositories/storage/Supabase/estado de dominio,
 * aceptar objetos genéricos de configuración, ni `dangerouslySetInnerHTML`.
 */

/**
 * Selector base de elementos enfocables. Excluye deshabilitados, `tabindex="-1"`, `[hidden]` y
 * `aria-hidden="true"` en el propio elemento; los ancestros se filtran aparte, porque CSS no puede
 * expresar "ningún ancestro oculto".
 */
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
]
  .map((selector) => `${selector}:not([hidden]):not([aria-hidden="true"])`)
  .join(",");

/**
 * Marca opcional para indicar qué control debe recibir el foco inicial.
 */
export const MODAL_INITIAL_FOCUS_ATTRIBUTE = "data-modal-initial-focus";

/**
 * Identidad opaca por instancia. Se usa un objeto vacío por instancia (vía `useRef`) en lugar de un
 * id global predecible o un contador compartido.
 */
type ModalShellOwner = Record<string, never>;

/**
 * Stack de instancias activas, privado del módulo. Sólo la instancia superior procesa Tab/Escape,
 * de modo que dos modales simultáneos no compitan por el foco ni cierren ambos con una sola tecla.
 */
const activeModalOwners: ModalShellOwner[] = [];

function isTopModalOwner(owner: ModalShellOwner): boolean {
  return activeModalOwners.length > 0 && activeModalOwners[activeModalOwners.length - 1] === owner;
}

/**
 * Un elemento cuenta como enfocable sólo si ni él ni sus ancestros están ocultos. `checkVisibility`
 * se usa cuando el navegador lo soporta; no se recurre a `offsetParent`, que daría falsos negativos
 * en elementos `position: fixed`.
 */
function isFocusableCandidate(element: HTMLElement): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  const checkVisibility = (element as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility;
  if (typeof checkVisibility === "function") return checkVisibility.call(element);
  return true;
}

function getFocusableElements(dialogNode: HTMLElement): HTMLElement[] {
  return Array.from(dialogNode.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isFocusableCandidate);
}

export interface ModalShellProps {
  ariaLabel: string;
  onClose: () => void;
  /** Cuando es `false`, `Escape` no cierra (p. ej. mientras una operación está en curso). */
  canClose?: boolean;
  /** Clase de la card interna; conserva exactamente las clases existentes de cada consumidor. */
  cardClassName: string;
  children: ReactNode;
}

export function ModalShell({
  ariaLabel,
  onClose,
  canClose = true,
  cardClassName,
  children,
}: ModalShellProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);
  // Identidad estable de esta instancia dentro del stack del módulo.
  const ownerRef = useRef<ModalShellOwner>({});
  // Valores vigentes para el listener, que se registra UNA sola vez: sin esto, cambiar `onClose` o
  // `canClose` obligaría a re-registrar el listener y alteraría el orden relativo del stack.
  const onCloseRef = useRef(onClose);
  const canCloseRef = useRef(canClose);
  // Permite distinguir una transición real hacia busy de un simple re-render.
  const previousCanCloseRef = useRef(canClose);

  onCloseRef.current = onClose;
  canCloseRef.current = canClose;

  // Foco inicial + restauración. Deps vacías a propósito: es el ciclo de vida del diálogo.
  useEffect(() => {
    const dialogNode = dialogRef.current;
    if (!dialogNode) return;

    previouslyFocusedRef.current = document.activeElement;

    // Foco inicial: elemento marcado explícitamente → primer control habilitado → contenedor.
    const explicitTarget = dialogNode.querySelector<HTMLElement>(`[${MODAL_INITIAL_FOCUS_ATTRIBUTE}]`);
    const initialTarget = (explicitTarget && isFocusableCandidate(explicitTarget) ? explicitTarget : null)
      ?? getFocusableElements(dialogNode)[0]
      ?? dialogNode;
    initialTarget.focus();

    return () => {
      const previous = previouslyFocusedRef.current;
      // Sólo se restaura si el elemento sigue conectado al documento; si se desmontó, no se fuerza
      // ningún fallback artificial sobre `body`.
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  // Ownership del stack + listener de teclado. Se registra una sola vez por instancia.
  useEffect(() => {
    const dialogNode = dialogRef.current;
    if (!dialogNode) return;

    const owner = ownerRef.current;
    // Alta idempotente: en React Strict Mode el efecto se monta, limpia y vuelve a montar con la
    // misma identidad; no debe quedar duplicada.
    if (!activeModalOwners.includes(owner)) activeModalOwners.push(owner);

    function handleKeyDown(event: KeyboardEvent) {
      if (!dialogNode) return;
      // Sólo el modal superior reacciona; los inferiores ignoran por completo el evento.
      if (!isTopModalOwner(owner)) return;

      if (event.key === "Escape") {
        // El evento se aísla SIEMPRE, pueda cerrar o no: en fase capture, `stopImmediatePropagation`
        // impide que listeners globales inferiores (p. ej. el `keydown` de `mobile-menu.tsx`, que
        // escucha en burbuja sobre `document`) cierren un overlay subyacente.
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!canCloseRef.current) return;
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(dialogNode);
      if (focusable.length === 0) {
        // Sin controles enfocables el foco no debe escapar del diálogo.
        event.preventDefault();
        dialogNode.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !dialogNode.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last || !dialogNode.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    // Fase CAPTURE: se adelanta a los handlers globales registrados en burbuja.
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      // Baja por identidad exacta: no se asume que los cleanups ocurran en orden perfecto.
      const ownerIndex = activeModalOwners.indexOf(owner);
      if (ownerIndex !== -1) activeModalOwners.splice(ownerIndex, 1);
    };
  }, []);

  // Reconciliación del foco al entrar en busy: al deshabilitarse la acción que tenía el foco, el
  // navegador puede moverlo a `body`. Se recupera de inmediato, sin esperar al siguiente Tab.
  useEffect(() => {
    const wasClosable = previousCanCloseRef.current;
    previousCanCloseRef.current = canClose;

    // Sólo actúa en la transición efectiva hacia busy; volver a `canClose: true` no reinicia el
    // ciclo ni dispara callbacks.
    if (canClose || wasClosable === false) return;

    const dialogNode = dialogRef.current;
    if (!dialogNode) return;

    const active = document.activeElement;
    const focusIsInsideDialog = active instanceof HTMLElement && dialogNode.contains(active);
    const focusIsStillUsable = focusIsInsideDialog
      && (active === dialogNode || getFocusableElements(dialogNode).includes(active));

    // No se roba el foco si sigue en un elemento válido dentro del diálogo.
    if (focusIsStillUsable) return;
    dialogNode.focus();
  }, [canClose]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <div ref={dialogRef} className={cardClassName} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
