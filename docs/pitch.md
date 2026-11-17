# Guion de Pitch (5 Minutos) + Preguntas del Jurado · Reto 1

## Guion Cronometrado (5:00)

### `0:00 – 0:40` · El Problema y la Evidencia en Puerto Delta
- «En Puerto Delta sabemos exactamente cuánto dinero salió en la semana: **USD 23.158,24** en 55 líneas operativas. Lo que la gerencia no podía responder con certeza es **qué nave absorbió cada jornal** cuando hasta tres buques operan en simultáneo.»
- «La causa está en el origen: la nombrada planifica a 6 personas juntas, el destajo mide toneladas por buque, pero el parte de jornal se firma en papel sin `id_recalada`, con notas libres como `Orio bay`, frases genéricas como `final de nave` o 12 filas en blanco.»

### `0:40 – 1:50` · Contradicción Real en Vivo: `CU-01` en `11/06 Turno B` (M2 vs M3)
- *(En pantalla: Ficha de partes de `CU-01` el 11 de junio, Turno B — filas CSV 16, 17 y 18).*
- «Miren a la cuadrilla `CU-01` el 11 de junio en el turno B. La nombrada convocó a sus 6 integrantes al **Muelle 2** (`MN North Crest`, `REC-2052`), y allí movieron 570 toneladas a destajo. Un cruce ingenuo por cuadrilla le cargaría todo el turno a `REC-2052`.»
- «Pero nuestro motor evalúa fila por fila: la fila 16 dice `M2` y confirma 4 jornales a `REC-2052`. En la **fila 17**, el supervisor anotó `apoyo M3 bod 2`: dos trabajadores cruzaron al Muelle 3 para barrer la bodega 2 de `MN Santa Lucía` (`REC-2053`). Aplicando la **Regla R7**, el sistema hace prevalecer la evidencia ejecutada sobre el plan, imputa `USD 81,31` a `REC-2053` y deja trazada la alerta `OBS_OVERRIDES_PLAN`.»

### `1:50 – 2:50` · Excepción Pendiente y Revisión Auditable
- *(En pantalla: Fila 18 de `CU-01` y formulario de revisión).*
- «¿Y qué pasa con la **fila 18** de esa misma cuadrilla? Es 1 jornal de desatrinque con la **observación vacía**. Como `CU-01` ya trabajó en dos muelles ese turno, no adivinamos ni usamos `REC-SSGG` como bolsa de descarte: el sistema la deja en estado **`sugerido`** hacia `REC-2052` mostrando qué evidencia falta.»
- *(Ejecutar revisión en vivo como `validador`).*
- «Cuando el validador del área solicitante confirma el destino con motivo y referencia, la fila pasa a **`validado` v2**, registra autor y hora en una transacción bloqueada con UUID idempotente, actualiza el subtotal de `REC-2052` y mantiene intacto el control global de **USD 23.158,24**.»

### `2:50 – 3:50` · Separación de `REC-SSGG` y Caso de Referencia `REC-2051`
- *(En pantalla: Ficha `REC-2051` y tarjeta `REC-SSGG`).*
- «Los **servicios generales (`REC-SSGG`)** se tipifican por regla explícita (Regla R8): los 6 partes de barrido de almacén y señalización en vías internas suman exactamente **18 jornales y USD 1.463,58**, incluyendo cuando la nota dice `vías internas` aunque la nombrada decía `Almacén`.»
- «En nuestro caso de referencia **`REC-2051` (`MN Orion Bay`)**, descendemos desde el tablero hasta cada línea: **USD 6.298,75** en 9 líneas de destajo con tres tarifas distintas, **36 jornales confirmados (USD 2.927,16)** —incluyendo la fila 13 con alerta `2 personas / 4 jornales` preservada en `USD 325,24` por Regla R5 y la espera de grúa en M1 por Regla R9— más **26 jornales sugeridos (USD 2.114,06)** que al validarse completan los 62 jornales y **USD 11.339,97** del escenario comparado.»

### `3:50 – 4:30` · Control Monetario y Exportación Segura
- *(En pantalla: Bloque de Control y descarga de CSV/XLSX).*
- «Cada vez que se consulta el tablero o se descarga el CSV/Excel, el servidor verifica las **55 referencias únicas (`archivo:fila`)** con `Decimal` y redondeo `ROUND_HALF_UP` por línea (Regla R10), y sanea cualquier celda de texto contra inyección de fórmulas.»

### `4:30 – 5:00` · Arquitectura, PWA y Adopción en Muelle
- «Construimos un monolito modular Django 5.2 + DRF y una PWA en React bajo el mismo origen. El shell carga sin conexión, pero las APIs y exportes nunca se cachean y toda confirmación exige servidor. Esto permite arrancar mañana mismo conciliando el 29 % de casos dudosos en oficina y escalar en semanas a captura asistida en tablet al pie de bodega.»

---

## Respuestas Preparadas para los 2 Minutos de Preguntas

1. **¿Cómo evitan el doble conteo al cruzar con la nombrada y el destajo?**
   - La nombrada trae 186 filas (6 trabajadores por cuadrilla) y hay contextos como `(2026-06-10, C, CU-03)` y `(2026-06-12, A, CU-14)` con **dos conceptos de destajo distintos** en el mismo turno. Un `JOIN` SQL directo multiplicaría los partes de jornal. Nosotros agregamos la nombrada previamente en `PlannedFrontSummary` (31 contextos únicos) y enlazamos cada `CostLedgerLine` con restricción `OneToOne` y `CheckConstraint` a exactamente un `WagePart` (35) o un `PieceworkProduction` (20) = 55 líneas exactas.
2. **¿Cómo garantizan concurrencia e idempotencia al revisar un parte?**
   - `submit_part_review` abre `transaction.atomic()`, bloquea la fila con `select_for_update()`, verifica `expected_version` y el `operation_id` UUID junto al SHA-256 canónico del payload. Si llega el mismo UUID con igual contenido devuelve `200 OK (replayed=true)`; si cambia el contenido o la versión quedó obsoleta devuelve `409 Conflict`. Probado con `TransactionTestCase` y hilos concurrentes.
3. **¿Por qué el supervisor del CSV no aparece como validador?**
   - Por **Regla R12**: el campo `supervisor` (`SUP-01`..`SUP-04`) es quien firmó el parte operativo de origen. La validación corresponde al área solicitante. El backend toma el actor exclusivamente de la sesión autenticada con rol `validador`, nunca del CSV ni del cuerpo del request.
4. **¿Qué pasa si la tablet pierde conexión en el muelle?**
   - El Service Worker sirve el shell estático versionado, pero aplica `NetworkOnly` a `/api/*` y `/exports/*` y el backend envía `Cache-Control: no-store`. Al perder red, la interfaz muestra una alerta clara, etiqueta los datos en pantalla como no confirmados y bloquea el envío de validaciones hasta recuperar conexión.
5. **¿Qué hicieron con la fila 13 (`CU-03`, 2 personas y 4 jornales)?**
   - Siguiendo la **Regla R5**, pagamos la columna `jornales` (`4 × 81,31 = USD 325,24`), lo que mantiene el control del período en `USD 23.158,24`, y adjuntamos automáticamente la alerta estructurada `JORNALES_GT_PERSONAS` visible tanto en la UI como en el exporte para aclaración con el comité.
