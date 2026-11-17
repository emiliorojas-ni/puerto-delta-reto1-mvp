from __future__ import annotations

from decimal import Decimal

from django.test import TestCase

from reto.costing.exports import export_batch_csv, sanitize_Export_cell
from reto.costing.services import compute_batch_summary, verify_monetary_control
from reto.imports.models import CostLedgerLine
from reto.imports.services import import_reto_dataset
from tests.helpers import OFFICIAL_DATA_DIR


class CostingAndControlTests(TestCase):
    @classmethod
    def setUpTestData(cls) -> None:
        cls.batch = import_reto_dataset(OFFICIAL_DATA_DIR).batch

    def test_exact_monetary_figures_and_55_unique_references(self) -> None:
        summary = compute_batch_summary(self.batch)

        self.assertEqual(summary["totals"]["lines"], 55)
        self.assertEqual(summary["totals"]["jornal_lines"], 35)
        self.assertEqual(summary["totals"]["destajo_lines"], 20)
        self.assertEqual(summary["totals"]["jornales"], "118")
        self.assertEqual(summary["totals"]["jornal_usd"], "9594.58")
        self.assertEqual(summary["totals"]["destajo_usd"], "13563.66")
        self.assertEqual(summary["totals"]["total_usd"], "23158.24")
        self.assertEqual(summary["ssgg"]["jornales"], "18")
        self.assertEqual(summary["ssgg"]["jornal_usd"], "1463.58")
        self.assertEqual(summary["ssgg"]["parts"], 6)

        calls_by_id = {c["id"]: c for c in summary["calls"]}
        self.assertEqual(calls_by_id["REC-2051"]["destajo_usd"], "6298.75")
        self.assertEqual(calls_by_id["REC-2052"]["destajo_usd"], "3327.70")
        self.assertEqual(calls_by_id["REC-2053"]["destajo_usd"], "3937.21")

        # Confirmed + Suggested scenario matches the 62 / 29 / 9 jornales benchmark
        self.assertEqual(
            int(calls_by_id["REC-2051"]["jornales"])
            + int(calls_by_id["REC-2051"]["suggested_jornales"]),
            62,
        )
        self.assertEqual(
            int(calls_by_id["REC-2052"]["jornales"])
            + int(calls_by_id["REC-2052"]["suggested_jornales"]),
            29,
        )
        self.assertEqual(
            int(calls_by_id["REC-2053"]["jornales"])
            + int(calls_by_id["REC-2053"]["suggested_jornales"]),
            9,
        )
        self.assertTrue(summary["control"]["ok"])
        self.assertEqual(summary["control"]["difference_usd"], "0.00")
        self.assertEqual(summary["control"]["discrepancies"], [])

    def test_detects_injected_omission_and_duplication_and_external_benchmark_diff(self) -> None:
        base_rows = [
            (line.ref, line.amount_usd)
            for line in CostLedgerLine.objects.filter(batch=self.batch).order_by("id")
        ]

        # 1. Inject omission of partes_jornal.csv:13 (USD 325.24)
        omitted = [(r, a) for (r, a) in base_rows if r != "partes_jornal.csv:13"]
        ctrl_omitted = verify_monetary_control(self.batch, ledger_rows_override=omitted)
        self.assertFalse(ctrl_omitted["ok"])
        self.assertEqual(ctrl_omitted["difference_usd"], "-325.24")
        self.assertEqual(len(ctrl_omitted["discrepancies"]), 1)
        self.assertEqual(ctrl_omitted["discrepancies"][0]["ref"], "partes_jornal.csv:13")
        self.assertEqual(ctrl_omitted["discrepancies"][0]["kind"], "missing")

        # 2. Inject duplication of produccion_destajo.csv:2 (USD 541.02)
        duplicated = list(base_rows) + [("produccion_destajo.csv:2", Decimal("541.02"))]
        ctrl_dup = verify_monetary_control(self.batch, ledger_rows_override=duplicated)
        self.assertFalse(ctrl_dup["ok"])
        self.assertEqual(ctrl_dup["difference_usd"], "541.02")
        self.assertEqual(ctrl_dup["discrepancies"][0]["ref"], "produccion_destajo.csv:2")
        self.assertEqual(ctrl_dup["discrepancies"][0]["kind"], "duplicated")

        # 3. External global benchmark differs while all 55 rows match
        ctrl_ext = verify_monetary_control(
            self.batch, external_expected_usd=Decimal("23158.25")
        )
        self.assertFalse(ctrl_ext["ok"])
        self.assertEqual(ctrl_ext["difference_usd"], "-0.01")
        self.assertEqual(
            ctrl_ext["discrepancies"][0]["kind"], "external_benchmark_only"
        )

    def test_csv_formula_escaping_and_export_parity(self) -> None:
        self.assertEqual(sanitize_Export_cell("=SUM(A1:A2)"), "'=SUM(A1:A2)")
        self.assertEqual(sanitize_Export_cell("+cmd|' /C calc'!A0"), "'+cmd|' /C calc'!A0")
        self.assertEqual(sanitize_Export_cell("-10+20"), "'-10+20")
        self.assertEqual(sanitize_Export_cell("@IMPORTXML()"), "'@IMPORTXML()")

        csv_bytes = export_batch_csv(self.batch)
        text = csv_bytes.decode("utf-8")
        lines = text.strip().splitlines()
        self.assertEqual(len(lines), 56)  # 1 header + 55 lines
        # Ensure free-text observation "Orio bay" is not leaked as a column
        self.assertNotIn("Orio bay", text)
