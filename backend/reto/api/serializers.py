from __future__ import annotations

from typing import Any

from rest_framework import serializers

from reto.costing.services import fmt_money, fmt_qty
from reto.imports.models import PartReview, PieceworkProduction, WagePart
from reto.reviews.services import get_allowed_destinations


def serialize_piecework(pw: PieceworkProduction) -> dict[str, Any]:
    line = pw.ledger_line
    return {
        "id": pw.id,
        "ref": pw.ref,
        "call": pw.call_id,
        "fecha": pw.fecha.isoformat(),
        "turno": pw.turno,
        "cuadrilla": pw.cuadrilla,
        "concepto": pw.concepto,
        "personas": pw.personas,
        "toneladas": fmt_qty(pw.toneladas),
        "tarifa_usd": fmt_money(line.unit_rate_usd),
        "amount_usd": fmt_money(line.amount_usd),
    }


def serialize_review(review: PartReview) -> dict[str, Any]:
    return {
        "id": review.id,
        "operation_id": str(review.operation_id),
        "actor": review.actor_username,
        "created_at": review.created_at.strftime("%Y-%m-%dT%H:%M"),
        "from_status": review.from_status,
        "to_status": review.to_status,
        "from_destination": review.from_destination,
        "to_destination": review.to_destination,
        "reason": review.reason,
        "reference": review.reference,
        "version_before": review.version_before,
        "version_after": review.version_after,
    }


def serialize_part_summary(part: WagePart) -> dict[str, Any]:
    return {
        "id": part.id,
        "ref": part.ref,
        "row_number": part.row_number,
        "fecha": part.fecha.isoformat(),
        "turno": part.turno,
        "cuadrilla": part.cuadrilla,
        "tarea": part.tarea,
        "personas": part.personas,
        "jornales": fmt_qty(part.jornales),
        "supervisor": part.supervisor,
        "observacion": part.observacion,
        "status": part.status,
        "destination": part.destination,
        "suggested": part.suggested_destination,
        "strength": part.strength,
        "rule": part.rule_code,
        "reason": part.reason,
        "alerts": part.alerts or [],
        "amount_usd": fmt_money(part.ledger_line.amount_usd),
        "version": part.version,
    }


def serialize_part_detail(part: WagePart, *, can_review: bool) -> dict[str, Any]:
    data = serialize_part_summary(part)
    reviews = [serialize_review(r) for r in part.reviews.all().order_by("created_at", "id")]
    data.update(
        {
            "evidence": part.evidence or {},
            "candidates": part.candidates or [],
            "allowed_destinations": get_allowed_destinations(part.batch),
            "reviews": reviews,
            "can_review": can_review,
        }
    )
    return data


class LoginInputSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=256, trim_whitespace=False)


class ReviewInputSerializer(serializers.Serializer):
    destination = serializers.CharField(
        max_length=32, required=False, allow_null=True, allow_blank=True
    )
    reason = serializers.CharField(min_length=5, max_length=1000)
    reference = serializers.CharField(
        max_length=200, required=False, allow_blank=True, default=""
    )
    expected_version = serializers.IntegerField(min_value=1)
    operation_id = serializers.UUIDField()
