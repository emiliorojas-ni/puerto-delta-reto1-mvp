from __future__ import annotations

import csv
import io
from decimal import Decimal
from typing import Any

from openpyxl import Workbook

from reto.costing.reporting import build_cost_breakdown

from reto.costing.services import fmt_money, fmt_qty, EXPECTED_PERIOD_TOTAL_USD
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
    numeric = {"cantidad", "tarifa_usd", "importe_usd"}
    for row in build_export_rows(batch):
        ws.append([Decimal(row[col]) if col in numeric else row[col] for col in EXPORT_COLUMNS])
        i = ws.max_row
        ws.cell(i, 10, f"=ROUND(G{i}*I{i},2)")

    last = ws.max_row

    def sum_by(column, modality, criteria):
        pairs = [("B", f'"{modality}"'), *criteria]
        filters = ",".join(f"Resultados_Lineas!${col}$2:${col}${last},{value}" for col, value in pairs)
        return f"SUMIFS(Resultados_Lineas!${column}$2:${column}${last},{filters})"

    breakdown = wb.create_sheet("Fecha_turno_cuadrilla")
    breakdown.append(["destino", "fecha", "turno", "cuadrilla", "convocados", "jornales", "jornal_usd", "destajo_usd", "total_usd"])
    for row in build_cost_breakdown(batch):
        i = breakdown.max_row + 1
        criteria = [(col, f"{dest}{i}") for col, dest in zip("KCDE", "ABCD")]
        breakdown.append([
            row["destination"], row["fecha"], row["turno"], row["cuadrilla"],
            ", ".join(row["workers_called"]), "=" + sum_by("G", "Jornal", criteria),
            "=" + sum_by("J", "Jornal", criteria), "=" + sum_by("J", "Destajo", criteria),
            f"=ROUND(G{i}+H{i},2)",
        ])

    totals = wb.create_sheet("Totales_recalada")
    totals.append(["destino", "jornales", "jornal_usd", "destajo_usd", "total_usd", "Jornal / total", "Destajo / total"])
    calls = list(batch.port_calls.order_by("call_id").values_list("call_id", flat=True))
    for code in dict.fromkeys([*calls, "REC-SSGG", "PENDIENTE"]):
        i = totals.max_row + 1
        criteria = [("K", f"A{i}")]
        totals.append([
            code, "=" + sum_by("G", "Jornal", criteria), "=" + sum_by("J", "Jornal", criteria),
            "=" + sum_by("J", "Destajo", criteria), f"=ROUND(C{i}+D{i},2)",
            f'=IF(E{i}=0,"",C{i}/E{i})' if code in calls else None,
            f'=IF(E{i}=0,"",D{i}/E{i})' if code in calls else None,
        ])
    end_totals = totals.max_row
    totals.append(["TOTAL PERÍODO", *(f"=ROUND(SUM({col}2:{col}{end_totals}),2)" for col in "BCDE")])
    totals.append(["Control esperado USD", EXPECTED_PERIOD_TOTAL_USD])
    totals.append(["Diferencia USD", f"=ROUND(E{end_totals + 1}-B{end_totals + 2},2)"])
    notes = wb.create_sheet("Alcance_trabajadores")
    notes.append(["Los IDs corresponden a trabajadores convocados en la nombrada. Los partes solo indican cantidad de participantes y no identifican a cada ejecutor ni su pago individual."])
    for sheet in (ws, breakdown, totals):
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        for cells in sheet.iter_rows(min_row=2):
            for cell in cells:
                if cell.data_type in {"n", "f"}:
                    header = sheet.cell(1, cell.column).value
                    if header in {"Jornal / total", "Destajo / total"}:
                        cell.number_format = "0%"
                    else:
                        cell.number_format = "#,##0.###" if header in {"cantidad", "jornales"} else "#,##0.00"

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
