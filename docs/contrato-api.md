# Contrato API v1 · Reto 1 (Puerto Delta)

Versión del contrato: **v1 congelada para el MVP**. Base: `/api/v1`, mismo origen que la interfaz
(en desarrollo Vite hace proxy de `/api` a `http://127.0.0.1:8000`).

> Estado del insumo de Figma y del modelo relacional de las compañeras: **pendiente de recibir**.
> Este contrato se acordará con ellas; los cambios se versionan aquí (v1.1, …) sin romper campos.

## Convenciones

- **Dinero y cantidades como texto decimal** (`"325.24"`, `"1525.629"`, `"4"`). Nunca float.
- Fechas `YYYY-MM-DD`, fecha-hora ISO local sin zona `YYYY-MM-DDTHH:MM` (hora de la terminal).
- Autenticación por **sesión Django** (cookie `sessionid`). Toda escritura requiere cabecera
  `X-CSRFToken` con el valor de la cookie `csrftoken` (la entrega `GET /auth/session`).
- Respuestas sensibles con `Cache-Control: no-store`. El service worker no las cachea.
- Errores: `{"detail": "texto", "code": "codigo"}` con 400 (validación), 401/403 (sin sesión /
  rol insuficiente o CSRF), 404, 409 (`version_conflict` | `operation_reused`).
- Destinos válidos: `REC-2051`, `REC-2052`, `REC-2053` (recaladas del lote) y `REC-SSGG`.

### Estados de un parte (`status`)

| status | Significado | ¿Suma al subtotal de la recalada? |
|---|---|---|
| `confirmado` | Regla automática con evidencia suficiente (SSGG tipificado, nota inequívoca). | Sí |
| `validado` | Resolución humana registrada por un validador. | Sí |
| `sugerido` | Pendiente con candidato único sugerido por contexto (`strength`: `fuerte`/`debil`). | No, va a «Pendiente» |
| `pendiente` | Sin candidato único o evidencia contradictoria. | No, va a «Pendiente» |

El importe de `sugerido` y `pendiente` **siempre** se cuenta en el control global.

### Roles (`roles`)

`consulta` (lee), `operador` (lee + importa por CLI), `validador` (lee + registra revisiones).

## Autenticación

- `GET /auth/session` → `{"authenticated": bool, "user": {"username": "validador", "roles": ["validador"]} | null}`
  y fija cookie `csrftoken`.
- `POST /auth/login` `{"username","password"}` → igual que session. 400 si credenciales inválidas.
- `POST /auth/logout` → `{"authenticated": false, "user": null}`.

## Lecturas (requieren sesión)

### `GET /summary`

```json
{
  "batch": {"id": 1, "sha256": "ab12…", "imported_at": "2026-11-17T10:02", "results_version": 4,
             "source_rows": 343},
  "rate_jornal_usd": "81.31",
  "calls": [{
    "id": "REC-2051", "nave": "MN ORION BAY", "cliente": "Cliente Andes Metal",
    "tipo_carga": "Productos de acero (…)", "muelle": "Muelle 1",
    "atraque": "2026-06-10T07:30", "desatraque": "2026-06-12T15:10",
    "jornales": "36", "jornal_usd": "2927.16", "destajo_usd": "6298.75", "total_usd": "9225.91",
    "suggested_jornales": "26", "suggested_usd": "2114.06",
    "parts": 10, "piecework_lines": 9
  }],
  "ssgg": {"jornales": "18", "jornal_usd": "1463.58", "parts": 6},
  "pending": {"jornales": "39", "jornal_usd": "3171.09", "parts": 10,
               "by_status": {"sugerido": 9, "pendiente": 1}},
  "totals": {"jornal_usd": "9594.58", "destajo_usd": "13563.66", "total_usd": "23158.24",
              "lines": 55, "jornal_lines": 35, "destajo_lines": 20, "jornales": "118"},
  "control": {"expected_usd": "23158.24", "ledger_usd": "23158.24", "recomputed_usd": "23158.24",
               "difference_usd": "0.00", "ok": true, "discrepancies": []},
  "status_counts": {"confirmado": 25, "validado": 0, "sugerido": 9, "pendiente": 1}
}
```

`discrepancies[]`: `{"ref": "partes_jornal.csv:13", "kind": "missing|duplicated|amount", "ledger_usd": "…", "recomputed_usd": "…"}`.

### `GET /calls/{id}` (id = `REC-2051` … o `REC-SSGG`)

```json
{
  "call": { …mismo objeto que en summary… },
  "parts": [ PartSummary ],            // confirmados + validados con este destino
  "suggested_parts": [ PartSummary ],  // sugeridos con este candidato (no suman)
  "piecework": [ Piecework ],
  "totals": {"jornal_usd": "…", "destajo_usd": "…", "total_usd": "…"}
}
```

### `GET /parts?status=&call=`

`status` ∈ estados o `pendientes` (= sugerido+pendiente). `call` filtra por destino o candidato.
Devuelve `{"results": [PartSummary], "count": n}`.

`PartSummary`:

```json
{
  "id": 12, "ref": "partes_jornal.csv:13", "row_number": 13,
  "fecha": "2026-06-11", "turno": "A", "cuadrilla": "CU-03", "tarea": "Desatrinque zona",
  "personas": 2, "jornales": "4", "supervisor": "SUP-01", "observacion": "Orio bay",
  "status": "confirmado", "destination": "REC-2051", "suggested": null, "strength": null,
  "rule": "R7_NOTA_NAVE", "reason": "La observación nombra la nave (alias «orio bay»)…",
  "alerts": [{"code": "JORNALES_GT_PERSONAS", "message": "4 jornales para 2 personas…"}],
  "amount_usd": "325.24", "version": 1
}
```

`Piecework`: `{"id", "ref": "produccion_destajo.csv:7", "call": "REC-2051", "fecha", "turno", "cuadrilla", "concepto", "personas", "toneladas": "1525.629", "tarifa_usd": "1.28", "amount_usd": "1952.81"}`.

### `GET /parts/{id}`

`PartSummary` más:

```json
{
  "evidence": {
    "shift": {"start": "2026-06-11T00:00", "end": "2026-06-11T08:00"},
    "observation": {"raw": "Orio bay", "normalized": "orio bay",
                     "matches": [{"call": "REC-2051", "by": "alias|muelle", "term": "orio bay"}]},
    "planned_front": {"frentes": ["Muelle 1"], "call": "REC-2051", "nombrada_refs": ["nombrada_diaria.csv:20", "…"]},
    "piecework": [ Piecework ],
    "windows": [{"call": "REC-2051", "overlap_minutes": 480, "active": true}]
  },
  "candidates": ["REC-2051", "REC-2052", "REC-2053"],
  "allowed_destinations": ["REC-2051", "REC-2052", "REC-2053", "REC-SSGG"],
  "reviews": [{"id": 1, "operation_id": "uuid", "actor": "validador", "created_at": "2026-11-17T11:20",
                "from_status": "sugerido", "to_status": "validado",
                "from_destination": null, "to_destination": "REC-2052",
                "reason": "…", "reference": "…", "version_before": 1, "version_after": 2}],
  "can_review": true
}
```

## Escritura única

### `POST /parts/{id}/reviews` (rol `validador`, CSRF)

```json
{"destination": "REC-2052", "reason": "Confirmado con jefe de muelle 2", "reference": "WhatsApp 11/06 15:02",
 "expected_version": 1, "operation_id": "6f1c…-uuid"}
```

- `destination` = destino válido → `status: validado`. `destination: null` → vuelve a `pendiente` (marcar duda).
- `reason` obligatorio (≥ 5 caracteres). `reference` opcional (≤ 200).
- 201 con `{"part": PartDetail, "review": Review, "replayed": false}`.
- Reintento con el mismo `operation_id` y mismo contenido → 200 con el resultado anterior y `"replayed": true`.
- Mismo `operation_id` con otro contenido → 409 `operation_reused`. `expected_version` vencida → 409 `version_conflict`.
- El backend agrega actor (de la sesión) y hora. El importe del parte nunca cambia.

## Exportes

`GET /exports/csv` y `GET /exports/xlsx` → archivo `resultados_reto1_lote{N}_v{M}.(csv|xlsx)`.
Columnas: `ref, modalidad, fecha, turno, cuadrilla, tarea_o_concepto, cantidad, unidad, tarifa_usd, importe_usd, destino, estado, candidato_sugerido, fuerza, regla, motivo, alertas, validado_por, validado_en, lote, version_resultados`.
Sin observaciones libres ni padrón de trabajadores. Celdas de texto que empiezan con `= + - @` se prefijan con `'`.

## Importación

`python manage.py import_reto --data-dir RUTA` (fuera del repositorio). Mismo SHA-256 → no crea filas nuevas.
