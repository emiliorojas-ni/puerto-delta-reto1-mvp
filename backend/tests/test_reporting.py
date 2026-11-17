from decimal import Decimal
from io import BytesIO

from django.test import TestCase
from openpyxl import load_workbook

from reto.attribution.rules import evaluate_part_attribution
from reto.costing.exports import export_batch_xlsx
from reto.costing.reporting import build_cost_breakdown
from reto.imports.services import import_reto_dataset
from tests.helpers import OFFICIAL_DATA_DIR
from datetime import datetime


class ReportingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.batch = import_reto_dataset(OFFICIAL_DATA_DIR).batch

    def test_breakdown_conserves_all_55_facts_and_total(self):
        rows = build_cost_breakdown(self.batch)
        self.assertEqual(sum(Decimal(row["total_usd"]) for row in rows), Decimal("23158.24"))
        refs = [line["ref"] for row in rows for field in ("jornal_details", "destajo_details") for line in row[field]]
        self.assertEqual(len(refs), 55)
        self.assertEqual(len(set(refs)), 55)
        ssgg = [row for row in rows if row["destination"] == "REC-SSGG"]
        self.assertEqual(sum(Decimal(row["total_usd"]) for row in ssgg), Decimal("1463.58"))
        self.assertTrue(all(len(row["workers_called"]) == 6 for row in rows))

    def test_empty_front_without_vessel_note_is_general(self):
        result = evaluate_part_attribution(
            tarea="Limpieza", personas=2, jornales=Decimal(2), observacion="",
            shift_start=datetime(2026, 6, 11, 8), shift_end=datetime(2026, 6, 11, 16),
            port_calls=[], planned_frentes=[], nombrada_refs=["nombrada_diaria.csv:2"], piecework_items=[],
        )
        self.assertEqual(result.destination, "REC-SSGG")

    def test_xlsx_has_numeric_totals_and_breakdown(self):
        book = load_workbook(BytesIO(export_batch_xlsx(self.batch)))
        self.assertEqual(book["Resultados_Lineas"]["J2"].value, "=ROUND(G2*I2,2)")
        self.assertEqual(book["Totales_recalada"]["E7"].value, "=ROUND(SUM(E2:E6),2)")
        self.assertEqual(book["Totales_recalada"]["F2"].number_format, "0%")
        self.assertIn("SUMIFS", book["Fecha_turno_cuadrilla"]["G2"].value)
        self.assertIn("Fecha_turno_cuadrilla", book.sheetnames)

    def test_warehouse_front_is_general_for_nonstandard_task(self):
        result = evaluate_part_attribution(
            tarea="Limpieza", personas=2, jornales=Decimal(2), observacion="",
            shift_start=datetime(2026, 6, 11, 8), shift_end=datetime(2026, 6, 11, 16),
            port_calls=[], planned_frentes=["Almacén"], nombrada_refs=["nombrada_diaria.csv:2"], piecework_items=[],
        )
        self.assertEqual(result.destination, "REC-SSGG")
