from __future__ import annotations

import csv
import io
from typing import Any

from openpyxl import Workbook

from reto.costing.services import fmt_money, fmt_qty
from reto.imports.models import ImportBatch, PieceworkProduction, WagePart

EXPORT_COLUMNS = [
    "ref",
    "modalidad",
    "fecha",
    "turno",
    "cuadrilla",
    "tarea_o_concepto",
    "cantidad",
    "unidad",
    "tarifa_usd",
    "importe_usd",
    "destino",
    "estado",
    "candidato_sugerido",
    "fuerza",
    "regla",
    "motivo",
    "alertas",
    "validado_por",
    "validado_en",
    "lote",
    "version_resultados",
]

FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def sanitize_Export_cell(value: Any) -> str:
    """Prevent CSV/spreadsheet formula injection by prefixing dangerous leading chars with `'`. """
    text = "" if value is None else str(value)
    if text and text[0] in FORMULA_PREFIXES:
        return f"'{text}"
    return text


def build_export_rows(batch: ImportBatch) -> list[dict[str, str]]:
    """
    Build the 55 derived result rows from the active batch and current results_version.
    Excludes free-text `observacion` and worker roster IDs so the derived export is safe.
    """
    rows: list[dict[str, str]] = []

    parts = (
        WagePart.objects.filter(batch=batch)
        .select_related("ledger_line", "active_review")
        .order_by("row_number")
    )
    for part in parts:
        line = part.ledger_line
        review = part.active_review
        alert_codes = ";".join(a.get("code", "") for a in (part.alerts or []) if a.get("code"))
        rows.append(
            {
                "ref": part.ref,
                "modalidad": "Jornal",
                "fecha": part.fecha.isoformat(),
                "turno": part.turno,
                "cuadrilla": part.cuadrilla,
                "tarea_o_concepto": sanitize_Export_cell(part.tarea),
                "cantidad": fmt_qty(part.jornales),
                "unidad": "jornal",
                "tarifa_usd": fmt_money(line.unit_rate_usd),
                "importe_usd": fmt_money(line.amount_usd),
                "destino": part.destination or "PENDIENTE",
                "estado": part.status,
                "candidato_sugerido": part.suggested_destination or "",
                "fuerza": part.strength or "",
                "regla": part.rule_code,
                "motivo": sanitize_Export_cell(part.reason),
                "alertas": sanitize_Export_cell(alert_codes),
                "validado_por": sanitize_Export_cell(review.actor_username if review else ""),
                "validado_en": (
                    review.created_at.strftime("%Y-%m-%dT%H:%M") if review else ""
                ),
                "lote": str(batch.id),
                "version_resultados": str(batch.results_version),
            }
        )

    pieceworks = (
        PieceworkProduction.objects.filter(batch=batch)
        .select_related("ledger_line")
        .order_by("row_number")
    )
    for pw in pieceworks:
        line = pw.ledger_line
        rows.append(
            {
                "ref": pw.ref,
                "modalidad": "Destajo",
                "fecha": pw.fecha.isoformat(),
                "turno": pw.turno,
                "cuadrilla": pw.cuadrilla,
                "tarea_o_concepto": sanitize_Export_cell(pw.concepto),
                "cantidad": fmt_qty(pw.toneladas),
                "unidad": "tonelada",
                "tarifa_usd": fmt_money(line.unit_rate_usd),
                "importe_usd": fmt_money(line.amount_usd),
                "destino": pw.call_id,
                "estado": "confirmado",
                "candidato_sugerido": "",
                "fuerza": "",
                "regla": "DESTAJO_DIRECTO_ORIGEN",
                "motivo": f"Producción a destajo asociada en origen a {pw.call_id}.",
                "alertas": "",
                "validado_por": "",
                "validado_en": "",
                "lote": str(batch.id),
                "version_resultados": str(batch.results_version),
            }
        )

    return rows


def export_batch_csv(batch: ImportBatch) -> bytes:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=EXPORT_COLUMNS, lineterminator="\n")
    writer.writeheader()
    for row in build_export_rows(batch):
        writer.writerow(row)
    return buf.getvalue().encode("utf-8")


def export_batch_xlsx(batch: ImportBatch) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Resultados_Lineas"
    ws.append(EXPORT_COLUMNS)
    for row in build_export_rows(batch):
        ws.append([row[col] for col in EXPORT_COLUMNS])

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
