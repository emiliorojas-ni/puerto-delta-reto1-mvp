from __future__ import annotations

from reto.attribution.rules import compute_shift_interval, evaluate_part_attribution
from reto.imports.models import (
    ImportBatch,
    PieceworkProduction,
    PlannedFrontSummary,
    PortCall,
    Shift,
    Tariff,
    WagePart,
)
from reto.costing.services import round_currency


def apply_attribution_for_batch(batch: ImportBatch) -> None:
    """Run deterministic attribution rules across all WagePart rows in a batch."""
    port_calls = [
        {
            "call_id": pc.call_id,
            "nave": pc.nave,
            "muelle": pc.muelle,
            "atraque": pc.atraque,
            "desatraque": pc.desatraque,
        }
        for pc in PortCall.objects.filter(batch=batch).order_by("call_id")
    ]
    shifts_by_code = {s.code: s for s in Shift.objects.filter(batch=batch)}
    summaries_by_ctx = {
        (s.fecha, s.turno, s.cuadrilla): s
        for s in PlannedFrontSummary.objects.filter(batch=batch)
    }
    tariffs_by_concept = {
        t.concepto: t.tarifa_usd
        for t in Tariff.objects.filter(batch=batch, modalidad="Destajo")
    }

    pieceworks_by_ctx: dict[tuple, list[dict]] = {}
    for pw in PieceworkProduction.objects.filter(batch=batch).order_by("row_number"):
        rate = tariffs_by_concept[pw.concepto]
        amount = round_currency(pw.toneladas * rate)
        item = {
            "id": pw.id,
            "ref": pw.ref,
            "call": pw.call_id,
            "fecha": pw.fecha.isoformat(),
            "turno": pw.turno,
            "cuadrilla": pw.cuadrilla,
            "concepto": pw.concepto,
            "personas": pw.personas,
            "toneladas": f"{pw.toneladas:.3f}".rstrip("0").rstrip(".") if "." in f"{pw.toneladas}" else str(pw.toneladas),
            "tarifa_usd": f"{rate:.2f}",
            "amount_usd": f"{amount:.2f}",
        }
        pieceworks_by_ctx.setdefault((pw.fecha, pw.turno, pw.cuadrilla), []).append(item)

    for part in WagePart.objects.filter(batch=batch).order_by("row_number"):
        shift = shifts_by_code[part.turno]
        shift_start, shift_end = compute_shift_interval(
            part.fecha, shift.hora_inicio, shift.hora_fin, shift.spans_next_day
        )
        summary = summaries_by_ctx.get((part.fecha, part.turno, part.cuadrilla))
        planned_frentes = list(summary.frentes) if summary else []
        nombrada_refs = list(summary.nombrada_refs) if summary else []
        pw_items = pieceworks_by_ctx.get((part.fecha, part.turno, part.cuadrilla), [])

        outcome = evaluate_part_attribution(
            tarea=part.tarea,
            personas=part.personas,
            jornales=part.jornales,
            observacion=part.observacion,
            shift_start=shift_start,
            shift_end=shift_end,
            port_calls=port_calls,
            planned_frentes=planned_frentes,
            nombrada_refs=nombrada_refs,
            piecework_items=pw_items,
        )

        part.status = outcome.status
        part.destination = outcome.destination
        part.suggested_destination = outcome.suggested_destination
        part.strength = outcome.strength
        part.rule_code = outcome.rule_code
        part.rule_version = outcome.rule_version
        part.reason = outcome.reason
        part.candidates = outcome.candidates
        part.evidence = outcome.evidence
        part.alerts = outcome.alerts
        part.save(
            update_fields=[
                "status",
                "destination",
                "suggested_destination",
                "strength",
                "rule_code",
                "rule_version",
                "reason",
                "candidates",
                "evidence",
                "alerts",
            ]
        )
