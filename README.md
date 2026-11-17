# Puerto Delta · Atribución de Jornales y Costeo por Recalada (Reto 1)

**Equipo 15 — Eleventh Hour** · Hackathon Arequipa 2026

MVP verificable para atribuir partes de jornal a cada recalada (`REC-2051`, `REC-2052`, `REC-2053`) o a servicios generales (`REC-SSGG`), conciliar el costo total de personal eventual (**destajo + jornal = USD 23.158,24** en 55 líneas operativas del 10 al 12 de junio de 2026) y auditar la validación de excepciones por el área solicitante sin perder el control monetario.

---

## 1. Arquitectura y Stack

- **Backend:** Monolito modular en **Django 5.2 LTS + Django REST Framework 3.16** (`backend/`), separado en cuatro módulos de dominio:
  - `reto/imports`: staging y validación transaccional de los 7 CSV oficiales, huella `SHA-256` por archivo y por lote, normalización de turno `24:00` a medianoche del día siguiente (Regla R1) y agregación previa de los 6 trabajadores por `(fecha, turno, cuadrilla)` en `PlannedFrontSummary` para impedir la multiplicación de partes al cruzar con la nombrada (Regla R2/R6).
  - `reto/attribution`: motor determinista de reglas `R1–R13` con evidencia estructurada por fila (observación normalizada, frente planificado, producción a destajo del turno y minutos de solape con ventanas de atraque).
  - `reto/costing`: libro monetario `CostLedgerLine` con `Decimal` y redondeo `ROUND_HALF_UP` a 2 decimales por línea antes de sumar (Regla R10), verificación independiente por referencia `archivo:fila` (Regla R11) y exportación derivada a **CSV y Excel (`.xlsx`)** con protección contra inyección de fórmulas.
  - `reto/reviews` + `reto/api`: API HTTP v1 de mismo origen (`/api/v1/`), sesiones Django con protección `CSRF`, control de permisos por rol (`consulta`, `operador`, `validador`) y registro transaccional de revisiones con bloqueo de fila (`select_for_update`), control de versión optimista (`expected_version`) e idempotencia por `operation_id` UUID (Regla R12).
- **Base de datos:** **PostgreSQL** (`psycopg 3` vía `DATABASE_URL`) como fuente de verdad, con soporte de contingencia inmediato en **SQLite** para ejecución local sin servidor externo.
- **Frontend + PWA:** **React + TypeScript + Vite** (`frontend/`), servido bajo el mismo origen que `/api/v1/`. Incluye `manifest.webmanifest`, íconos e instalación PWA con Service Worker que cachea el shell estático versionado y mantiene `/api/*` y `/exports/*` en `NetworkOnly` (`Cache-Control: no-store`).

---

## 2. Arranque Rápido Reproducido desde Cero

> **Política sobre los datos fuente oficiales:** Siguiendo las instrucciones de la organización, los archivos CSV/Excel originales **no se incluyen en el repositorio Git** ni en el caché del Service Worker. Se importan localmente mediante `--data-dir`.

### Requisitos
- Python `3.11+` y [`uv`](https://docs.astral.sh/uv/) (o `pip`)
- Node.js `20+` y `npm`

### Paso 1: Configurar e iniciar el Backend + Importar el lote local

```powershell
cd backend

# Instalar dependencias exactas desde uv.lock
uv sync

# Aplicar migraciones y crear cuentas de demostración
uv run python manage.py migrate
uv run python manage.py seed_demo_users

# Importar los 7 CSV desde la copia local fuera del repositorio
uv run python manage.py import_reto --data-dir "..\..\Investigacion_Reto_1\Material_oficial\datos_csv"
```

### Paso 2: Compilar el Frontend React + PWA y levantar el servidor

```powershell
cd ../frontend
npm install
npm run build

cd ../backend
uv run python manage.py runserver 127.0.0.1:8000
```

Abrir **`http://127.0.0.1:8000`** en el navegador.
*(Para desarrollo con recarga en caliente: ejecutar `npm run dev` en `frontend/`, que hace proxy de `/api` hacia `127.0.0.1:8000`).*

### Cuentas de Demostración Declaradas

| Usuario | Contraseña (por defecto en `.env.example`) | Rol | Permisos |
|---|---|---|---|
| `validador` | `delta-validador-2026` | `validador` | Tablero, fichas, exportes CSV/XLSX y **registro de revisiones/validaciones** (`POST /api/v1/parts/{id}/reviews`). |
| `operador` | `delta-operador-2026` | `operador` | Tablero, fichas, exportes e importación por CLI (`manage.py import_reto`). |
| `consulta` | `delta-consulta-2026` | `consulta` | Solo lectura y exportación (`POST /reviews` responde `403 Forbidden`). |

---

## 3. Reglas de Negocio (`R1–R13`), Supuestos y Resultados Verificados

### Jerarquía de decisión por fila de jornal (`partes_jornal.csv`)
1. **Un parte = un destino e importe íntegro (R3, R4, R5):** cada fila se paga por su columna `jornales × USD 81,31` redondeada a 2 decimales (`ROUND_HALF_UP`, R10). No se divide una fila por horas de atraque/desatraque. Cuando `jornales > personas` (ej. **fila 13**, `CU-03`, `11/06 A`, `2 personas / 4 jornales = USD 325,24`), se preserva el importe pagado y se emite la alerta `JORNALES_GT_PERSONAS`.
2. **Servicios Generales tipificados primero (R8):** `Barrido almacén` y `Apoyo en señalización` se confirman a **`REC-SSGG`** (`6` partes, `18` jornales, **`USD 1.463,58`**). `REC-SSGG` **nunca** se usa como comodín para tareas operativas sin nota.
3. **Evidencia de ejecución en observación prevalece sobre planificación (R7, R9):** si la observación identifica una única recalada con ventana activa (por nombre/alias como `ORION BAY`, `Orio bay`, `orion`, `N. Crest`, `north` o por muelle `M1`, `M-1`, `M2`, `M3`), el parte queda **`confirmado`**.
   - *Caso clave demostrado en vivo:* **`CU-01` el `11/06 Turno B` (filas CSV 16, 17 y 18)**: la cuadrilla fue planificada en `Muelle 2` y movió `570,202 t` a destajo para `REC-2052`. La fila 16 (`M2`, 4 jornales) va a `REC-2052`, pero la **fila 17 (`apoyo M3 bod 2`, 1 jornal)** se asigna a **`REC-2053`** con alerta `OBS_OVERRIDES_PLAN`.
4. **Política conservadora ante observaciones vacías o genéricas (R13, §8):** las 10 filas sin observación inequívoca no se confirman silenciosamente: quedan en estado **`sugerido`** (con candidato único `fuerte` cuando coinciden frente planificado, destajo y ventana, o `debil` cuando solo hay frente planificado sin destajo) para validación explícita del área solicitante.

### Cuadre Monetario del Período (10–12 de junio de 2026)

| Concepto | Líneas | Cantidad | Importe Confirmado + Validado | Escenario con Sugeridos (62/29/9 j.) |
|---|---:|---:|---:|---:|
| **`REC-2051` · MN ORION BAY** (Jornal + Destajo) | 10 j. (+6 sug.) / 9 dest. | 36 j. (+26 sug.) | USD 9.225,91 (`2.927,16` j. + `6.298,75` d.) | **USD 11.339,97** (`5.041,22` j. + `6.298,75` d.) |
| **`REC-2052` · MN NORTH CREST** (Jornal + Destajo) | 7 j. (+3 sug.) / 5 dest. | 20 j. (+9 sug.) | USD 4.953,90 (`1.626,20` j. + `3.327,70` d.) | **USD 5.685,69** (`2.357,99` j. + `3.327,70` d.) |
| **`REC-2053` · MN SANTA LUCIA** (Jornal + Destajo) | 2 j. (+1 sug.) / 6 dest. | 5 j. (+4 sug.) | USD 4.343,76 (`406,55` j. + `3.937,21` d.) | **USD 4.669,00** (`731,79` j. + `3.937,21` d.) |
| **`REC-SSGG` · Servicios Generales** | 6 partes | 18 jornales | **USD 1.463,58** | **USD 1.463,58** |
| **Pendientes de validación** (`sugerido` / `pendiente`) | 10 partes | 39 jornales | **USD 3.171,09** | USD 0,00 (al validarse) |
| **Total Período (Control R10/R11)** | **55 líneas** | **118 jornales** | **USD 23.158,24** | **USD 23.158,24** |

---

## 4. Ejecución de Pruebas Automatizadas

```powershell
# Suite backend (importación, reglas R1-R13, control Decimal, permisos 403, conflictos 409, CSRF y concurrencia)
cd backend
uv run python manage.py test tests -v 2

# Suite frontend (formateo monetario sin deriva float, CSRF, errores API y paridad de contrato)
cd ../frontend
npm test
```

---

## 5. Documentación Adicional del Proyecto

- [Contrato API v1](docs/contrato-api.md)
- [Modelo de Datos y Garantías](docs/modelo-datos.md)
- [Guía de Demo en Vivo](docs/demo.md)
- [Propuesta y Plan de Implementación en Muelle](docs/implementacion.md)
- [Evidencia de Verificación](docs/verificacion.md)
- [Guion de Pitch de 5 Minutos y Preguntas](docs/pitch.md)

---

## 6. Declaración de Uso de IA, Recursos y Aporte Propio

- **Herramientas de IA utilizadas:** Asistente agéntico de programación (Antigravity / modelos LLM de apoyo en generación de código boilerplate, estructuración de componentes React/CSS y redacción de pruebas).
- **Cómo se utilizó la IA:** Generación asistida del esqueleto Django/DRF, componentes de interfaz React/PWA, serializadores y casos de prueba unitarios a partir del contrato y de las reglas definidas por el equipo.
- **Aporte humano y decisiones propias del equipo:**
  1. Análisis integral de las 7 tablas oficiales y formulación de la regla de negocio en dos niveles (**atribución confirmada por evidencia de ejecución** vs **candidato sugerido por contexto**) para evitar tanto el uso indebido de `REC-SSGG` como la confirmación silenciosa de partes sin observación.
  2. Identificación y resolución del riesgo de multiplicación de costos al cruzar las 186 filas de `nombrada_diaria` y los contextos con doble concepto en `produccion_destajo` (`CU-03` en `10/06 C` y `CU-14` en `12/06 A`).
  3. Diseño del mecanismo de control monetario dual (`USD 23.158,24` en 55 referencias `archivo:fila`) desacoplado de la validación de destinos y del protocolo de revisión auditable con versión e idempotencia.
