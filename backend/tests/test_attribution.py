from __future__ import annotations

import uuid

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase

from reto.attribution.rules import DEST_SSGG
from reto.costing.services import compute_batch_summary
from reto.imports.models import WagePart
from reto.imports.services import import_reto_dataset
from reto.reviews.services import submit_part_review
from tests.helpers import OFFICIAL_DATA_DIR


class AttributionRulesTests(TestCase):
    @classmethod
    def setUpTestData(cls) -> None:
        cls.batch = import_reto_dataset(OFFICIAL_DATA_DIR).batch

    def test_ssgg_rows_2_9_22_23_31_36_confirmed_to_rec_ssgg(self) -> None:
        ssgg_rows = [2, 9, 22, 23, 31, 36]
        parts = WagePart.objects.filter(batch=self.batch, row_number__in=ssgg_rows)
        self.assertEqual(parts.count(), 6)
        for p in parts:
            self.assertEqual(p.status, WagePart.STATUS_CONFIRMADO)
            self.assertEqual(p.destination, DEST_SSGG)

        # Row 9: signaling in internal roads even though planned front is Almacén
        row9 = WagePart.objects.get(batch=self.batch, row_number=9)
        self.assertEqual(row9.rule_code, "R8_SSGG_SENALIZACION")
        self.assertIn("Almacén", row9.evidence["planned_front"]["frentes"])

    def test_cu01_rows_16_17_18_m3_override_and_conservative_pending(self) -> None:
        r16 = WagePart.objects.get(batch=self.batch, row_number=16)
        r17 = WagePart.objects.get(batch=self.batch, row_number=17)
        r18 = WagePart.objects.get(batch=self.batch, row_number=18)

        # Row 16: M2 -> REC-2052 confirmed (4 jornales)
        self.assertEqual(r16.status, WagePart.STATUS_CONFIRMADO)
        self.assertEqual(r16.destination, "REC-2052")

        # Row 17: "apoyo M3 bod 2" -> REC-2053 confirmed despite M2 plan and REC-2052 piecework
        self.assertEqual(r17.status, WagePart.STATUS_CONFIRMADO)
        self.assertEqual(r17.destination, "REC-2053")
        self.assertEqual(r17.evidence["planned_front"]["call"], "REC-2052")
        self.assertEqual(r17.evidence["piecework"][0]["call"], "REC-2052")
        alert_codes_17 = [a["code"] for a in r17.alerts]
        self.assertIn("OBS_OVERRIDES_PLAN", alert_codes_17)

        # Row 18: empty note -> sugerido REC-2052 (strong), not auto-confirmed
        self.assertEqual(r18.status, WagePart.STATUS_SUGERIDO)
        self.assertIsNone(r18.destination)
        self.assertEqual(r18.suggested_destination, "REC-2052")
        self.assertEqual(r18.strength, "fuerte")

    def test_row_13_25_34_35_specific_cases(self) -> None:
        # Row 13: "Orio bay" -> REC-2051 confirmed + JORNALES_GT_PERSONAS alert
        r13 = WagePart.objects.get(batch=self.batch, row_number=13)
        self.assertEqual(r13.status, WagePart.STATUS_CONFIRMADO)
        self.assertEqual(r13.destination, "REC-2051")
        self.assertIn("JORNALES_GT_PERSONAS", [a["code"] for a in r13.alerts])

        # User clarification: ORION prevails over an empty planned front.
        r25 = WagePart.objects.get(batch=self.batch, row_number=25)
        self.assertEqual(r25.status, WagePart.STATUS_CONFIRMADO)
        self.assertEqual(r25.destination, "REC-2051")
        self.assertEqual(r25.evidence["planned_front"]["frentes"], [])

        # Row 34: "esperando grua M1" -> REC-2051 confirmed full 2 jornales (R3/R9) despite 15:10 unberth
        r34 = WagePart.objects.get(batch=self.batch, row_number=34)
        self.assertEqual(r34.status, WagePart.STATUS_CONFIRMADO)
        self.assertEqual(r34.destination, "REC-2051")
        self.assertEqual(r34.rule_code, "R9_ESPERA_CAUSA_OBSERVADA")
        self.assertEqual( str(r34.ledger_line.amount_usd), "162.62")

        # Row 35: "final de nave" -> sugerido REC-2053 (fuerte)
        r35 = WagePart.objects.get(batch=self.batch, row_number=35)
        self.assertEqual(r35.status, WagePart.STATUS_SUGERIDO)
        self.assertEqual(r35.suggested_destination, "REC-2053")
        self.assertEqual(r35.strength, "fuerte")

    def test_review_changes_destination_without_changing_global_total(self) -> None:
        User = get_user_model()
        val_group, _ = Group.objects.get_or_create(name="validador")
        user = User.objects.create_user(username="val_test", password="pwd")
        user.groups.add(val_group)

        before = compute_batch_summary(self.batch)
        self.assertEqual(before["totals"]["total_usd"], "23158.24")

        r18 = WagePart.objects.get(batch=self.batch, row_number=18)
        submit_part_review(
            part_id=r18.id,
            actor=user,
            destination="REC-2052",
            reason="Confirmado con supervisor de Muelle 2",
            reference="Acta turno B",
            expected_version=r18.version,
            operation_id=uuid.uuid4(),
        )

        after = compute_batch_summary(self.batch)
        self.assertEqual(after["totals"]["total_usd"], "23158.24")
        self.assertTrue(after["control"]["ok"])
