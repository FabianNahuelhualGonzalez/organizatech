-- Release B - Fase D1 - QA backup read-only.
-- Ejecutar solo en Supabase QA: fjjebhaqtrdbpxzxztmh.
--
-- Este archivo no escribe datos.
-- Exportar resultados localmente, fuera del repositorio y fuera del chat.
-- Proteger/cifrar el archivo exportado.
-- Verificar que el backup completo contiene exactamente 3 filas.

begin transaction read only;

select current_setting('transaction_read_only') as transaction_read_only;

-- Backup completo protegido.
-- Contiene datos sensibles operativos: no pegar en chat y no guardar en Git.
select
  id,
  user_id,
  local_date,
  cycle_day_id,
  payload,
  created_at,
  updated_at
from public.training_daily_readiness
order by local_date, created_at, id;

-- Mapa minimo de rollback.
-- Exportar junto al backup protegido. No guardar en Git.
select
  id,
  cycle_day_id
from public.training_daily_readiness
where cycle_day_id is not null
order by local_date, created_at, id;

rollback;
