from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from reto.attribution.rules import DEST_SSGG
from reto.imports.models import (
    CostLedgerLine,
    ImportBatch,
    PieceworkProduction,
    PortCall,
    Tariff,
    WagePart,
)

TWOPLACES = Decimal("0.01")
EXPECTED_PERIOD_TOTAL_USD = Decimal("23158.24")


def round_currency(value: Decimal) -> Decimal:
    return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def fmt_money(value: Decimal) -> str:
    return f"{round_currency(value):.2f}"


def fmt_qty(value: Decimal) -> str:
    s = f"{value:f}"
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s or "0"


def build_ledger_for_batch(batch: ImportBatch) -> None:
    """Create the 55 CostLedgerLine rows (1 per WagePart + 1 per PieceworkProduction) with R10 rounding."""
    CostLedgerLine.objects.filter(batch=batch).delete()

    jornal_tariff = Tariff.objects.get(batch=batch, modalidad="Jornal")
    destajo_tariffs = {
        t.concepto: t for t in Tariff.objects.filter(batch=batch, modalidad="Destajo")
    }

    lines_to_create: list[CostLedgerLine] = []

    for part in WagePart.objects.filter(batch=batch).order_by("row_number"):
        amount = round_currency(part.jornales * jornal_tariff.tarifa_usd)
        lines_to_create.append(
            CostLedgerLine(
                batch=batch,
                ref=part.ref,
                modalidad=CostLedgerLine.MODALIDAD_JORNAL,
                wage_part=part,
                piecework=None,
                tariff=jornal_tariff,
                quantity=part.jornales,
                unit_rate_usd=jornal_tariff.tarifa_usd,
                amount_usd=amount,
            )
        )

    for pw in PieceworkProduction.objects.filter(batch=batch).order_by("row_number"):
        tariff = destajo_tariffs[pw.concepto]
        amount = round_currency(pw.toneladas * tariff.tarifa_usd)
        lines_to_create.append(
            CostLedgerLine(
                batch=batch,
                ref=pw.ref,
                modalidad=CostLedgerLine.MODALIDAD_DESTAJO,
                wage_part=None,
                piecework=pw,
                tariff=tariff,
                quantity=pw.toneladas,
                unit_rate_usd=tariff.tarifa_usd,
                amount_usd=amount,
            )
        )

    CostLedgerLine.objects.bulk_create(lines_to_create)


def recompute_expected_by_ref(batch: ImportBatch) -> dict[str, Decimal]:
    """Independently recompute expected per-row USD directly from WagePart, PieceworkProduction, and Tariff."""
    jornal_tariff = Tariff.objects.get(batch=batch, modalidad="Jornal")
    destajo_rates = {
        t.concepto: t.tarifa_usd
        for t in Tariff.objects.filter(batch=batch, modalidad="Destajo")
    }

    expected: dict[str, Decimal] = {}
    for part in WagePart.objects.filter(batch=batch).order_by("row_number"):
        expected[part.ref] = round_currency(part.jornales * jornal_tariff.tarifa_usd)

    for pw in PieceworkProduction.objects.filter(batch=batch).order_by("row_number"):
        rate = destajo_rates[pw.concepto]
        expected[pw.ref] = round_currency(pw.toneladas * rate)

    return expected


def verify_monetary_control(
    batch: ImportBatch,
    *,
    external_expected_usd: Decimal = EXPECTED_PERIOD_TOTAL_USD,
    ledger_rows_override: list[tuple[str, Decimal]] | None = None,
) -> dict[str, Any]:
    """
    Compare ledger rows against independent recomputation from source rows by reference key.
    Detects:
      - missing reference in ledger
      - duplicated reference in ledger
      - amount mismatch on a reference
      - external benchmark difference when per-row references match
    """
    recomputed_map = recompute_expected_by_ref(batch)
    recomputed_total = sum(recomputed_map.values(), Decimal("0.00"))

    if ledger_rows_override is not None:
        raw_ledger = list(ledger_rows_override)
    else:
        raw_ledger = [
            (line.ref, line.amount_usd)
            for line in CostLedgerLine.objects.filter(batch=batch).order_by("id")
        ]

    ledger_total = sum((amt for _, amt in raw_ledger), Decimal("0.00"))
    discrepancies: list[dict[str, str]] = []

    counts_by_ref: dict[str, int] = {}
    sums_by_ref: dict[str, Decimal] = {}
    for ref, amt in raw_ledger:
        counts_by_ref[ref] = counts_by_ref.get(ref, 0) + 1
        sums_by_ref[ref] = sums_by_ref.get(ref, Decimal("0.00")) + amt

    for ref, exp_amt in recomputed_map.items():
        cnt = counts_by_ref.get(ref, 0)
        if cnt == 0:
            discrepancies.append(
                {
                    "ref": ref,
                    "kind": "missing",
                    "ledger_usd": "0.00",
                    "recomputed_usd": fmt_money(exp_amt),
                }
            )
        elif cnt > 1:
            discrepancies.append(
                {
                    "ref": ref,
                    "kind": "duplicated",
                    "ledger_usd": fmt_money(sums_by_ref[ref]),
                    "recomputed_usd": fmt_money(exp_amt),
                }
            )
        elif sums_by_ref[ref] != exp_amt:
            discrepancies.append(
                {
                    "ref": ref,
                    "kind": "amount",
                    "ledger_usd": fmt_money(sums_by_ref[ref]),
                    "recomputed_usd": fmt_money(exp_amt),
                }
            )

    for ref, led_amt in sums_by_ref.items():
        if ref not in recomputed_map:
            discrepancies.append(
                {
                    "ref": ref,
                    "kind": "duplicated",
                    "ledger_usd": fmt_money(led_amt),
                    "recomputed_usd": "0.00",
                }
            )

    diff_vs_expected = ledger_total - external_expected_usd
    if not discrepancies and diff_vs_expected != Decimal("0.00"):
        discrepancies.append(
            {
                "ref": "EXTERNAL_BENCHMARK",
                "kind": "external_benchmark_only",
                "ledger_usd": fmt_money(ledger_total),
                "recomputed_usd": fmt_money(external_expected_usd),
            }
        )

    return {
        "expected_usd": fmt_money(external_expected_usd),
        "ledger_usd": fmt_money(ledger_total),
        "recomputed_usd": fmt_money(recomputed_total),
        "difference_usd": fmt_money(diff_vs_expected),
        "ok": len(discrepancies) == 0 and diff_vs_expected == Decimal("0.00"),
        "discrepancies": discrepancies,
    }


def compute_batch_summary(batch: ImportBatch) -> dict[str, Any]:
    jornal_tariff = Tariff.objects.get(batch=batch, modalidad="Jornal")
    parts = list(
        WagePart.objects.filter(batch=batch)
        .select_related("ledger_line", "active_review")
        .order_by("row_number")
    )
    pieceworks = list(
        PieceworkProduction.objects.filter(batch=batch)
        .select_related("ledger_line")
        .order_by("row_number")
    )
    port_calls = list(PortCall.objects.filter(batch=batch).order_by("call_id"))

    calls_payload: list[dict[str, Any]] = []
    for pc in port_calls:
        confirmed_parts = [
            p
            for p in parts
            if p.status in {WagePart.STATUS_CONFIRMADO, WagePart.STATUS_VALIDADO}
            and p.destination == pc.call_id
        ]
        suggested_parts = [
            p
            for p in parts
            if p.status in {WagePart.STATUS_SUGERIDO, WagePart.STATUS_PENDIENTE}
            and p.suggested_destination == pc.call_id
        ]
        call_pws = [pw for pw in pieceworks if pw.call_id == pc.call_id]

        jornales_qty = sum((p.jornales for p in confirmed_parts), Decimal("0"))
        jornal_usd = sum((p.ledger_line.amount_usd for p in confirmed_parts), Decimal("0.00"))
        destajo_usd = sum((pw.ledger_line.amount_usd for pw in call_pws), Decimal("0.00"))
        total_usd = jornal_usd + destajo_usd

        sugg_jornales = sum((p.jornales for p in suggested_parts), Decimal("0"))
        sugg_usd = sum((p.ledger_line.amount_usd for p in suggested_parts), Decimal("0.00"))

        calls_payload.append(
            {
                "id": pc.call_id,
                "nave": pc.nave,
                "cliente": pc.cliente,
                "tipo_carga": pc.tipo_carga,
                "muelle": pc.muelle,
                "atraque": pc.atraque.strftime("%Y-%m-%dT%H:%M"),
                "desatraque": pc.desatraque.strftime("%Y-%m-%dT%H:%M"),
                "jornales": fmt_qty(jornales_qty),
                "jornal_usd": fmt_money(jornal_usd),
                "destajo_usd": fmt_money(destajo_usd),
                "total_usd": fmt_money(total_usd),
                "suggested_jornales": fmt_qty(sugg_jornales),
                "suggested_usd": fmt_money(sugg_usd),
                "parts": len(confirmed_parts),
                "piecework_lines": len(call_pws),
            }
        )

    ssgg_parts = [
        p
        for p in parts
        if p.status in {WagePart.STATUS_CONFIRMADO, WagePart.STATUS_VALIDADO}
        and p.destination == DEST_SSGG
    ]
    ssgg_jornales = sum((p.jornales for p in ssgg_parts), Decimal("0"))
    ssgg_usd = sum((p.ledger_line.amount_usd for p in ssgg_parts), Decimal("0.00"))

    pending_parts = [
        p
        for p in parts
        if p.status in {WagePart.STATUS_SUGERIDO, WagePart.STATUS_PENDIENTE}
    ]
    pending_jornales = sum((p.jornales for p in pending_parts), Decimal("0"))
    pending_usd = sum((p.ledger_line.amount_usd for p in pending_parts), Decimal("0.00"))

    status_counts = {
        WagePart.STATUS_CONFIRMADO: sum(1 for p in parts if p.status == WagePart.STATUS_CONFIRMADO),
        WagePart.STATUS_VALIDADO: sum(1 for p in parts if p.status == WagePart.STATUS_VALIDADO),
        WagePart.STATUS_SUGERIDO: sum(1 for p in parts if p.status == WagePart.STATUS_SUGERIDO),
        WagePart.STATUS_PENDIENTE: sum(1 for p in parts if p.status == WagePart.STATUS_PENDIENTE),
    }

    total_jornales = sum((p.jornales for p in parts), Decimal("0"))
    total_jornal_usd = sum((p.ledger_line.amount_usd for p in parts), Decimal("0.00"))
    total_destajo_usd = sum((pw.ledger_line.amount_usd for pw in pieceworks), Decimal("0.00"))
    total_period_usd = total_jornal_usd + total_destajo_usd

    control = verify_monetary_control(batch)

    return {
        "batch": {
            "id": batch.id,
            "sha256": batch.sha256,
            "imported_at": batch.imported_at.strftime("%Y-%m-%dT%H:%M"),
            "results_version": batch.results_version,
            "source_rows": batch.source_rows,
        },
        "rate_jornal_usd": fmt_money(jornal_tariff.tarifa_usd),
        "calls": calls_payload,
        "ssgg": {
            "jornales": fmt_qty(ssgg_jornales),
            "jornal_usd": fmt_money(ssgg_usd),
            "parts": len(ssgg_parts),
        },
        "pending": {
            "jornales": fmt_qty(pending_jornales),
            "jornal_usd": fmt_money(pending_usd),
            "parts": len(pending_parts),
            "by_status": {
                "sugerido": status_counts[WagePart.STATUS_SUGERIDO],
                "pendiente": status_counts[WagePart.STATUS_PENDIENTE],
            },
        },
        "totals": {
            "jornal_usd": fmt_money(total_jornal_usd),
            "destajo_usd": fmt_money(total_destajo_usd),
            "total_usd": fmt_money(total_period_usd),
            "lines": len(parts) + len(pieceworks),
            "jornal_lines": len(parts),
            "destajo_lines": len(pieceworks),
            "jornales": fmt_qty(total_jornales),
        },
        "control": control,
        "status_counts": status_counts,
    }
