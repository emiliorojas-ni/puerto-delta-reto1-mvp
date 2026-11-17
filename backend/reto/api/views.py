from __future__ import annotations

from decimal import Decimal

from django.contrib.auth import authenticate, login, logout
from django.http import HttpResponse
from django.middleware.csrf import get_token
from django.utils.cache import patch_cache_control
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from reto.api.permissions import (
    IsAuthenticatedRead,
    IsValidatorRole,
    get_user_roles,
    user_can_review,
)
from reto.api.serializers import (
    LoginInputSerializer,
    ReviewInputSerializer,
    serialize_part_detail,
    serialize_part_summary,
    serialize_piecework,
    serialize_review,
)
from reto.attribution.rules import DEST_SSGG
from reto.costing.exports import export_batch_csv, export_batch_xlsx
from reto.costing.services import compute_batch_summary, fmt_money
from reto.imports.models import ImportBatch, PieceworkProduction, PortCall, WagePart
from reto.reviews.services import ReviewError, submit_part_review


class NoStoreAPIView(APIView):
    def finalize_response(self, request, response, *args, **kwargs):
        resp = super().finalize_response(request, response, *args, **kwargs)
        patch_cache_control(resp, no_store=True, no_cache=True, must_revalidate=True)
        return resp


def _get_active_batch() -> ImportBatch | None:
    return ImportBatch.objects.filter(is_active=True).order_by("-id").first()


def _user_payload(user):
    if not user or not user.is_authenticated:
        return None
    return {
        "username": user.get_username(),
        "roles": get_user_roles(user),
    }


class SessionView(NoStoreAPIView):
    permission_classes = [AllowAny]

    def get(self, request):
        get_token(request)
        is_auth = bool(request.user and request.user.is_authenticated)
        return Response(
            {
                "authenticated": is_auth,
                "user": _user_payload(request.user) if is_auth else None,
            }
        )


class LoginView(NoStoreAPIView):
    permission_classes = [AllowAny]

    def post(self, request):
        ser = LoginInputSerializer(data=request.data)
        if not ser.is_valid():
            return Response(
                {"detail": "Credenciales inválidas o incompletas.", "code": "invalid_input"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user = authenticate(
            request,
            username=ser.validated_data["username"],
            password=ser.validated_data["password"],
        )
        if user is None:
            return Response(
                {"detail": "Usuario o contraseña incorrectos.", "code": "invalid_credentials"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        login(request, user)
        get_token(request)
        return Response(
            {
                "authenticated": True,
                "user": _user_payload(user),
            }
        )


class LogoutView(NoStoreAPIView):
    permission_classes = [AllowAny]

    def post(self, request):
        logout(request)
        get_token(request)
        return Response({"authenticated": False, "user": None})


class SummaryView(NoStoreAPIView):
    permission_classes = [IsAuthenticatedRead]

    def get(self, request):
        batch = _get_active_batch()
        if batch is None:
            return Response(
                {
                    "detail": "No hay ningún lote importado activo. Ejecute `python manage.py import_reto --data-dir RUTA`.",
                    "code": "no_active_batch",
                },
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(compute_batch_summary(batch))


class CallDetailView(NoStoreAPIView):
    permission_classes = [IsAuthenticatedRead]

    def get(self, request, call_id: str):
        batch = _get_active_batch()
        if batch is None:
            return Response(
                {"detail": "No hay lote activo.", "code": "no_active_batch"},
                status=status.HTTP_404_NOT_FOUND,
            )

        summary = compute_batch_summary(batch)

        if call_id == DEST_SSGG:
            call_obj = {
                "id": DEST_SSGG,
                "nave": "Servicios Generales de Terminal",
                "cliente": "Puerto Delta (Interno)",
                "tipo_carga": "Almacén y señalización interna",
                "muelle": "Almacén / Vías internas",
                "atraque": None,
                "desatraque": None,
                "jornales": summary["ssgg"]["jornales"],
                "jornal_usd": summary["ssgg"]["jornal_usd"],
                "destajo_usd": "0.00",
                "total_usd": summary["ssgg"]["jornal_usd"],
                "suggested_jornales": "0",
                "suggested_usd": "0.00",
                "parts": summary["ssgg"]["parts"],
                "piecework_lines": 0,
            }
        else:
            pc = PortCall.objects.filter(batch=batch, call_id=call_id).first()
            if pc is None:
                return Response(
                    {"detail": f"Recalada '{call_id}' no encontrada.", "code": "not_found"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            call_obj = next(c for c in summary["calls"] if c["id"] == call_id)

        confirmed_parts = (
            WagePart.objects.filter(
                batch=batch,
                status__in=[WagePart.STATUS_CONFIRMADO, WagePart.STATUS_VALIDADO],
                destination=call_id,
            )
            .select_related("ledger_line")
            .order_by("row_number")
        )
        suggested_parts = (
            WagePart.objects.filter(
                batch=batch,
                status__in=[WagePart.STATUS_SUGERIDO, WagePart.STATUS_PENDIENTE],
                suggested_destination=call_id,
            )
            .select_related("ledger_line")
            .order_by("row_number")
        )
        pieceworks = (
            PieceworkProduction.objects.filter(batch=batch, call_id=call_id)
            .select_related("ledger_line")
            .order_by("row_number")
        )

        jornal_usd = sum((p.ledger_line.amount_usd for p in confirmed_parts), Decimal("0.00"))
        destajo_usd = sum((pw.ledger_line.amount_usd for pw in pieceworks), Decimal("0.00"))

        return Response(
            {
                "call": call_obj,
                "parts": [serialize_part_summary(p) for p in confirmed_parts],
                "suggested_parts": [serialize_part_summary(p) for p in suggested_parts],
                "piecework": [serialize_piecework(pw) for pw in pieceworks],
                "totals": {
                    "jornal_usd": fmt_money(jornal_usd),
                    "destajo_usd": fmt_money(destajo_usd),
                    "total_usd": fmt_money(jornal_usd + destajo_usd),
                },
            }
        )


class PartListView(NoStoreAPIView):
    permission_classes = [IsAuthenticatedRead]

    def get(self, request):
        batch = _get_active_batch()
        if batch is None:
            return Response(
                {"detail": "No hay lote activo.", "code": "no_active_batch"},
                status=status.HTTP_404_NOT_FOUND,
            )

        qs = (
            WagePart.objects.filter(batch=batch)
            .select_related("ledger_line")
            .order_by("row_number")
        )

        status_filter = (request.query_params.get("status") or "").strip()
        if status_filter == "pendientes":
            qs = qs.filter(status__in=[WagePart.STATUS_SUGERIDO, WagePart.STATUS_PENDIENTE])
        elif status_filter:
            valid_statuses = {
                WagePart.STATUS_CONFIRMADO,
                WagePart.STATUS_VALIDADO,
                WagePart.STATUS_SUGERIDO,
                WagePart.STATUS_PENDIENTE,
            }
            if status_filter not in valid_statuses:
                return Response(
                    {"detail": f"Filtro status inválido: '{status_filter}'.", "code": "invalid_filter"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            qs = qs.filter(status=status_filter)

        call_filter = (request.query_params.get("call") or "").strip()
        if call_filter:
            from django.db.models import Q

            qs = qs.filter(
                Q(destination=call_filter) | Q(suggested_destination=call_filter)
            )

        items = [serialize_part_summary(p) for p in qs]
        return Response({"results": items, "count": len(items)})


class PartDetailView(NoStoreAPIView):
    permission_classes = [IsAuthenticatedRead]

    def get(self, request, part_id: int):
        batch = _get_active_batch()
        if batch is None:
            return Response(
                {"detail": "No hay lote activo.", "code": "no_active_batch"},
                status=status.HTTP_404_NOT_FOUND,
            )
        part = (
            WagePart.objects.filter(batch=batch, pk=part_id)
            .select_related("ledger_line", "active_review", "batch")
            .prefetch_related("reviews")
            .first()
        )
        if part is None:
            return Response(
                {"detail": "Parte no encontrado.", "code": "not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(
            serialize_part_detail(part, can_review=user_can_review(request.user))
        )


class PartReviewCreateView(NoStoreAPIView):
    permission_classes = [IsAuthenticatedRead, IsValidatorRole]

    def post(self, request, part_id: int):
        ser = ReviewInputSerializer(data=request.data)
        if not ser.is_valid():
            first_err = next(iter(ser.errors.values()))[0]
            return Response(
                {"detail": f"Datos de revisión inválidos: {first_err}", "code": "invalid_input"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        data = ser.validated_data
        try:
            result = submit_part_review(
                part_id=part_id,
                actor=request.user,
                destination=data.get("destination"),
                reason=data["reason"],
                reference=data.get("reference", ""),
                expected_version=data["expected_version"],
                operation_id=data["operation_id"],
            )
        except ReviewError as exc:
            return Response(
                {"detail": exc.detail, "code": exc.code},
                status=exc.status_code,
            )

        http_status = status.HTTP_200_OK if result.replayed else status.HTTP_201_CREATED
        return Response(
            {
                "part": serialize_part_detail(
                    result.part, can_review=user_can_review(request.user)
                ),
                "review": serialize_review(result.review),
                "replayed": result.replayed,
            },
            status=http_status,
        )


class ExportView(NoStoreAPIView):
    permission_classes = [IsAuthenticatedRead]

    def get(self, request, kind: str):
        batch = _get_active_batch()
        if batch is None:
            return Response(
                {"detail": "No hay lote activo.", "code": "no_active_batch"},
                status=status.HTTP_404_NOT_FOUND,
            )

        base_name = f"resultados_reto1_lote{batch.id}_v{batch.results_version}"
        if kind == "csv":
            payload = export_batch_csv(batch)
            resp = HttpResponse(payload, content_type="text/csv; charset=utf-8")
            resp["Content-Disposition"] = f'attachment; filename="{base_name}.csv"'
            patch_cache_control(resp, no_store=True, no_cache=True, must_revalidate=True)
            return resp
        if kind == "xlsx":
            payload = export_batch_xlsx(batch)
            resp = HttpResponse(
                payload,
                content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
            resp["Content-Disposition"] = f'attachment; filename="{base_name}.xlsx"'
            patch_cache_control(resp, no_store=True, no_cache=True, must_revalidate=True)
            return resp

        return Response(
            {"detail": f"Formato de exportación no soportado: '{kind}'.", "code": "invalid_export_kind"},
            status=status.HTTP_400_BAD_REQUEST,
        )
