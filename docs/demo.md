# Guía de Demo en Vivo · Reto 1 (Puerto Delta)

## 1. Preparación desde estado limpio (2 minutos antes de presentar)

```powershell
# 1. Backend: migrar, crear usuarios de demo e importar el lote oficial fuera del repo
cd equipo-15-Eleventh-Hour/backend
uv run python manage.py migrate
uv run python manage.py seed_demo_users
uv run python manage.py import_reto --data-dir "..\..\Investigacion_Reto_1\Material_oficial\datos_csv"

# 2. Compilar el frontend React + PWA para servir todo desde el mismo origen (127.0.0.1:8000)
cd ../frontend
npm run build

# 3. Levantar el servidor en http://127.0.0.1:8000
cd ../backend
uv run python manage.py runserver 127.0.0.1:8000
```

### Cuentas de demostración declaradas

| Usuario | Contraseña por defecto | Rol | Capacidades |
|---|---|---|---|
| `validador` | `delta-validador-2026` | `validador` | Lectura completa, exportación CSV/XLSX y registro auditable de revisiones. |
| `operador` | `delta-operador-2026` | `operador` | Lectura completa y exportación (importa lotes por CLI). `POST /reviews` devuelve `403`. |
| `consulta` | `delta-consulta-2026` | `consulta` | Solo lectura y exportación. `POST /reviews` devuelve `403`. |

---

## 2. Recorrido en Vivo (Paso a Paso)

### Paso A — Tablero de Control Monetario (`/`)
1. Ingresar con `validador`.
2. Mostrar los **5 indicadores clave del período (10–12 de junio de 2026)**:
   - **Total Período:** `USD 23.158,24` (`55` líneas: `35` partes de jornal + `20` líneas de destajo).
   - **Jornal Total:** `USD 9.594,58` (`118` jornales a `USD 81,31`).
   - **Destajo Total:** `USD 13.563,66`.
   - **Servicios Generales (`REC-SSGG`):** `USD 1.463,58` (`18` jornales, `6` partes).
   - **Pendiente de Validar:** `USD 3.171,09` (`39` jornales en `10` partes sin observación concluyente).
3. Mostrar el bloque **Control de Integridad Monetaria**:
   - Esperado (`USD 23.158,24`) = Libro (`USD 23.158,24`) = Recalculado desde origen (`USD 23.158,24`), diferencia `USD 0,00`, estado `OK`, lote `#1` con huella SHA-256 visible.
4. Señalar en la tabla por recalada la diferencia entre:
   - **Confirmado + Validado** (lo que cuenta con evidencia directa o firma de validación), y
   - **Escenario con sugeridos (no confirmado)**, que reproduce exactamente la distribución de referencia `62 / 29 / 9` jornales (`USD 11.339,97` para `REC-2051`, `USD 5.685,69` para `REC-2052`, `USD 4.669,00` para `REC-2053`).

### Paso B — Caso de Referencia `REC-2051` (MN ORION BAY)
1. Hacer clic en la tarjeta o fila **`REC-2051`**.
2. Mostrar el desglose:
   - **Destajo directo:** `9` líneas con `3` conceptos tarifarios distintos (*Tonelaje metales* USD 1,28, *Tonelaje maquinaria* USD 1,65 y *Bolas de acero* USD 0,94) que suman **`USD 6.298,75`**.
   - **Partes confirmados (`36` jornales, `USD 2.927,16`):** incluye la fila **`partes_jornal.csv:13`** (`CU-03`, `11/06 A`, nota `Orio bay`) con alerta visible `JORNALES_GT_PERSONAS` (`2 personas / 4 jornales = USD 325,24` preservados por Regla R5) y la fila **`partes_jornal.csv:34`** (`CU-12`, `12/06 B`, `En espera`, `esperando grua M1`, `2 jornales = USD 162,62` íntegros por Reglas R3 y R9 aunque la nave desatracó a las `15:10`).
   - **Partes sugeridos (`26` jornales, `USD 2.114,06`):** separados visualmente para no confundir contexto con evidencia de ejecución.

### Paso C — Contradicción Real: `CU-01` en `11/06 Turno B` (Filas 16, 17 y 18)
1. Ir a **Partes** y filtrar por cuadrilla o inspeccionar las filas `16`, `17` y `18`:
   - **Fila 16 (`partes_jornal.csv:16`):** `Atrinque muro`, `4 jornales`, nota `M2` → **Confirmado `REC-2052`** (`USD 325,24`).
   - **Fila 17 (`partes_jornal.csv:17`):** `Barrido de bodega`, `1 jornal`, nota **`apoyo M3 bod 2`**. Abrir el detalle del parte:
     - *Frente planificado (Nombrada):* `Muelle 2` (`nombrada_diaria.csv:74..79` → `REC-2052`).
     - *Destajo de la cuadrilla en el turno:* `570,202 t` en `REC-2052` (`produccion_destajo.csv:11`).
     - *Observación ejecutada:* `apoyo M3 bod 2` → **Confirmado `REC-2053`** (`USD 81,31`) por **Regla R7** con alerta explícita `OBS_OVERRIDES_PLAN`.
   - **Fila 18 (`partes_jornal.csv:18`):** `Desatrinque zona`, `1 jornal`, **observación vacía** → estado **`sugerido` (`REC-2052`, fuerza `fuerte`)**.

### Paso D — Revisión Auditable en Vivo sin Alterar el Control Monetario
1. En el detalle de la **Fila 18 (`partes_jornal.csv:18`)**, completar el formulario de revisión:
   - Destino: `REC-2052`
   - Motivo: `Confirmado con supervisión de Muelle 2 al cierre del turno B`
   - Referencia: ` Parte físico #18 verificado`
2. Enviar la revisión:
   - El estado pasa a **`validado`**, la versión del parte sube de `v1` a `v2`, queda registrado el usuario `validador` y la marca de tiempo.
   - Volver al **Tablero**: el subtotal confirmado de `REC-2052` sube en `USD 81,31`, el saldo **Pendiente** baja en `USD 81,31`, la versión de resultados del lote sube a `v2`, y el **Total del Período permanece intacto en `USD 23.158,24`**.

### Paso E — Exportación y Estado Sin Conexión (PWA)
1. Hacer clic en **Exportar CSV** y **Exportar Excel (`.xlsx`)**: mostrar que descargan las `55` líneas con la versión de resultados actualizada (`v2`), sin exponer observaciones libres ni padrón de trabajadores.
2. En DevTools → Network → activar **Offline**:
   - Aparece el banner **Modo sin conexión**, se etiquetan los datos como última conexión y el botón de validar se bloquea indicando que **la confirmación requiere servidor**.
