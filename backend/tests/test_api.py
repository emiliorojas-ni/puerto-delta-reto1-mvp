from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import uuid

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import connections
from django.test import Client, TestCase, TransactionTestCase

from reto.imports.models import PartReview, WagePart
from reto.imports.services import import_reto_dataset
from reto.reviews.services import ReviewConflictError, submit_part_review
from tests.helpers import OFFICIAL_DATA_DIR


class ApiSecurityAndAuditTests(TestCase):
    @classmethod
    def setUpTestData(cls) -> None:
        cls.batch = import_reto_dataset(OFFICIAL_DATA_DIR).batch
        User = get_user_model()
        g_cons, _ = Group.objects.get_or_create(name="consulta")
        g_val, _ = Group.objects.get_or_create(name="validador")

        cls.user_consulta = User.objects.create_user(
            username="consulta", password="pwd-consulta-123"
        )
        cls.user_consulta.groups.add(g_cons)

        cls.user_validador = User.objects.create_user(
            username="validador", password="pwd-validador-123"
        )
        cls.user_validador.groups.add(g_val)

    def _csrf_client_logged_in(self, username: str, password: str) -> tuple[Client, str]:
        client = Client(enforce_csrf_checks=True)
        resp = client.get("/api/v1/auth/session")
        self.assertEqual(resp.status_code, 200)
        csrf_token = client.cookies["csrftoken"].value

        login_resp = client.post(
            "/api/v1/auth/login",
            data={"username": username, "password": password},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(login_resp.status_code, 200)
        return client, client.cookies["csrftoken"].value

    def test_unauthenticated_requests_rejected_and_cache_control_no_store(self) -> None:
        client = Client()
        resp = client.get("/api/v1/summary")
        self.assertEqual(resp.status_code, 403)
        self.assertIn("no-store", resp.headers.get("Cache-Control", ""))

    def test_csrf_enforced_on_post_review(self) -> None:
        client, _ = self._csrf_client_logged_in("validador", "pwd-validador-123")
        part = WagePart.objects.get(batch=self.batch, row_number=18)

        # Missing X-CSRFToken must be rejected with 403
        resp = client.post(
            f"/api/v1/parts/{part.id}/reviews",
            data={
                "destination": "REC-2052",
                "reason": "Confirmado con operaciones",
                "expected_version": 1,
                "operation_id": str(uuid.uuid4()),
            },
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 403)

    def test_role_consulta_forbidden_from_creating_review_403(self) -> None:
        client, csrf = self._csrf_client_logged_in("consulta", "pwd-consulta-123")
        part = WagePart.objects.get(batch=self.batch, row_number=18)

        resp = client.post(
            f"/api/v1/parts/{part.id}/reviews",
            data={
                "destination": "REC-2052",
                "reason": "Intento sin permiso",
                "expected_version": 1,
                "operation_id": str(uuid.uuid4()),
            },
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(resp.status_code, 403)

    def test_idempotent_retry_200_operation_reused_409_and_stale_version_409(self) -> None:
        client, csrf = self._csrf_client_logged_in("validador", "pwd-validador-123")
        part = WagePart.objects.get(batch=self.batch, row_number=18)
        op_id = str(uuid.uuid4())

        payload = {
            "destination": "REC-2052",
            "reason": "Validado con jefe de muelle 2",
            "reference": "Correo 11/06",
            "expected_version": 1,
            "operation_id": op_id,
        }

        # First call -> 201 Created
        r1 = client.post(
            f"/api/v1/parts/{part.id}/reviews",
            data=payload,
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(r1.status_code, 201)
        body1 = r1.json()
        self.assertFalse(body1["replayed"])
        self.assertEqual(body1["part"]["version"], 2)
        self.assertEqual(body1["part"]["status"], "validado")
        self.assertEqual(body1["part"]["destination"], "REC-2052")
        self.assertEqual(body1["part"]["amount_usd"], "81.31")

        # Exact retry with same operation_id -> 200 OK replayed=True
        r2 = client.post(
            f"/api/v1/parts/{part.id}/reviews",
            data=payload,
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(r2.status_code, 200)
        self.assertTrue(r2.json()["replayed"])
        self.assertEqual(PartReview.objects.filter(wage_part=part).count(), 1)

        # Reusing same operation_id with different destination -> 409 operation_reused
        r3 = client.post(
            f"/api/v1/parts/{part.id}/reviews",
            data={**payload, "destination": "REC-2053"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(r3.status_code, 409)
        self.assertEqual(r3.json()["code"], "operation_reused")

        # New operation_id but stale expected_version=1 -> 409 version_conflict
        r4 = client.post(
            f"/api/v1/parts/{part.id}/reviews",
            data={
                **payload,
                "operation_id": str(uuid.uuid4()),
                "expected_version": 1,
                "reason": "Otra revisión con versión vieja",
            },
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(r4.status_code, 409)
        self.assertEqual(r4.json()["code"], "version_conflict")

    def test_summary_calls_parts_and_exports_share_batch_and_results_version(self) -> None:
        client, _ = self._csrf_client_logged_in("validador", "pwd-validador-123")
        s_resp = client.get("/api/v1/summary")
        self.assertEqual(s_resp.status_code, 200)
        summary = s_resp.json()

        c_resp = client.get("/api/v1/calls/REC-2051")
        self.assertEqual(c_resp.status_code, 200)
        self.assertEqual(c_resp.json()["totals"]["destajo_usd"], "6298.75")

        p_resp = client.get("/api/v1/parts?status=pendientes")
        self.assertEqual(p_resp.status_code, 200)
        self.assertEqual(p_resp.json()["count"], summary["pending"]["parts"])

        csv_resp = client.get("/api/v1/exports/csv")
        self.assertEqual(csv_resp.status_code, 200)
        self.assertIn(
            f"lote{summary['batch']['id']}_v{summary['batch']['results_version']}.csv",
            csv_resp.headers.get("Content-Disposition", ""),
        )

        xlsx_resp = client.get("/api/v1/exports/xlsx")
        self.assertEqual(xlsx_resp.status_code, 200)


class ConcurrentReviewTransactionTests(TransactionTestCase):
    def test_concurrent_reviews_on_same_version_allow_only_one_winner(self) -> None:
        batch = import_reto_dataset(OFFICIAL_DATA_DIR).batch
        User = get_user_model()
        g_val, _ = Group.objects.get_or_create(name="validador")
        user = User.objects.create_user(username="val_conc", password="pwd")
        user.groups.add(g_val)

        part = WagePart.objects.get(batch=batch, row_number=18)

        def worker(dest: str) -> str:
            try:
                submit_part_review(
                    part_id=part.id,
                    actor=user,
                    destination=dest,
                    reason=f"Revisión concurrente hacia {dest}",
                    reference="Test concurrencia",
                    expected_version=1,
                    operation_id=uuid.uuid4(),
                )
                return "ok"
            except ReviewConflictError:
                return "conflict"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(worker, ["REC-2052", "REC-2053"]))

        self.assertCountEqual(outcomes, ["ok", "conflict"])
        part.refresh_from_db()
        self.assertEqual(part.version, 2)
        self.assertEqual(PartReview.objects.filter(wage_part=part).count(), 1)
