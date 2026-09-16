"use client";

import type { RefObject } from "react";
import { Search, X } from "lucide-react";
import styles from "./coach-clients-search.module.css";

export function CoachClientsSearch({ query, inputRef, onQueryChange }: {
  readonly query: string;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onQueryChange?: (query: string) => void;
}) {
  function clearSearch() {
    if (!onQueryChange) return;
    onQueryChange("");
    inputRef.current?.focus();
  }
  return (
    <div className={styles.wrap} role="search" aria-label="Buscar clientes">
      <div className={styles.search}>
        <Search size={16} aria-hidden="true" />
        <input ref={inputRef} type="text" value={query} readOnly={!onQueryChange}
          placeholder="Busca por nombre o correo…" aria-label="Buscar cliente"
          onChange={onQueryChange ? (event) => onQueryChange(event.currentTarget.value) : undefined} />
        {query !== "" ? (
          <button className={styles.clear} type="button" aria-label="Limpiar búsqueda"
            disabled={!onQueryChange} onClick={onQueryChange ? clearSearch : undefined}>
            <span><X size={10} strokeWidth={3} aria-hidden="true" /></span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
