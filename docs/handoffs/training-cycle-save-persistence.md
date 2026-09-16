# Handoff — persistencia al guardar entrenamiento

## Veredicto

**FAIL FUNCIONAL / REQUIERE DIAGNÓSTICO.**

El commit técnico del Drop set no demuestra que el flujo completo guarde el entrenamiento. En QA manual, la interfaz aparenta guardar, vuelve a mostrar el botón para crear entrenamiento y no aparece ningún registro.

## Estado preservado

- Worktree: `/Users/fabiannahuelhual/Developer/organizatech-cycle-redesign-integration-01`
- Branch: `codex/cycle-redesign-integration-01`
- HEAD remoto y local: `763b98b8e1450c59ced991174ad74aec2591e1e4`
- Estado Git verificado: limpio y sincronizado.
- Commit: `fix(training): recalculate drop loads and preserve typed values`.
- El orden Reps → Kg, el recálculo de cargas y la preservación de valores digitados se consideran implementados técnicamente; no reescribirlos sin evidencia de relación con el fallo.

## Síntoma reproducido por el dueño

1. Completa la creación del entrenamiento.
2. La UI simula o comunica guardado.
3. Al finalizar no muestra el entrenamiento creado.
4. Sigue disponible el botón `Crear entrenamiento`.
5. No hay un registro visible que confirme persistencia.

No afirmar PASS ni persistencia basándose sólo en un estado visual de éxito.

## Alcance del próximo diagnóstico

Seguir una única operación de guardado por estas capas:

1. validación y submit del builder;
2. gateway/RPC invocado y payload allowlisted;
3. respuesta, identificador y error real del servidor;
4. transacción, ownership/RLS y filas creadas;
5. invalidación o recarga del estado local;
6. consulta posterior y selección del renderer que decide entre entrenamiento y `Crear entrenamiento`.

No crear migraciones ni modificar RLS hasta demostrar que el contrato actual es insuficiente.

## Criterios de aceptación

- Un guardado exitoso devuelve una confirmación inequívoca y un identificador válido.
- El entrenamiento aparece inmediatamente después del guardado y continúa visible tras recargar o volver a ingresar.
- Un fallo remoto no se presenta como éxito y permite reintento seguro sin duplicar datos.
- Se conservan las correcciones de Drop set del commit `763b98b`.
- Pruebas focalizadas y regresión de la feature PASS.
- Auditoría GPT-5.6 Sol medio, read-only, del diff final PASS.
- QA manual del dueño PASS antes de cualquier avance a producción.

## Exclusiones

- Panel Coach y vinculación.
- Refactors generales del ciclo.
- Navegación por Preview realizada por IA.
- Supabase remoto, PROD, commit o push sin el gate correspondiente.
