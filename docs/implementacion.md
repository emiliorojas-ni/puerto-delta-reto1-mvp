# Propuesta y Plan de Implementación en Muelle · Puerto Delta

## 1. Diagnóstico Operativo

En Puerto Delta, el desfase entre lo planificado (`nombrada_diaria`), el manipuleo medido por tonelaje (`produccion_destajo`) y las labores accesorias pagadas por jornal (`partes_jornal`) ocurre porque **el parte en papel se firma al final del turno sin un vínculo estructurado a la recalada (`id_recalada`) ni validación del área solicitante**. Cuando dos o tres naves coinciden en muelle, una misma cuadrilla puede dividir integrantes entre muelles o apoyar otra bodega por una hora, dejando notas libres abreviadas o en blanco.

## 2. Arquitectura Implementada en el MVP

- **Monolito modular Django 5.2 LTS + DRF de mismo origen:** separa cuatro dominios con contratos explícitos:
  1. `reto.imports`: staging, validación de encabezados/tipos/reglas R1–R2, huella SHA-256 por archivo y por lote, agregación previa de las 6 filas de nombrada por `(fecha, turno, cuadrilla)` en `PlannedFrontSummary`.
  2. `reto.attribution`: motor determinista de reglas R1–R13 que evalúa cada fila de jornal sin dividirla por horas y produce evidencia estructurada (observación normalizada, frente planificado, destajo del contexto, minutos de solape por ventana de atraque) y alertas.
  3. `reto.costing`: libro monetario `CostLedgerLine` con `Decimal` y redondeo `ROUND_HALF_UP` por línea (Regla R10), recálculo independiente por clave de referencia (`archivo:fila`) y exportador derivado CSV/XLSX con protección contra inyección de fórmulas.
  4. `reto.reviews` + `reto.api`: registro transaccional de revisiones con bloqueo de fila (`select_for_update`), control optimista de versión (`expected_version`), idempotencia por `operation_id` UUID + hash de contenido, autenticación de sesión + CSRF y control de acceso por rol (`consulta`, `operador`, `validador`).
- **Interfaz React + TypeScript + PWA:** instala el shell estático versionado para carga rápida en muelle, mantiene `/api/*` y `/exports/*` en `NetworkOnly` con `Cache-Control: no-store`, detecta pérdida de conectividad en tiempo real y evita presentar datos cacheados como confirmados.

## 3. Hoja de Ruta de Despliegue en Muelle (Piloto por Etapas)

| Fase | Horizonte | Alcance Operativo y Técnico | Métrica de Éxito |
|---|---|---|---|
| **Fase 1 · Conciliación y Excepciones en Oficina de Muelle** | Semanas 1–2 | Despliegue del MVP actual sobre PostgreSQL institucional. Importación al cierre de cada turno (08:00, 16:00, 00:00). El área solicitante resuelve únicamente las filas en estado `sugerido` o `pendiente` (10 de 35 en el lote histórico, reducción del 71 % de revisión manual). | 100 % de partes conciliados en < 2 h tras cierre de turno; diferencia monetaria `USD 0,00`. |
| **Fase 2 · Captura Asistida en Tablet/Móvil (PWA en Campo)** | Semanas 3–5 | El supervisor selecciona la recalada activa desde un selector acotado a las naves con ventana abierta en su turno o marca `REC-SSGG`. Si desvía personal a otro muelle (caso `CU-01` en M3), la app exige elegir la nave destino antes de cerrar el parte. Cola local de borradores en IndexedDB con `operation_id` UUID para zonas de sombra Wi-Fi/LTE en bodega. | < 5 % de partes sin destino en origen; 0 notas ambiguas por errores de tipeo (`Orio bay`). |
| **Fase 3 · Gobernanza e Integración ERP/TOS** | Semanas 6–8 | Autenticación corporativa (SSO) mapeada a jefaturas de muelle y almacén, cierre contable por recalada al zarpe y publicación del libro validado hacia el sistema de facturación y costos por cliente/carga. | Cierre de costos por recalada dentro de las 24 h posteriores al desatraque. |

## 4. Gestión del Cambio en Operación Portuaria

- **Baja fricción digital:** formularios de un solo toque con las recaladas activas del turno precargadas desde la programación marítima, evitando escritura libre salvo para detallar causas de espera (`En espera` → grúa, lluvia, bodega).
- **Supervisión multi-cuadrilla:** vista filtrada por turno y muelle para que un supervisor con 3 cuadrillas simultáneas verifique en menos de 60 segundos qué tareas quedaron confirmadas y cuáles requieren firma del área solicitante.
- **Trazabilidad sin alterar el pago:** la validación de destino está desacoplada de la cantidad de jornales pagados, garantizando que las aclaraciones de imputación por nave nunca bloqueen ni distorsionen el control monetario del período.
