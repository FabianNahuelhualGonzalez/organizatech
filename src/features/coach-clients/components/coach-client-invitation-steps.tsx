import { SquareCheck, Zap } from "lucide-react";
import type { CoachClientInstructionSteps } from "./coach-add-client-view";
import styles from "./coach-client-invitation-steps.module.css";

const TONES = ["accent", "pending", "ok"] as const;

export function CoachClientInvitationSteps({ variant, steps }: { readonly variant: "before" | "after"; readonly steps: CoachClientInstructionSteps }) {
  const title = variant === "before" ? "QUÉ VA A PASAR" : "LO QUE TIENE QUE HACER";
  return <section className={styles.block} data-variant={variant} aria-label={title}>
    <div className={styles.header}>
      <span className={styles.icon}>{variant === "before" ? <Zap size={12} aria-hidden="true" /> : <SquareCheck size={12} aria-hidden="true" />}</span>
      <h3>{title}</h3>
    </div>
    <ol className={styles.steps}>
      {steps.map((step, index) => <li className={styles.step} key={step.id} data-tone={TONES[index % TONES.length]}>
        <span className={styles.number} aria-hidden="true">{index + 1}</span><span className={styles.text}>{step.label}</span>
      </li>)}
    </ol>
  </section>;
}
