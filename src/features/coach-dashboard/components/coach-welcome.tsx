import type { CoachWelcomeView } from "./coach-dashboard-view";
import styles from "./coach-welcome.module.css";

export function CoachWelcome({ view }: { readonly view: CoachWelcomeView }) {
  return (
    <header className={styles.welcome}>
      <h2 className={styles.title}>Bienvenido <b>coach</b></h2>
      <p className={styles.name}>{view.coachName}</p>
      {view.todayLabel !== null ? <p className={styles.today}>{view.todayLabel}</p> : null}
    </header>
  );
}
