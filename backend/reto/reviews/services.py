from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import uuid

from django.db import IntegrityError, OperationalError, transaction
from django.db.models import F

from reto.attribution.rules import DEST_SSGG
from reto.imports.models import ImportBatch, PartReview, PortCall, WagePart


class ReviewError(Exception):
    status_code: int = 400
    code: str = "invalid_review"

    def __init__(self, detail: str, *, code: str | None = None, status_code: int | None = None):
        super().__init__(detail)
        self.detail = detail
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code


class ReviewConflictError(ReviewError):
    status_code = 409
    code = "version_conflict"


class ReviewNotFoundError(ReviewError):
    status_code = 404
    code = "not_found"


@dataclass
class ReviewSubmissionResult:
    part: WagePart
    review: PartReview
    replayed: bool


def _compute_payload_hash(
    *,
    part_id: int,
    destination: str | None,
    reason: str,
    reference: str,
    expected_version: int,
) -> str:
    canonical = json.dumps(
        {
            "part_id": part_id,
            "destination": destination,
            "reason": reason,
            "reference": reference,
            "expected_version": expected_version,
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def get_allowed_destinations(batch: ImportBatch) -> list[str]:
    calls = list(
        PortCall.objects.filter(batch=batch)
        .order_by("call_id")
        .values_list("call_id", flat=True)
    )
    return calls + [DEST_SSGG]


def submit_part_review(
    *,
    part_id: int,
    actor,
    destination: str | None,
    reason: str,
    reference: str = "",
    expected_version: int,
    operation_id: uuid.UUID,
) -> ReviewSubmissionResult:
    """
    Atomically record an auditable review decision on a WagePart:
    - Uses select_for_update() row lock inside transaction.atomic().
    - Idempotent replay if operation_id matches the exact same payload_hash (returns 200 replayed=True).
    - 409 operation_reused if operation_id was already used with a different payload.
    - 409 version_conflict if part.version != expected_version.
    - Never modifies the monetary amount of the WagePart or CostLedgerLine.
    - Links active_review to the new PartReview when status is validado, or clears active_review
      when marked back as pendiente (so a destination change never inherits an older approval).
    """
    clean_reason = (reason or "").strip()
    clean_ref = (reference or "").strip()
    clean_dest = destination.strip() if isinstance(destination, str) and destination.strip() else None

    if len(clean_reason) < 5:
        raise ReviewError(
            "El motivo de la revisión es obligatorio y debe tener al menos 5 caracteres.",
            code="invalid_reason",
            status_code=400,
        )
    if len(clean_ref) > 200:
        raise ReviewError(
            "La referencia no puede exceder 200 caracteres.",
            code="invalid_reference",
            status_code=400,
        )

    payload_hash = _compute_payload_hash(
        part_id=part_id,
        destination=clean_dest,
        reason=clean_reason,
        reference=clean_ref,
        expected_version=expected_version,
    )

    try:
        with transaction.atomic():
            existing_review = (
                PartReview.objects.select_related("wage_part", "wage_part__ledger_line")
                .filter(operation_id=operation_id)
                .first()
            )
            if existing_review is not None:
                if (
                    existing_review.payload_hash == payload_hash
                    and existing_review.wage_part_id == part_id
                ):
                    part = (
                        WagePart.objects.select_related("ledger_line", "active_review", "batch")
                        .get(pk=part_id)
                    )
                    return ReviewSubmissionResult(
                        part=part, review=existing_review, replayed=True
                    )
                raise ReviewConflictError(
                    "El operation_id ya fue utilizado con parámetros distintos.",
                    code="operation_reused",
                )

            try:
                part = (
                    WagePart.objects.select_for_update()
                    .select_related("batch", "ledger_line")
                    .get(pk=part_id, batch__is_active=True)
                )
            except WagePart.DoesNotExist as exc:
                raise ReviewNotFoundError("Parte de jornal no encontrado en el lote activo.") from exc

            allowed = get_allowed_destinations(part.batch)
            if clean_dest is not None and clean_dest not in allowed:
                raise ReviewError(
                    f"Destino inválido '{clean_dest}'. Destinos permitidos: {', '.join(allowed)} o null.",
                    code="invalid_destination",
                    status_code=400,
                )

            if part.version != expected_version:
                raise ReviewConflictError(
                    f"Versión vencida: se envió expected_version={expected_version} y la fila está en versión {part.version}.",
                    code="version_conflict",
                )

            from_status = part.status
            from_dest = part.destination
            new_version = part.version + 1

            if clean_dest is not None:
                to_status = WagePart.STATUS_VALIDADO
                to_dest = clean_dest
            else:
                to_status = WagePart.STATUS_PENDIENTE
                to_dest = None

            try:
                review = PartReview.objects.create(
                    wage_part=part,
                    operation_id=operation_id,
                    payload_hash=payload_hash,
                    actor=actor,
                    actor_username=actor.get_username(),
                    from_status=from_status,
                    to_status=to_status,
                    from_destination=from_dest,
                    to_destination=to_dest,
                    reason=clean_reason,
                    reference=clean_ref,
                    version_before=part.version,
                    version_after=new_version,
                    amount_usd_snapshot=part.ledger_line.amount_usd,
                )
            except IntegrityError as exc:
                raise ReviewConflictError(
                    "Conflicto de concurrencia al registrar operation_id.",
                    code="operation_reused",
                ) from exc

            part.status = to_status
            part.destination = to_dest
            part.version = new_version
            part.reason = clean_reason
            part.active_review = review if to_status == WagePart.STATUS_VALIDADO else None
            part.save(
                update_fields=[
                    "status",
                    "destination",
                    "version",
                    "reason",
                    "active_review",
                ]
            )

            ImportBatch.objects.filter(pk=part.batch_id).update(
                results_version=F("results_version") + 1
            )
            part.batch.refresh_from_db(fields=["results_version"])
    except OperationalError as exc:
        raise ReviewConflictError(
            "El registro está siendo actualizado por otra operación concurrente.",
            code="version_conflict",
        ) from exc

    return ReviewSubmissionResult(part=part, review=review, replayed=False)
