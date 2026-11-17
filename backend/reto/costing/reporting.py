from collections import defaultdict
from decimal import Decimal

from reto.costing.services import fmt_money, fmt_qty
from reto.imports.models import DailyCallUp, PieceworkProduction, WagePart


def build_cost_breakdown(batch):
    """Aggregate facts independently before combining them by destination and context."""
    groups = {}
    workers = defaultdict(list)
    for callup in DailyCallUp.objects.filter(batch=batch).order_by("worker_id"):
        workers[(callup.fecha, callup.turno, callup.cuadrilla)].append(callup.worker_id)

    def group(destination, fecha, turno, cuadrilla):
        key = (destination, fecha, turno, cuadrilla)
        if key not in groups:
            groups[key] = {
                "destination": destination, "fecha": fecha.isoformat(),
                "turno": turno, "cuadrilla": cuadrilla,
                "workers_called": sorted(set(workers[(fecha, turno, cuadrilla)])),
                "jornales": Decimal("0"), "jornal_usd": Decimal("0"),
                "destajo_usd": Decimal("0"), "jornal_details": [], "destajo_details": [],
            }
        return groups[key]

    for part in WagePart.objects.filter(batch=batch).select_related("ledger_line"):
        row = group(part.destination or "PENDIENTE", part.fecha, part.turno, part.cuadrilla)
        row["jornales"] += part.jornales
        row["jornal_usd"] += part.ledger_line.amount_usd
        row["jornal_details"].append({
            "ref": part.ref, "tarea": part.tarea, "personas": part.personas,
            "jornales": fmt_qty(part.jornales),
            "tarifa_usd": fmt_money(part.ledger_line.unit_rate_usd),
            "amount_usd": fmt_money(part.ledger_line.amount_usd),
            "status": part.status,
        })
    for production in PieceworkProduction.objects.filter(batch=batch).select_related("ledger_line"):
        row = group(production.call_id, production.fecha, production.turno, production.cuadrilla)
        row["destajo_usd"] += production.ledger_line.amount_usd
        row["destajo_details"].append({
            "ref": production.ref, "concepto": production.concepto,
            "personas": production.personas, "toneladas": fmt_qty(production.toneladas),
            "tarifa_usd": fmt_money(production.ledger_line.unit_rate_usd),
            "amount_usd": fmt_money(production.ledger_line.amount_usd),
        })
    output = []
    for key in sorted(groups):
        row = groups[key]
        row["total_usd"] = fmt_money(row["jornal_usd"] + row["destajo_usd"])
        for field in ("jornal_usd", "destajo_usd"):
            row[field] = fmt_money(row[field])
        row["jornales"] = fmt_qty(row["jornales"])
        output.append(row)
    return output
