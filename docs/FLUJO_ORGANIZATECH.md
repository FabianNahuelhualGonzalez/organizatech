# Organizatech - Flujo actual de la app

Documento visual del flujo funcional actual de Organizatech. Los bloques estan escritos en Mermaid para que GitHub y editores compatibles los muestren como diagramas.

## 1. Mapa general de navegacion

```mermaid
flowchart TD
  A["Usuario abre Organizatech"] --> B{"Tiene sesion activa?"}
  B -->|"No"| C["Login"]
  B -->|"Quiere registrarse"| D["Registro de cuenta"]
  C --> E{"Login correcto?"}
  D --> F{"Registro correcto?"}
  E -->|"Si"| G["Panel principal"]
  F -->|"Si"| G
  E -->|"No"| C
  F -->|"No"| D

  G --> H["Menu hamburguesa"]
  H --> G
  H --> I["Entrenamiento"]
  H --> J["Registro de entrenamiento"]
  H --> K["Comparacion semanal"]
  H --> L["Historial ciclo de entrenamiento"]
  H --> M["Mi perfil"]
  H --> N["Cerrar sesion"]

  I --> O{"Existe rutina registrada?"}
  O -->|"No"| J
  O -->|"Si"| P["Inicio de entrenamiento"]

  J --> Q{"Existe ciclo activo con rutina?"}
  Q -->|"No"| R["Crear rutina desde cero"]
  Q -->|"Si"| S["Ciclo activo / modificar ciclo actual / crear nuevo ciclo"]

  K --> T["Comparar rutina base y semanas por dia"]
  L --> U["Ver ciclos finalizados como acordeon"]
  M --> V["Datos de perfil local / cuenta"]
  N --> C
```

## 2. Login, registro y persistencia

```mermaid
flowchart TD
  A["Pantalla Login"] --> B["Usuario ingresa correo y contrasena"]
  B --> C{"Supabase configurado?"}
  C -->|"Si"| D["Intentar autenticacion Supabase"]
  C -->|"No"| E["Modo demo local"]

  D --> F{"Autenticacion OK?"}
  F -->|"Si"| G["Guardar sesion / nombre usuario"]
  F -->|"No"| H["Mostrar error y seguir en Login"]
  E --> G

  I["Pantalla Registro"] --> J["Usuario crea cuenta"]
  J --> K{"Supabase configurado?"}
  K -->|"Si"| L["Crear usuario Supabase"]
  K -->|"No"| M["Crear sesion demo local"]
  L --> N{"Registro OK?"}
  N -->|"Si"| G
  N -->|"No"| I
  M --> G

  G --> O["Cargar ejercicios, entradas, plan y ciclos"]
  O --> P["Panel principal"]
```

## 3. Registro de entrenamiento / creacion de rutina

```mermaid
flowchart TD
  A["Usuario entra a Registro de entrenamiento"] --> B{"Ya existe rutina activa?"}
  B -->|"No"| C["Crear rutina desde cero"]
  B -->|"Si"| D["Ciclo activo"]

  D --> E["Mostrar resumen del ciclo activo"]
  E --> F["Modificar ciclo actual"]
  E --> G["Crear nuevo ciclo de entrenamiento"]
  G --> H{"Confirmar cierre del ciclo actual?"}
  H -->|"No"| D
  H -->|"Si"| I["Guardar snapshot en Historial ciclo de entrenamiento"]
  I --> C

  C --> J["Selecciona tu ciclo de entrenamiento"]
  J --> J1["Macrociclo"]
  J --> J2["Mesociclo"]
  J --> J3["Microciclo"]
  J --> J4["Sesion de entrenamiento"]

  J1 --> K["Seleccionar objetivo principal"]
  J2 --> K
  J3 --> K
  J4 --> K

  K --> L["Mostrar descripcion del objetivo seleccionado"]
  L --> M["Seleccionar duracion"]
  M --> N["Seleccionar dias de entrenamiento"]
  N --> O["Configurar rutinas por dia"]

  O --> P["Rutina 1 de N: nombre de rutina del dia"]
  P --> Q["Ejercicios a programar: nombre, series, reps, kg"]
  Q --> R{"Guardar y continuar"}
  R --> S{"Faltan dias seleccionados?"}
  S -->|"Si"| T["Avanzar al siguiente dia pendiente"]
  T --> P
  S -->|"No"| U["Finalizar registro de rutina"]
  U --> V["Popup Registro exitoso"]
  V --> W["OK"]
  W --> X["Panel principal / Entrenamiento"]
```

## 4. Entrenamiento diario

```mermaid
flowchart TD
  A["Usuario entra a Entrenamiento"] --> B{"Existe rutina registrada?"}
  B -->|"No"| C["Mostrar acceso para crear rutina"]
  C --> D["Registro de entrenamiento"]

  B -->|"Si"| E["Pantalla inicio de entrenamiento"]
  E --> F["Resumen del dia seleccionado"]
  F --> G["KG totales de la rutina"]
  F --> H["Total reps objetivo"]
  F --> I["Ejercicios total"]
  F --> J["Boton editar rutina semanal"]
  F --> K["Boton iniciar entrenamiento"]

  K --> L["Formulario de motivacion"]
  L --> M["Motivacion 1 a 7"]
  L --> N["Hidratacion 1 a 7"]
  L --> O["Sueno 1 a 7"]
  L --> P["Energia fisica 1 a 7"]
  L --> Q{"Empezar u omitir por hoy"}

  Q -->|"Empezar"| R["Guardar formulario de motivacion"]
  Q -->|"Omitir"| S["Registrar internamente: usuario no quiso registrar"]
  R --> T["Rutina guiada del dia"]
  S --> T

  T --> U["Ejercicios a realizar"]
  U --> V["Usuario toca ejercicio activo"]
  V --> W["Registro de series"]
  W --> X["Objetivo de tu rutina: kg y reps base"]
  W --> Y["Nuevo registro: peso usado y reps por serie"]
  Y --> Z["Calcular resultado contra objetivo"]
  Z --> AA{"Resultado del ejercicio"}
  AA -->|"Supera reps o kg"| AB["Cumplimos / Subimos kg o reps"]
  AA -->|"Iguala objetivo"| AC["Mantenemos esfuerzo / Mismo kg / Mismas reps"]
  AA -->|"Baja reps o kg"| AD["No cumplimos / Bajamos kg o reps"]
  AB --> AE["Registrar serie"]
  AC --> AE
  AD --> AE
  AE --> AF{"Todos los ejercicios registrados?"}
  AF -->|"No"| U
  AF -->|"Si"| AG["Guardar entrenamiento"]
  AG --> AH["Crear entradas de entrenamiento"]
  AH --> AI["Panel principal"]
```

## 5. Panel principal

```mermaid
flowchart TD
  A["Panel principal"] --> B["Metricas superiores"]
  B --> B1["Volumen de trabajo"]
  B --> B2["Total reps"]
  B --> B3["Ejercicios"]

  A --> C["Vista progreso semanal"]
  C --> C1["Porcentaje vs semana anterior"]
  C --> C2["Linea semanal"]

  A --> D["Entrenamiento del dia"]
  D --> E{"El dia actual tiene rutina?"}
  E -->|"Si"| F["Mostrar rutina del dia actual"]
  E -->|"No"| G["Mostrar no registra entrenamientos"]
  F --> H["Mostrar ejercicios y estado"]
  H --> I["Ir a rutina"]
  G --> J["Editar rutina semanal desde seccion entrenamiento/registro"]

  A --> K["Analisis inteligente"]
  K --> K1["Carga estable o aumento de carga"]
  K --> K2["Volumen semanal subio o bajo"]
  K --> K3["Cumplimiento por mejorar o consistencia solida"]
  K --> K4["Riesgo de fatiga o sin caidas criticas"]
  K --> K5["Ejercicio con mayor progreso"]

  A --> L["Resumen de motivacion IA"]
  L --> L1["Lee formularios de motivacion"]
  L --> L2["Detecta motivacion, hidratacion, sueno y energia"]
  L --> L3["Sugiere entrenar con control o ajustar exigencia"]

  A --> M["Analitica integrada"]
  M --> M1["Score total /100"]
  M --> M2["40% cumplimiento ejercicios"]
  M --> M3["25% repeticiones logradas"]
  M --> M4["20% carga mantenida/subida"]
  M --> M5["15% volumen vs objetivo o semana anterior"]
```

## 6. Comparacion semanal

```mermaid
flowchart TD
  A["Usuario entra a Comparacion semanal"] --> B["Selecciona rutina o dia"]
  B --> C{"Dia seleccionado tiene rutina?"}
  C -->|"No"| D["Dia bloqueado / sin datos comparables"]
  C -->|"Si"| E["Comparacion por mismo dia"]

  E --> F["Lunes compara solo con lunes"]
  E --> G["Martes compara solo con martes"]
  E --> H["Miercoles compara solo con miercoles"]
  E --> I["Y asi hasta domingo"]

  E --> J{"Semana actual"}
  J -->|"Semana 1"| K["Rutina registrada vs Semana 1"]
  J -->|"Semana 2"| L["Rutina registrada vs Semana 2 vs Semana 1"]
  J -->|"Semana 3 o mas"| M["Rutina registrada vs Semana actual vs semanas previas"]

  K --> N["Ejercicios comparados"]
  L --> N
  M --> N
  N --> O["Mostrar kg, reps, kg delta y volumen"]
  O --> P["Badges: Cumplimos / Mismo kg / Subimos reps / Bajamos reps"]

  N --> Q["Comparar ejercicio por semana"]
  Q --> R["Selector visual de ejercicio"]
  R --> S["Detalle del ejercicio seleccionado"]
  S --> T["Observacion clara"]
  S --> U["Grafico semanal del volumen"]
```

## 7. Ciclos e historial

```mermaid
flowchart TD
  A["Ciclo activo"] --> B["Resumen breve"]
  B --> B1["Ciclo numero"]
  B --> B2["Tipo de ciclo"]
  B --> B3["Objetivo"]
  B --> B4["Dias con rutina"]
  B --> B5["Ejercicios"]
  B --> B6["Semanas registradas"]

  A --> C["Modificar ciclo actual"]
  A --> D["Crear nuevo ciclo de entrenamiento"]
  D --> E{"Estas seguro?"}
  E -->|"No"| A
  E -->|"Si"| F["Finalizar ciclo actual"]
  F --> G["Crear snapshot"]
  G --> G1["Plan del ciclo"]
  G --> G2["Ejercicios programados"]
  G --> G3["Entrenamientos registrados"]
  G --> G4["Estado de animo"]
  G --> G5["Sugerencias"]
  G --> H["Guardar en historial ciclo de entrenamiento"]
  H --> I["Crear nuevo ciclo desde cero"]

  J["Historial ciclo de entrenamiento"] --> K["Hero Ciclos finalizados"]
  K --> L{"Hay ciclos cerrados?"}
  L -->|"No"| M["Mostrar estado vacio"]
  L -->|"Si"| N["Lista tipo FAQ / acordeon"]
  N --> O["Resumen ciclo 1 · Mesociclo · Objetivo"]
  O --> P{"Usuario toca resumen"}
  P -->|"Abrir"| Q["Desplegar detalle del ciclo"]
  P -->|"Cerrar"| R["Ocultar detalle"]
  Q --> Q1["Metricas: dias, ejercicios, volumen"]
  Q --> Q2["Subieron reps o peso"]
  Q --> Q3["Estancados"]
  Q --> Q4["Estado de animo"]
  Q --> Q5["Sugerencias"]
```

## 8. Modelo de datos y calculos

```mermaid
flowchart LR
  A["TrainingPlan"] --> A1["Tipo ciclo"]
  A --> A2["Objetivo"]
  A --> A3["Duracion"]
  A --> A4["Dias de entrenamiento"]

  B["ExerciseTemplate"] --> B1["Rutina base"]
  B --> B2["Dia"]
  B --> B3["Ejercicio"]
  B --> B4["Series objetivo"]
  B --> B5["Reps objetivo"]
  B --> B6["Peso base"]

  C["TrainingReadiness"] --> C1["Motivacion"]
  C --> C2["Hidratacion"]
  C --> C3["Sueno"]
  C --> C4["Energia"]
  C --> C5["Omitido"]

  D["ExerciseEntry"] --> D1["Ejercicio registrado"]
  D --> D2["Semana"]
  D --> D3["Fecha"]
  D --> D4["Peso usado"]
  D --> D5["Reps por serie"]
  D --> D6["Notas con formulario de motivacion"]

  E["ExerciseMetrics"] --> E1["Total reps"]
  E --> E2["Diferencia reps"]
  E --> E3["Diferencia kg"]
  E --> E4["Volumen"]
  E --> E5["Porcentaje volumen"]
  E --> E6["Estado objetivo"]

  F["WeeklySummary"] --> F1["Volumen semanal"]
  F --> F2["Total reps semanal"]
  F --> F3["Ejercicios semana"]
  F --> F4["Cumplimiento"]

  G["TrainingCycleSnapshot"] --> G1["Plan cerrado"]
  G --> G2["Ejercicios del ciclo"]
  G --> G3["Entradas del ciclo"]
  G --> G4["Resumen historial"]

  B --> D
  C --> D
  D --> E
  E --> F
  A --> G
  B --> G
  D --> G
```

### Decisiones funcionales actuales

| Area | Decision actual |
| --- | --- |
| Rutina base | El usuario programa dias, ejercicios, series, repeticiones y kg antes de entrenar. |
| Dias | Solo se muestran los dias con rutina registrada; maximo lunes a domingo. |
| Entrenamiento del dia | El panel principal usa el dia calendario actual y muestra rutina solo si ese dia existe. |
| Registro de ejercicio | El usuario selecciona ejercicio desde la lista y registra peso usado y reps por serie. |
| Comparacion inicial | En semana inicial se compara contra el objetivo base. Si iguala objetivo, se mantiene; no se marca como progreso falso. |
| Comparacion semanal | Se compara siempre por dia equivalente: lunes con lunes, martes con martes, etc. |
| Volumen | Se calcula como peso usado por total de repeticiones registradas. |
| KG totales de rutina | Se interpreta como suma de pesos base por ejercicio programado, no peso por reps. |
| Formulario de motivacion | Puede completarse u omitirse; si se omite queda registrado internamente. |
| Analitica integrada | Score ponderado: 40% cumplimiento, 25% reps, 20% carga, 15% volumen. |
| Ciclos | Al crear un nuevo ciclo se finaliza el actual y se guarda un snapshot en historial. |
| Historial de ciclos | Se muestra como acordeon tipo pregunta frecuente para evitar scroll infinito. |

## 9. Diagrama general completo

```mermaid
flowchart TD
  A["Abrir Organizatech"] --> B{"Sesion activa?"}
  B -->|"No"| C["Login / Registro"]
  C --> D{"Autenticacion o demo OK?"}
  D -->|"No"| C
  D -->|"Si"| E["Cargar datos locales o Supabase"]
  B -->|"Si"| E

  E --> F["Panel principal"]
  F --> F1["Metricas: volumen, reps, ejercicios"]
  F --> F2["Vista progreso semanal"]
  F --> F3["Entrenamiento del dia calendario"]
  F --> F4["Analisis inteligente"]
  F --> F5["Resumen de motivacion IA"]
  F --> F6["Analitica integrada"]

  F --> G["Menu hamburguesa"]
  G --> H["Entrenamiento"]
  G --> I["Registro de entrenamiento"]
  G --> J["Comparacion semanal"]
  G --> K["Historial ciclo de entrenamiento"]
  G --> L["Mi perfil"]
  G --> M["Cerrar sesion"]
  M --> C

  H --> H1{"Hay rutina activa?"}
  H1 -->|"No"| I
  H1 -->|"Si"| H2["Inicio entrenamiento"]
  H2 --> H3["Iniciar entrenamiento"]
  H3 --> H4["Formulario de motivacion"]
  H4 --> H5{"Completa u omite?"}
  H5 -->|"Completa"| H6["Guardar estado motivacional"]
  H5 -->|"Omite"| H7["Registrar omision"]
  H6 --> H8["Rutina guiada"]
  H7 --> H8
  H8 --> H9["Seleccionar ejercicio"]
  H9 --> H10["Registrar peso y reps por serie"]
  H10 --> H11["Calcular reps, kg, volumen y estado"]
  H11 --> H12{"Quedan ejercicios?"}
  H12 -->|"Si"| H9
  H12 -->|"No"| H13["Guardar entrenamiento"]
  H13 --> E

  I --> I1{"Hay ciclo activo con rutina?"}
  I1 -->|"No"| I2["Crear plan deportivo"]
  I1 -->|"Si"| I3["Ciclo activo"]
  I3 --> I4["Modificar ciclo actual"]
  I3 --> I5["Crear nuevo ciclo"]
  I5 --> I6{"Confirmar cierre?"}
  I6 -->|"No"| I3
  I6 -->|"Si"| I7["Snapshot a historial"]
  I7 --> I2
  I4 --> I2
  I2 --> I8["Seleccionar ciclo, objetivo, duracion y dias"]
  I8 --> I9["Configurar rutina por dia"]
  I9 --> I10["Nombre rutina y ejercicios"]
  I10 --> I11{"Faltan dias?"}
  I11 -->|"Si"| I9
  I11 -->|"No"| I12["Finalizar registro de rutina"]
  I12 --> F

  J --> J1["Seleccionar dia/rutina"]
  J1 --> J2{"Dia tiene rutina?"}
  J2 -->|"No"| J3["Dia no comparable"]
  J2 -->|"Si"| J4["Comparar mismo dia entre semanas"]
  J4 --> J5["Rutina registrada vs semanas"]
  J5 --> J6["Ejercicios comparados"]
  J6 --> J7["Comparar ejercicio por semana"]
  J7 --> J8["Grafico volumen semanal"]

  K --> K1["Ciclos finalizados"]
  K1 --> K2{"Hay snapshots?"}
  K2 -->|"No"| K3["Estado vacio"]
  K2 -->|"Si"| K4["Acordeon de ciclos"]
  K4 --> K5{"Usuario abre resumen ciclo?"}
  K5 -->|"Si"| K6["Mostrar metricas, mejoras, estancados, animo y sugerencias"]
  K5 -->|"No"| K4

  L --> L1["Perfil demo/local o cuenta conectada"]
```

