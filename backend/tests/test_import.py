from __future__ import annotations

from datetime import time
from decimal import Decimal
import shutil

from django.test import TestCase

from reto.imports.models import (
    CostLedgerLine,
    Crew,
    CrewMember,
    DailyCallUp,
    ImportBatch,
    PieceworkProduction,
    PlannedFrontSummary,
    PortCall,
    Shift,
    Tariff,
    WagePart,
)
from reto.imports.services import ImportValidationError, import_reto_dataset
from tests.helpers import OFFICIAL_DATA_DIR, copy_official_csvs_to_temp


class ImportAndProvenanceTests(TestCase):
    def test_official_import_counts_and_shift_2400_normalization(self) -> None:
        res = import_reto_dataset(OFFICIAL_DATA_DIR, imported_by="operador")
        self.assertTrue(res.created)
        self.assertFalse(res.reused)
        batch = res.batch

        self.assertEqual(batch.source_rows, 343)
        self.assertEqual(PortCall.objects.filter(batch=batch).count(), 3)
        self.assertEqual(Shift.objects.filter(batch=batch).count(), 3)
        self.assertEqual(Crew.objects.filter(batch=batch).count(), 15)
        self.assertEqual(CrewMember.objects.filter(batch=batch).count(), 90)
        self.assertEqual(DailyCallUp.objects.filter(batch=batch).count(), 186)
        self.assertEqual(PlannedFrontSummary.objects.filter(batch=batch).count(), 31)
        self.assertEqual(WagePart.objects.filter(batch=batch).count(), 35)
        self.assertEqual(PieceworkProduction.objects.filter(batch=batch).count(), 20)
        self.assertEqual(Tariff.objects.filter(batch=batch).count(), 6)
        self.assertEqual(CostLedgerLine.objects.filter(batch=batch).count(), 55)

        shift_c = Shift.objects.get(batch=batch, code="C")
        self.assertEqual(shift_c.hora_inicio, time(16, 0))
        self.assertEqual(shift_c.hora_fin, time(0, 0))
        self.assertTrue(shift_c.spans_next_day)

        # Row 13 (CU-03, 11/06 A, 2 personas / 4 jornales) preserved with alert and USD 325.24
        row13 = WagePart.objects.select_related("ledger_line").get(
            batch=batch, row_number=13
        )
        self.assertEqual(row13.personas, 2)
        self.assertEqual(row13.jornales, Decimal("4.00"))
        self.assertEqual(row13.ledger_line.amount_usd, Decimal("325.24"))
        alert_codes = [a["code"] for a in row13.alerts]
        self.assertIn("JORNALES_GT_PERSONAS", alert_codes)

    def test_reimport_identical_batch_is_idempotent(self) -> None:
        first = import_reto_dataset(OFFICIAL_DATA_DIR, imported_by="operador")
        second = import_reto_dataset(OFFICIAL_DATA_DIR, imported_by="operador")

        self.assertEqual(first.batch.id, second.batch.id)
        self.assertFalse(second.created)
        self.assertTrue(second.reused)
        self.assertEqual(ImportBatch.objects.count(), 1)
        self.assertEqual(WagePart.objects.count(), 35)
        self.assertEqual(CostLedgerLine.objects.count(), 55)

    def test_broken_header_rejected_with_file_and_row_and_rolls_back(self) -> None:
        tmp_dir = copy_official_csvs_to_temp()
        try:
            partes_path = tmp_dir / "partes_jornal.csv"
            content = partes_path.read_text(encoding="utf-8")
            broken = content.replace("observacion", "nota_rota", 1)
            partes_path.write_text(broken, encoding="utf-8")

            with self.assertRaises(ImportValidationError) as ctx:
                import_reto_dataset(tmp_dir)

            self.assertEqual(ctx.exception.file, "partes_jornal.csv")
            self.assertEqual(ctx.exception.row, 1)
            self.assertEqual(ImportBatch.objects.count(), 0)
            self.assertEqual(WagePart.objects.count(), 0)
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    def test_missing_tariff_rolls_back_atomically_without_partial_batch(self) -> None:
        tmp_dir = copy_official_csvs_to_temp()
        try:
            tarifas_path = tmp_dir / "tarifario.csv"
            lines = tarifas_path.read_text(encoding="utf-8").splitlines()
            # Remove 'Bolas de acero' tariff
            filtered = [ln for ln in lines if "Bolas de acero" not in ln]
            tarifas_path.write_text("\n".join(filtered) + "\n", encoding="utf-8")

            with self.assertRaises(ImportValidationError) as ctx:
                import_reto_dataset(tmp_dir)

            self.assertEqual(ctx.exception.file, "produccion_destajo.csv")
            self.assertEqual(ImportBatch.objects.count(), 0)
            self.assertEqual(PortCall.objects.count(), 0)
            self.assertEqual(WagePart.objects.count(), 0)
            self.assertEqual(PieceworkProduction.objects.count(), 0)
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)
