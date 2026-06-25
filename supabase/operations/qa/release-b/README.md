# Release B - Fase D1 - Normalizacion exclusiva de QA

Estos scripts preparan la normalizacion controlada de Supabase QA para devolver `training_daily_readiness` al contrato legacy equivalente a Produccion antes de disenar Release B.

Proyecto QA autorizado:

```text
fjjebhaqtrdbpxzxztmh
```

Proyecto Production, solo como referencia y nunca como destino de estos scripts:

```text
lzycxltqbrtsnwfdotqw
```

## Orden operativo

1. Abrir Supabase QA y confirmar visualmente el project ref `fjjebhaqtrdbpxzxztmh`.
2. Ejecutar `01_precheck_readonly.sql`.
3. Continuar solo si el veredicto es `READY_TO_NORMALIZE_QA`.
4. Ejecutar `02_backup_readonly.sql`.
5. Exportar el backup completo y el mapa minimo fuera de Git y fuera del chat.
6. Verificar que el backup completo contiene exactamente 3 filas y que el mapa minimo contiene exactamente 1 fila.
7. Copiar `05_rollback_template.sql` fuera del repositorio.
8. Completar el mapa `id -> cycle_day_id` en esa copia local.
9. Revisar que el rollback local este listo, sin guardarlo en Git ni compartirlo.
10. Recien entonces ejecutar `03_normalize_qa_readiness.sql` solo en QA.
11. Ejecutar `04_postcheck_readonly.sql`.
12. Detenerse salvo que el veredicto sea `QA_NORMALIZATION_VERIFIED`.

## Reglas de seguridad

- No ejecutar ninguno de estos archivos en Production.
- No usar `supabase db push`.
- No copiar estos scripts a `supabase/migrations`.
- No automatizar su ejecucion.
- No commitear backups.
- No commitear el rollback completado.
- No compartir UUID ni payload.
- No avanzar a Release B D2 sin aprobacion explicita.
- No aplicar todavia Release B.
- No crear `training_workout_readiness` en esta fase.
- No modificar frontend.
- No ejecutar estos scripts desde CLI automatizada.
- Detenerse ante cualquier error o veredicto negativo.

## Rollback

`05_rollback_template.sql` solo debe usarse si Arquitectura valida una falla posterior a la normalizacion.

Antes de usarlo:

1. Abrir el mapa minimo exportado por `02_backup_readonly.sql`.
2. Completar localmente el bloque `marked_cycle_day_map`.
3. No guardar el archivo completado en Git.
4. Ejecutarlo solo en QA.
5. Si se detecta cualquier duda antes del final, ejecutar `rollback` en la misma sesion.

El rollback no contiene valores reales y no debe completarse dentro del repositorio.
