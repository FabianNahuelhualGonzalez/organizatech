import type { InputHTMLAttributes } from "react";

/**
 * Primitive compartida de input de texto (P3-47B). Es deliberadamente MÍNIMA: no aporta label,
 * error, validación, estado ni ninguna lógica de formulario — esa composición ya la resuelve
 * `FormField` (P3-47A) en el consumidor.
 *
 * Su única responsabilidad es fijar `type="text"` como default explícito y propagar íntegramente
 * el resto de atributos HTML nativos (`value`, `onChange`, `maxLength`, `placeholder`,
 * `inputMode`, `autoComplete`, `readOnly`, `aria-readonly`, …).
 *
 * El default NO impide otros tipos: `type` es una prop normal, de modo que `date`, `email`, `tel`,
 * `password`, etc. siguen siendo válidos pasándolos explícitamente.
 *
 * No transforma valores ni construye objetos crudos: lo que el consumidor pasa es exactamente lo
 * que llega al `<input>` nativo.
 */

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export function TextInput({ type = "text", ...textInputProps }: TextInputProps) {
  return <input {...textInputProps} type={type} />;
}
