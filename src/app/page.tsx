import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { MobileMenu } from "./mobile-menu";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Organizatech | Tu entrenamiento, con contexto",
  description:
    "Organiza tu rutina, registra cada sesión y entiende tu progreso sin depender de notas sueltas.",
};

const workflow = [
  {
    number: "01",
    label: "Antes de entrenar",
    title: "Tu semana ya está ordenada.",
    description:
      "Define el ciclo, elige tus días y deja cada rutina preparada antes de llegar al gimnasio.",
    details: ["Ciclo activo", "Días de entrenamiento", "Rutina por sesión"],
  },
  {
    number: "02",
    label: "Durante la sesión",
    title: "Registra sin salir del entrenamiento.",
    description:
      "Anota series, repeticiones y cargas ejercicio por ejercicio. Lo justo para entrenar con foco.",
    details: ["Series y repeticiones", "Carga utilizada", "Estado del día"],
  },
  {
    number: "03",
    label: "Al cerrar la semana",
    title: "Mira lo que cambió de verdad.",
    description:
      "Compara tus resultados, revisa el ciclo completo y decide el próximo paso con información real.",
    details: ["Comparación semanal", "Historial de ciclos", "Lectura de progreso"],
  },
];

const connectedData = [
  "Tu planificación semanal",
  "Cada sesión completada",
  "El peso y las repeticiones",
  "Cómo llegaste a entrenar",
  "La evolución de cada ejercicio",
  "El resultado de todo el ciclo",
];

const coachBenefits = [
  "Cada deportista con su propio historial.",
  "Adherencia y sesiones visibles en un solo lugar.",
  "Más contexto para conversar y ajustar el plan.",
];

export default function WebsitePreviewPage() {
  return (
    <main className={styles.site}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <MobileMenu />

          <Link className={styles.brand} href="/" aria-label="Organizatech, inicio">
            <Image src="/icon.svg" width={36} height={36} alt="" priority />
            <span>organizatech</span>
          </Link>

          <nav className={styles.navigation} aria-label="Navegación principal">
            <a href="#producto">Producto</a>
            <a href="#como-funciona">Cómo funciona</a>
            <a href="#coaches">Coaches</a>
          </nav>

          <Link className={styles.headerCta} href="/login">
            Iniciar sesión <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}><span aria-hidden="true" /> Seguimiento de entrenamiento</p>
          <h1>
            Entrena con un plan.<br />
            <em>Avanza con evidencia.</em>
          </h1>
          <p className={styles.heroLead}>
            Organizatech reúne tu rutina, tus sesiones y tu progreso para que dejes de entrenar a ciegas.
          </p>
          <Link className={styles.heroCta} href="/login">
            Crear mi cuenta <span aria-hidden="true">→</span>
          </Link>
          <p className={styles.heroNote}>Tu cuenta. Tus datos. Tu progreso.</p>
        </div>

        <div className={styles.productStage} id="producto" aria-label="Vista conceptual de Organizatech">
          <div className={styles.stageHeader}>
            <div className={styles.stageBrand}>
              <Image src="/icon.svg" width={30} height={30} alt="" />
              <div><span>ORGANIZATECH</span><strong>Ciclo 02 · Semana 04</strong></div>
            </div>
            <span className={styles.liveStatus}><i aria-hidden="true" /> EN CURSO</span>
          </div>

          <div className={styles.stageGrid}>
            <div className={styles.todayPanel}>
              <div className={styles.panelHeading}>
                <div><span>HOY / VIERNES</span><h2>Torso · Fuerza</h2></div>
                <span className={styles.sessionCount}>04 ejercicios</span>
              </div>
              <div className={styles.exerciseList}>
                <div><span>01</span><p>Press banca</p><strong>4 × 8</strong></div>
                <div><span>02</span><p>Remo con barra</p><strong>4 × 10</strong></div>
                <div><span>03</span><p>Press militar</p><strong>3 × 10</strong></div>
                <div><span>04</span><p>Jalón al pecho</p><strong>3 × 12</strong></div>
              </div>
              <div className={styles.startSession}>Iniciar entrenamiento <span aria-hidden="true">→</span></div>
            </div>

            <div className={styles.progressPanel}>
              <span className={styles.panelLabel}>PROGRESO SEMANAL</span>
              <div className={styles.progressValue}><strong>75</strong><span>%</span></div>
              <div className={styles.progressLine} aria-hidden="true"><span /></div>
              <p>3 de 4 sesiones completadas.</p>
              <div className={styles.weekDays} aria-label="Estado de la semana">
                <span className={styles.done}>L<i>✓</i></span>
                <span className={styles.done}>M<i>✓</i></span>
                <span>X<i>—</i></span>
                <span className={styles.done}>J<i>✓</i></span>
                <span className={styles.current}>V<i>HOY</i></span>
              </div>
              <div className={styles.progressReading}>
                <span>LECTURA DE LA SEMANA</span>
                <p>Vas a tiempo. Completa la sesión de hoy y cierra la semana según lo planificado.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.contextBar} aria-label="Resumen de propuesta de valor">
        <div><span>01</span><p>Un plan claro</p></div>
        <div><span>02</span><p>Registros útiles</p></div>
        <div><span>03</span><p>Progreso en contexto</p></div>
      </section>

      <section className={styles.workflowSection} id="como-funciona">
        <div className={styles.sectionIntro}>
          <p className={styles.kicker}><span aria-hidden="true" /> Así funciona</p>
          <h2>Empieza con la rutina que ya haces.</h2>
          <p>No tienes que cambiar tu forma de entrenar. Solo dejar de perder lo que ya estás haciendo.</p>
        </div>

        <div className={styles.workflowList}>
          {workflow.map((item) => (
            <article className={styles.workflowItem} key={item.number}>
              <div className={styles.workflowNumber}>{item.number}</div>
              <div className={styles.workflowCopy}>
                <span>{item.label}</span>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
              <ul>
                {item.details.map((detail) => <li key={detail}>{detail}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.connectedSection}>
        <div className={styles.connectedInner}>
          <p className={styles.darkKicker}>TODO CONECTADO / SIN PLANILLAS SUELTAS</p>
          <h2>Tu entrenamiento deja de ser una colección de números.</h2>
          <p className={styles.connectedLead}>
            Cada dato aparece donde hace sentido: dentro de la sesión, la semana y el ciclo al que pertenece.
          </p>

          <div className={styles.connectedList}>
            {connectedData.map((item, index) => (
              <div key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></div>
            ))}
          </div>

          <div className={styles.contextStatement}>
            <span>ANTES</span>
            <p>“Creo que estoy avanzando.”</p>
            <i aria-hidden="true">→</i>
            <span>AHORA</span>
            <p>“Sé qué cambió y por qué.”</p>
          </div>
        </div>
      </section>

      <section className={styles.coachSection} id="coaches">
        <div className={styles.coachCopy}>
          <p className={styles.kicker}><span aria-hidden="true" /> Para coaches · En preparación</p>
          <h2>El seguimiento también debería sentirse simple.</h2>
          <p>
            Estamos diseñando una vista para coaches que ordena lo importante sin convertir el trabajo diario en
            otra planilla más.
          </p>
          <ul>
            {coachBenefits.map((benefit) => <li key={benefit}><span aria-hidden="true">✓</span>{benefit}</li>)}
          </ul>
          <a className={styles.coachCta} href="#coach-preview">Quiero ser coach <span aria-hidden="true">→</span></a>
        </div>

        <div className={styles.coachPreview} id="coach-preview" aria-label="Vista conceptual para coaches">
          <div className={styles.coachPreviewHeader}>
            <div><span>VISTA COACH</span><strong>Deportistas</strong></div>
            <span>12 activos</span>
          </div>
          <div className={styles.coachStats}>
            <div><span>ADHERENCIA</span><strong>86%</strong></div>
            <div><span>SESIONES / SEMANA</span><strong>38</strong></div>
          </div>
          <div className={styles.athletes}>
            <div><span>AM</span><p>Alex M.<small>Semana completada</small></p><strong>4 / 4</strong></div>
            <div><span>JV</span><p>Josefina V.<small>Entrena hoy</small></p><strong>2 / 3</strong></div>
            <div><span>DR</span><p>Diego R.<small>Revisar progreso</small></p><strong>3 / 4</strong></div>
          </div>
          <p className={styles.conceptNote}>Vista conceptual · No representa una cuenta real.</p>
        </div>
      </section>

      <section className={styles.finalCta}>
        <p>EMPIEZA POR TU PRÓXIMA SESIÓN</p>
        <h2>Menos notas sueltas.<br />Más claridad para avanzar.</h2>
        <Link href="/login">Crear mi cuenta <span aria-hidden="true">→</span></Link>
        <small>Configura tu rutina y comienza a registrar.</small>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <Image src="/icon.svg" width={34} height={34} alt="" />
          <div><strong>organizatech</strong><span>Tu entrenamiento, con contexto.</span></div>
        </div>
        <div className={styles.footerLinks}>
          <a href="#producto">Producto</a>
          <a href="#como-funciona">Cómo funciona</a>
          <a href="#coaches">Coaches</a>
        </div>
        <p>© {new Date().getFullYear()} Organizatech</p>
      </footer>
    </main>
  );
}
