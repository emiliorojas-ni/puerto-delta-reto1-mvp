# Evidencia de Verificación y Arranque · Reto 1 (Puerto Delta)

## 1. Corte de Arranque (Primeros 30 Minutos)

| Componente | Perfil verificado en el equipo de desarrollo | Estado |
|---|---|---|
| **Python + Gestor** | `Python 3.11.9` + `uv 0.13.7` (`backend/uv.lock` con versiones fijadas) | Verificado |
| **Framework Backend** | `Django 5.2.19 LTS` + `djangorestframework 3.16.1` + `psycopg 3.2.13` + `openpyxl 3.1.5` | Verificado |
| **Motor de Base de Datos** | Configuración dual por `DATABASE_URL` (`dj-database-url`). En este equipo no hay proceso `postgres`/`docker` activo en `127.0.0.1:5432`; se activó el perfil de contingencia **SQLite (`backend/db.sqlite3`)** manteniendo los modelos, restricciones (`UniqueConstraint`, `CheckConstraint`) y `select_for_update()` 100 % compatibles con PostgreSQL. *Nota de transparencia:* No se atribuyen a SQLite las garantías de bloqueo por fila de PostgreSQL; cuando se conecte `DATABASE_URL=postgresql://...` las mismas migraciones y pruebas corren sin cambios. | Verificado |
| **Node.js + Frontend** | `Node v26.13.0` + `npm 11.20.0`, `React + Vite + TypeScript` + `Vitest` (`frontend/package-lock.json`) | Verificado |
| **Higiene de Git y Datos** | Fuentes oficiales (`Investigacion_Reto_1/Material_oficial/datos_csv/`) fuera del repositorio `equipo-15-Eleventh-Hour`. `.gitignore` excluye `.env`, `*.sqlite3`, `datos_csv/`, `*.xlsx` oficiales y exportes locales. | Verificado |

---

## 2. Verificación Cuantitativa del Lote Oficial (`SHA-256: 2e15a93e0af358ae…`)

| Métrica / Invariante | Valor Esperado (Revisión Integral) | Valor Obtenido por el Motor | Estado |
|---|---:|---:|---|
| Filas origen importadas (`7` CSV) | `343` | `343` | Exacto |
| Recaladas (`recaladas.csv`) | `3` (`REC-2051`, `REC-2052`, `REC-2053`) | `3` | Exacto |
| Turnos (`turnos.csv`, `24:00` → `00:00 +1d`) | `3` (`A`, `B`, `C`) | `3` | Exacto |
| Cuadrillas / Integrantes (`cuadrillas.csv`) | `15` cuadrillas / `90` trabajadores | `15` / `90` | Exacto |
| Nombradas / Contextos agregados (`nombrada_diaria.csv`) | `186` filas / `31` contextos `(fecha, turno, cuadrilla)` | `186` / `31` | Exacto |
| Partes de jornal (`partes_jornal.csv`) | `35` filas / `118` jornales | `35` / `118` | Exacto |
| Líneas de destajo (`produccion_destajo.csv`) | `20` filas | `20` | Exacto |
| Referencias únicas en libro (`CostLedgerLine`) | `55` (`35` jornal + `20` destajo) | `55` | Exacto |
| **Jornal total del período** | **USD 9.594,58** | **USD 9.594,58** | Exacto |
| **Servicios Generales (`REC-SSGG`)** | **6 partes / 18 jornales / USD 1.463,58** | **6 / 18 / USD 1.463,58** | Exacto |
| **Destajo `REC-2051` (MN Orion Bay)** | **USD 6.298,75** | **USD 6.298,75** | Exacto |
| **Destajo `REC-2052` (MN North Crest)** | **USD 3.327,70** | **USD 3.327,70** | Exacto |
| **Destajo `REC-2053` (MN Santa Lucía)** | **USD 3.937,21** | **USD 3.937,21** | Exacto |
| **Destajo total del período** | **USD 13.563,66** | **USD 13.563,66** | Exacto |
| **Costo Total del Período (Control R10/R11)** | **USD 23.158,24** | **USD 23.158,24** | Exacto |

### Distribución de Jornales por Estado Inicial (Política Conservadora vs Escenario con Sugeridos)

| Destino | Confirmados (jornales / USD) | Sugeridos por contexto (jornales / USD) | Escenario Confirmado + Sugerido (jornales / Jornal + Destajo USD) |
|---|---:|---:|---:|
| **`REC-2051`** | `36` (`USD 2.927,16`) | `26` (`USD 2.114,06`) | `62` jornales → **`USD 11.339,97`** |
| **`REC-2052`** | `20` (`USD 1.626,20`) | `9` (`USD 731,79`) | `29` jornales → **`USD 5.685,69`** |
| **`REC-2053`** | `5` (`USD 406,55`) | `4` (`USD 325,24`) | `9` jornales → **`USD 4.669,00`** |
| **`REC-SSGG`** | `18` (`USD 1.463,58`) | `0` (`USD 0,00`) | `18` jornales → **`USD 1.463,58`** |
| **Total** | **`79` (`USD 6.423,49`)** | **`39` (`USD 3.171,09`)** | **`118` jornales → `USD 23.158,24`** |

---

## 3. Suite Automatizada de Pruebas Backend (`17` pruebas)

Ejecutado con `uv run python manage.py test tests -v 2`:

1. **`tests.test_import.ImportAndProvenanceTests`**
   - `test_official_import_counts_and_shift_2400_normalization`: verifica las 7 tablas, 343 filas, normalización de `24:00` en turno C y preservación de la fila 13 (`2 personas / 4 jornales = USD 325,24` con alerta `JORNALES_GT_PERSONAS`).
   - `test_reimport_identical_batch_is_idempotent`: dos importaciones idénticas reutilizan el mismo lote sin duplicar filas.
   - `test_broken_header_rejected_with_file_and_row_and_rolls_back`: encabezado roto informa archivo y línea (`partes_jornal.csv:1`) y hace rollback completo.
   - `test_missing_tariff_rolls_back_atomically_without_partial_batch`: tarifa faltante aborta toda la transacción sin dejar lotes parciales.
2. **`tests.test_attribution.AttributionRulesTests`**
   - `test_ssgg_rows_2_9_22_23_31_36_confirmed_to_rec_ssgg`: verifica los 6 partes de `REC-SSGG`, incluido `partes_jornal.csv:9` (`vías internas` con frente `Almacén`).
   - `test_cu01_rows_16_17_18_m3_override_and_conservative_pending`: verifica `CU-01` el `11/06 B` (fila 16 → `REC-2052`, fila 17 `apoyo M3 bod 2` → `REC-2053` prevaleciendo sobre plan y destajo `M2`, fila 18 sin nota → `sugerido REC-2052`).
   - `test_row_13_25_34_35_specific_cases`: verifica `Orio bay` (fila 13), `ORION` sin frente (fila 25), espera de grúa en M1 sin prorrateo (fila 34) y `final de nave` (fila 35).
   - `test_review_changes_destination_without_changing_global_total`: confirma que validar un parte mueve el subtotal entre Pendiente y la recalada sin alterar `USD 23.158,24`.
3. **`tests.test_costing.CostingAndControlTests`**
   - `test_exact_monetary_figures_and_55_unique_references`: valida todas las cifras del período y de cada recalada con `Decimal` y `ROUND_HALF_UP`.
   - `test_detects_injected_omission_and_duplication_and_external_benchmark_diff`: inyecta omisión (`partes_jornal.csv:13`), duplicación (`produccion_destajo.csv:2`) y diferencia contra cifra global externa sin referencia por fila.
   - `test_csv_formula_escaping_and_export_parity`: comprueba escape de fórmulas (`=`, `+`, `-`, `@`) y ausencia de observaciones libres en el exporte derivado.
4. **`tests.test_api.ApiSecurityAndAuditTests` + `ConcurrentReviewTransactionTests`**
   - `test_unauthenticated_requests_rejected_and_cache_control_no_store`: `403` sin sesión + `Cache-Control: no-store`.
   - `test_csrf_enforced_on_post_review`: `403` cuando falta `X-CSRFToken`.
   - `test_role_consulta_forbidden_from_creating_review_403`: `403` para rol `consulta`.
   - `test_idempotent_retry_200_operation_reused_409_and_stale_version_409`: `201` inicial, `200` idempotente al repetir `operation_id`, `409 operation_reused` al cambiar payload con mismo UUID y `409 version_conflict` con versión vencida.
   - `test_summary_calls_parts_and_exports_share_batch_and_results_version`: coherencia de lote y versión entre tablero, detalle y exportes CSV/XLSX.
   - `test_concurrent_reviews_on_same_version_allow_only_one_winner`: prueba multi-hilo con `TransactionTestCase` donde solo una revisión concurrente gana (`version=2`) y la otra recibe conflicto.
