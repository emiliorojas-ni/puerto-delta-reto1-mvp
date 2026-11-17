from __future__ import annotations

from decimal import Decimal
import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


class ImportBatch(models.Model):
    sha256 = models.CharField(max_length=64, unique=True)
    source_rows = models.PositiveIntegerField()
    is_active = models.BooleanField(default=True, db_index=True)
    results_version = models.PositiveIntegerField(default=1)
    file_hashes = models.JSONField(default=dict)
    imported_by = models.CharField(max_length=64, default="cli")
    imported_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-imported_at", "-id"]

    def __str__(self) -> str:
        return f"Lote #{self.id} ({self.sha256[:12]})"


class PortCall(models.Model):
    batch = models.ForeignKey(ImportBatch, on_delete=models.CASCADE, related_name="port_calls")
    source_file = models.CharField(max_length=64, default="recaladas.csv")
    row_number = models.PositiveIntegerField()
    call_id = models.CharField(max_length=32)
    nave = models.CharField(max_length=128)
    tipo_carga = models.CharField(max_length=255)
    cliente = models.CharField(max_length=128)
    muelle = models.CharField(max_length=64)
    atraque = models.DateTimeField()
    desatraque = models.DateTimeField()

    class Meta:
        ordering = ["call_id"]
        constraints = [
            models.UniqueConstraint(fields=["batch", "call_id"], name="uniq_portcall_batch_callid"),
            models.UniqueConstraint(
                fields=["batch", "source_file", "row_number"],
                name="uniq_portcall_provenance",
            ),
        ]

    @property
    def ref(self) -> str:
        return f"{self.source_file}:{self.row_number}"


class Shift(models.Model):
    batch = models.ForeignKey(ImportBatch, on_delete=models.CASCADE, related_name="shifts")
    source_file = models.CharField(max_length=64, default="turnos.csv")
    row_number = models.PositiveIntegerField()
    code = models.CharField(max_length=8)
    hora_inicio = models.TimeField()
    hora_fin = models.TimeField()
    spans_next_day = models.BooleanField(default=False)

    class Meta:
        ordering = ["code"]
        constraints = [
            models.UniqueConstraint(fields=["batch", "code"], name="uniq_shift_batch_code"),
            models.UniqueConstraint(
                fields=["batch", "source_file", "row_number"],
                name="uniq_shift_provenance",
            ),
        ]


class Crew(models.Model):
    batch = models.ForeignKey(ImportBatch, on_delete=models.CASCADE, related_name="crews")
    code = models.CharField(max_length=16)

    class Meta:
        ordering = ["code"]
        constraints = [
            models.UniqueConstraint(fields=["batch", "code"], name="uniq_crew_batch_code"),
        ]


class CrewMember(models.Model):
    batch = models.ForeignKey(ImportBatch, on_delete=models.CASCADE, related_name="crew_members")
    crew = models.ForeignKey(Crew, on_delete=models.CASCADE, related_name="members")
    source_file = models.CharField(max_length=64, default="cuadrillas.csv")
    row_number = models.PositiveIntegerField()
    worker_id = models.CharField(max_length=32)

    class Meta:
        ordering = ["worker_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["batch", "worker_id"],
                name="uniq_crewmember_batch_worker",
            ),
            models.UniqueConstraint(
                fields=["batch", "source_file", "row_number"],
                name="uniq_crewmember_provenance",
            ),
        ]


class DailyCallUp(models.Model):
    batch = models.ForeignKey(ImportBatch, on_delete=models.CASCADE, related_name="callups")
    source_file = models.CharField(max_length=64, default="nombrada_diaria.csv")
    row_number = models.PositiveIntegerField()
    fecha = models.DateField()
    turno = models.CharField(max_length=8)
    cuadrilla = models.CharField(max_length=16)
    worker_id = models.CharField(max_length=32)
    frente_asignado = models.CharField(max_length=64, blank=True, default="")

    class Meta:
        ordering = ["row_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["batch", "source_file", "row_number"],
                name="uniq_callup_provenance",
            ),
            models.UniqueConstraint(
                fields=["batch", "fecha", "worker_id"],
                name="uniq_callup_worker_per_day",
            ),
        ]

    @property
    def ref(self) -> str:
        return f"{self.source_file}:{self.row_number}"


class PlannedFrontSummary(models.Model):
    """Aggregated 6-worker call-up per (batch, fecha, turno, cuadrilla) to prevent row multiplication."""

    batch = models.ForeignKey(
        ImportBatch, on_delete=models.CASCADE, related_name="planned_front_summaries"
    )
    fecha = models.DateField()
    turno = models.CharField(max_length=8)
    cuadrilla = models.CharField(max_length=16)
    worker_count = models.PositiveIntegerField()
    frentes = models.JSONField(default=list)
    nombrada_refs = models.JSONField(default=list)

    class Meta:
        ordering = ["fecha", "turno", "cuadrilla"]
        constraints = [
            models.UniqueConstraint(
                fields=["batch", "fecha", "turno", "cuadrilla"],
                name="uniq_planned_front_context",
            ),
            models.UniqueConstraint(
                fields=["batch", "fecha", "cuadrilla"],
                name="uniq_crew_one_shift_per_day",
            ),
        ]


class Tariff(models.Model):
    batch = models.ForeignKey(ImportBatch, on_delete=models.CASCADE, related_name="tariffs")
    source_file = models.CharField(max_length=64, default="tarifario.csv")
    row_number = models.PositiveIntegerField()
    modalidad = models.CharField(max_length=32)
    concepto = models.CharField(max_length=128)
    unidad = models.CharField(max_length=32)
    tarifa_usd = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        ordering = ["row_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["batch", "modalidad", "concepto"],
                name="uniq_tariff_batch_mod_concepto",
            ),
            models.UniqueConstraint(
                fields=["batch", "source_file", "row_number"],
                name="uniq_tariff_provenance",
            ),
        ]


class WagePart(models.Model):
    STATUS_CONFIRMADO = "confirmado"
    STATUS_VALIDADO = "validado"
    STATUS_SUGERIDO = "sugerido"
    STATUS_PENDIENTE = "pendiente"

    STATUS_CHOICES = [
        (STATUS_CONFIRMADO, "Confirmado"),
        (STATUS_VALIDADO, "Validado"),
        (STATUS_SUGERIDO, "Sugerido"),
        (STATUS_PENDIENTE, "Pendiente"),
    ]

    batch = models.ForeignKey(ImportBatch, on_delete=models.CASCADE, related_name="wage_parts")
    source_file = models.CharField(max_length=64, default="partes_jornal.csv")
    row_number = models.PositiveIntegerField()

    fecha = models.DateField()
    turno = models.CharField(max_length=8)
    cuadrilla = models.CharField(max_length=16)
    tarea = models.CharField(max_length=128)
    personas = models.PositiveIntegerField()
    jornales = models.DecimalField(max_digits=8, decimal_places=2)
    supervisor = models.CharField(max_length=64)
    observacion = models.TextField(blank=True, default="")

    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_PENDIENTE)
    destination = models.CharField(max_length=32, null=True, blank=True)
    suggested_destination = models.CharField(max_length=32, null=True, blank=True)
    strength = models.CharField(max_length=16, null=True, blank=True)
    rule_code = models.CharField(max_length=64, default="UNASSIGNED")
    rule_version = models.CharField(max_length=16, default="1.0")
    reason = models.TextField(default="")
    candidates = models.JSONField(default=list)
    evidence = models.JSONField(default=dict)
    alerts = models.JSONField(default=list)

    version = models.PositiveIntegerField(default=1)
    active_review = models.ForeignKey(
        "PartReview",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    class Meta:
        ordering = ["row_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["batch", "source_file", "row_number"],
                name="uniq_wagepart_provenance",
            ),
        ]

    @property
    def ref(self) -> str:
        return f"{self.source_file}:{self.row_number}"


class PieceworkProduction(models.Model):
    batch = models.ForeignKey(
        ImportBatch, on_delete=models.CASCADE, related_name="piecework_productions"
    )
    source_file = models.CharField(max_length=64, default="produccion_destajo.csv")
    row_number = models.PositiveIntegerField()

    port_call = models.ForeignKey(
        PortCall, on_delete=models.PROTECT, related_name="piecework_lines"
    )
    call_id = models.CharField(max_length=32)
    fecha = models.DateField()
    turno = models.CharField(max_length=8)
    cuadrilla = models.CharField(max_length=16)
    concepto = models.CharField(max_length=128)
    personas = models.PositiveIntegerField()
    toneladas = models.DecimalField(max_digits=12, decimal_places=3)

    class Meta:
        ordering = ["row_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["batch", "source_file", "row_number"],
                name="uniq_piecework_provenance",
            ),
        ]

    @property
    def ref(self) -> str:
        return f"{self.source_file}:{self.row_number}"


class CostLedgerLine(models.Model):
    MODALIDAD_JORNAL = "Jornal"
    MODALIDAD_DESTAJO = "Destajo"

    batch = models.ForeignKey(ImportBatch, on_delete=models.CASCADE, related_name="ledger_lines")
    ref = models.CharField(max_length=96)
    modalidad = models.CharField(max_length=24)
    wage_part = models.OneToOneField(
        WagePart,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="ledger_line",
    )
    piecework = models.OneToOneField(
        PieceworkProduction,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="ledger_line",
    )
    tariff = models.ForeignKey(Tariff, on_delete=models.PROTECT, related_name="ledger_lines")
    quantity = models.DecimalField(max_digits=12, decimal_places=3)
    unit_rate_usd = models.DecimalField(max_digits=10, decimal_places=2)
    amount_usd = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["batch", "ref"], name="uniq_ledger_batch_ref"),
            models.CheckConstraint(
                condition=(
                    (Q(wage_part__isnull=False) & Q(piecework__isnull=True))
                    | (Q(wage_part__isnull=True) & Q(piecework__isnull=False))
                ),
                name="chk_ledger_exactly_one_origin",
            ),
        ]


class PartReview(models.Model):
    wage_part = models.ForeignKey(WagePart, on_delete=models.CASCADE, related_name="reviews")
    operation_id = models.UUIDField(default=uuid.uuid4, unique=True)
    payload_hash = models.CharField(max_length=64)

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="part_reviews",
    )
    actor_username = models.CharField(max_length=150)
    created_at = models.DateTimeField(auto_now_add=True)

    from_status = models.CharField(max_length=24)
    to_status = models.CharField(max_length=24)
    from_destination = models.CharField(max_length=32, null=True, blank=True)
    to_destination = models.CharField(max_length=32, null=True, blank=True)

    reason = models.TextField()
    reference = models.CharField(max_length=200, blank=True, default="")

    version_before = models.PositiveIntegerField()
    version_after = models.PositiveIntegerField()
    amount_usd_snapshot = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0.00")
    )

    class Meta:
        ordering = ["created_at", "id"]
