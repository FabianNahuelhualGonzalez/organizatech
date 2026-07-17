"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

const menuItems = [
  { href: "#producto", label: "Producto" },
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#coaches", label: "Coaches" },
];

export function MobileMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };

    const desktopMedia = window.matchMedia("(min-width: 1025px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setIsOpen(false);
    };

    const focusFrame = window.requestAnimationFrame(() => firstLinkRef.current?.focus());

    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsideClick);
    desktopMedia.addEventListener("change", closeOnDesktop);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      desktopMedia.removeEventListener("change", closeOnDesktop);
    };
  }, [isOpen]);

  return (
    <div className={styles.mobileMenu} ref={menuRef}>
      <button
        ref={buttonRef}
        className={styles.menuButton}
        type="button"
        aria-label={isOpen ? "Cerrar menú" : "Abrir menú"}
        aria-expanded={isOpen}
        aria-controls="mobile-navigation"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>

      <nav
        className={`${styles.mobileNavigation} ${isOpen ? styles.mobileNavigationOpen : ""}`}
        id="mobile-navigation"
        aria-label="Navegación móvil"
        aria-hidden={!isOpen}
      >
        {menuItems.map((item, index) => (
          <a
            href={item.href}
            key={item.href}
            ref={index === 0 ? firstLinkRef : undefined}
            tabIndex={isOpen ? undefined : -1}
            onClick={() => {
              setIsOpen(false);
              buttonRef.current?.focus({ preventScroll: true });
            }}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {item.label}
            <i aria-hidden="true">→</i>
          </a>
        ))}
      </nav>
    </div>
  );
}
