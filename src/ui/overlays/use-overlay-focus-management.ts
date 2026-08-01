"use client";

import { useEffect, useRef } from "react";

/**
 * Motor ÚNICO de ownership, foco y teclado para overlays (P3-50B0). Extrae, sin cambios de
 * comportamiento, el algoritmo ya auditado en `ModalShell` (P3-48A y su remediación de foco), para
 * que fases posteriores puedan conectar Drawer y NotificationPanel al MISMO stack.
 *
 * En P3-50B0 el único consumidor productivo es `ModalShell`; Drawer y NotificationPanel NO se
 * migran aquí.
 *
 * Debe existir un solo stack productivo en toda la app: este módulo. Ningún consumidor puede
 * conservar una copia local del stack, del selector de enfocables ni del listener.
 *
 * Deliberadamente NO hace: cerrar por backdrop, tocar `document.body`, aplicar scroll lock,
 * navegar, ni usar repositories/storage/Supabase.
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
 *
 * El VALOR del atributo se conserva intacto (`data-modal-initial-focus`) aunque el nombre de la
 * constante sea ahora genérico: cambiarlo rompería a los consumidores actuales de `ModalShell`, que
 * lo escriben en el DOM vía `MODAL_INITIAL_FOCUS_ATTRIBUTE`. La compatibilidad es deliberada.
 */
export const OVERLAY_INITIAL_FOCUS_ATTRIBUTE = "data-modal-initial-focus";

/**
 * Identidad opaca por instancia. Se usa un objeto vacío por instancia (vía `useRef`) en lugar de un
 * id global predecible, `Date.now`, `Math.random`, `crypto` o un contador compartido.
 */
type OverlayFocusOwner = Record<string, never>;

/**
 * Stack de overlays activos, privado del módulo. Sólo la instancia superior procesa Tab/Escape, de
 * modo que dos overlays simultáneos no compitan por el foco ni se cierren ambos con una sola tecla.
 */
const activeOverlayOwners: OverlayFocusOwner[] = [];

function isTopOverlayOwner(owner: OverlayFocusOwner): boolean {
  return activeOverlayOwners.length > 0 && activeOverlayOwners[activeOverlayOwners.length - 1] === owner;
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

function getFocusableElements(containerNode: HTMLElement): HTMLElement[] {
  return Array.from(containerNode.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isFocusableCandidate);
}

export interface UseOverlayFocusManagementInput {
  /**
   * Permite que un consumidor que siempre está montado (Drawer, NotificationPanel) active el motor
   * sólo cuando el overlay es visible. `ModalShell` sólo se renderiza abierto, así que usa `true`.
   */
  isActive?: boolean;
  onClose: () => void;
  /** Cuando es `false`, `Escape` no cierra (p. ej. mientras una operación está en curso). */
  canClose?: boolean;
}

export function useOverlayFocusManagement<TElement extends HTMLElement = HTMLElement>({
  isActive = true,
  onClose,
  canClose = true,
}: UseOverlayFocusManagementInput) {
  const containerRef = useRef<TElement | null>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);
  // Identidad estable de esta instancia dentro del stack del módulo.
  const ownerRef = useRef<OverlayFocusOwner>({});
  // Valores vigentes para el listener, que se registra UNA sola vez por activación: sin esto,
  // cambiar `onClose` o `canClose` obligaría a re-registrar el listener y alteraría el orden
  // relativo del stack.
  const onCloseRef = useRef(onClose);
  const canCloseRef = useRef(canClose);
  // Permite distinguir una transición real hacia busy de un simple re-render.
  const previousCanCloseRef = useRef(canClose);

  onCloseRef.current = onClose;
  canCloseRef.current = canClose;

  // Foco inicial + restauración. Es el ciclo de vida de la activación del overlay.
  useEffect(() => {
    if (!isActive) return;
    const containerNode = containerRef.current;
    if (!containerNode) return;

    previouslyFocusedRef.current = document.activeElement;

    // Foco inicial: elemento marcado explícitamente → primer control habilitado → contenedor.
    const explicitTarget = containerNode.querySelector<HTMLElement>(`[${OVERLAY_INITIAL_FOCUS_ATTRIBUTE}]`);
    const initialTarget = (explicitTarget && isFocusableCandidate(explicitTarget) ? explicitTarget : null)
      ?? getFocusableElements(containerNode)[0]
      ?? containerNode;
    initialTarget.focus();

    return () => {
      const previous = previouslyFocusedRef.current;
      // Sólo se restaura si el elemento sigue conectado al documento; si se desmontó, no se fuerza
      // ningún fallback artificial sobre `body`.
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [isActive]);

  // Ownership del stack + listener de teclado. Se registra una sola vez por activación.
  useEffect(() => {
    if (!isActive) return;
    const containerNode = containerRef.current;
    if (!containerNode) return;

    const owner = ownerRef.current;
    // Alta idempotente: en React Strict Mode el efecto se monta, limpia y vuelve a montar con la
    // misma identidad; no debe quedar duplicada.
    if (!activeOverlayOwners.includes(owner)) activeOverlayOwners.push(owner);

    function handleKeyDown(event: KeyboardEvent) {
      if (!containerNode) return;
      // Sólo el overlay superior reacciona; los inferiores ignoran por completo el evento.
      if (!isTopOverlayOwner(owner)) return;

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

      const focusable = getFocusableElements(containerNode);
      if (focusable.length === 0) {
        // Sin controles enfocables el foco no debe escapar del overlay.
        event.preventDefault();
        containerNode.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !containerNode.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last || !containerNode.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    // Fase CAPTURE: se adelanta a los handlers globales registrados en burbuja.
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      // Baja por identidad exacta: no se asume que los cleanups ocurran en orden perfecto.
      const ownerIndex = activeOverlayOwners.indexOf(owner);
      if (ownerIndex !== -1) activeOverlayOwners.splice(ownerIndex, 1);
    };
  }, [isActive]);

  // Reconciliación del foco al entrar en busy: al deshabilitarse la acción que tenía el foco, el
  // navegador puede moverlo a `body`. Se recupera de inmediato, sin esperar al siguiente Tab.
  useEffect(() => {
    const wasClosable = previousCanCloseRef.current;
    previousCanCloseRef.current = canClose;

    if (!isActive) return;

    // Sólo actúa en la transición efectiva hacia busy; volver a `canClose: true` no reinicia el
    // ciclo ni dispara callbacks.
    if (canClose || wasClosable === false) return;

    const containerNode = containerRef.current;
    if (!containerNode) return;

    const active = document.activeElement;
    const focusIsInsideContainer = active instanceof HTMLElement && containerNode.contains(active);
    const focusIsStillUsable = focusIsInsideContainer
      && (active === containerNode || getFocusableElements(containerNode).includes(active));

    // No se roba el foco si sigue en un elemento válido dentro del overlay.
    if (focusIsStillUsable) return;
    containerNode.focus();
  }, [canClose, isActive]);

  return containerRef;
}
