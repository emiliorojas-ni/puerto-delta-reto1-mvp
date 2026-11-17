from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation
import hashlib
import io
from pathlib import Path
from typing import Any

from django.db import transaction

from reto.attribution.services import apply_attribution_for_batch
from reto.costing.services import build_ledger_for_batch
from reto.imports.models import (
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

EXPECTED_HEADERS: dict[str, list[str]] = {
    "recaladas.csv": [
        "id_recalada",
        "nave",
        "tipo_carga",
        "cliente",
        "muelle",
        "atraque",
        "desatraque",
    ],
    "turnos.csv": ["turno", "hora_inicio", "hora_fin"],
    "cuadrillas.csv": ["cuadrilla", "id_trabajador"],
    "nombrada_diaria.csv": [
        "fecha",
        "turno",
        "cuadrilla",
        "id_trabajador",
        "frente_asignado",
    ],
    "partes_jornal.csv": [
        "fecha",
        "turno",
        "cuadrilla",
        "tarea",
        "personas",
        "jornales",
        "supervisor",
        "observacion",
    ],
    "produccion_destajo.csv": [
        "id_recalada",
        "fecha",
        "turno",
        "cuadrilla",
        "tipo_carga_destajo",
        "personas",
        "toneladas",
    ],
    "tarifario.csv": ["modalidad", "concepto", "unidad", "tarifa_usd"],
}


class ImportValidationError(Exception):
    def __init__(self, message: str, *, file: str | None = None, row: int | None = None) -> None:
        prefix = ""
        if file and row is not None:
            prefix = f"[{file}:{row}] "
        elif file:
            prefix = f"[{file}] "
        super().__init__(f"{prefix}{message}")
        self.file = file
        self.row = row
        self.raw_message = message


@dataclass
class ImportResult:
    batch: ImportBatch
    created: bool
    reused: bool


def _read_csv_file(path: Path, filename: str) -> tuple[str, list[tuple[int, dict[str, str]]]]:
    if not path.exists():
        raise ImportValidationError("Archivo requerido no encontrado.", file=filename)
    raw_bytes = path.read_bytes()
    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ImportValidationError(
            f"Codificación UTF-8 inválida: {exc}", file=filename
        ) from exc

    normalized_bytes = text.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")
    file_sha = hashlib.sha256(normalized_bytes).hexdigest()

    reader = csv.reader(io.StringIO(text))
    try:
        header = [h.strip() for h in next(reader)]
    except StopIteration as exc:
        raise ImportValidationError("Archivo vacío.", file=filename, row=1) from exc

    expected = EXPECTED_HEADERS[filename]
    if header != expected:
        raise ImportValidationError(
            f"Encabezados inválidos: se recibió {header} y se esperaba {expected}.",
            file=filename,
            row=1,
        )

    rows: list[tuple[int, dict[str, str]]] = []
    for idx, values in enumerate(reader, start=2):
        if not any(v.strip() for v in values):
            continue
        if len(values) != len(expected):
            raise ImportValidationError(
                f"Número de columnas inválido ({len(values)} vs {len(expected)}).",
                file=filename,
                row=idx,
            )
        row_dict = {col: val.strip() for col, val in zip(expected, values)}
        rows.append((idx, row_dict))

    return file_sha, rows


def _parse_date(val: str, filename: str, row_num: int, field: str) -> date:
    try:
        return datetime.strptime(val, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ImportValidationError(
            f"Fecha inválida en '{field}': '{val}' (esperado YYYY-MM-DD).",
            file=filename,
            row=row_num,
        ) from exc


def _parse_datetime(val: str, filename: str, row_num: int, field: str) -> datetime:
    try:
        return datetime.strptime(val, "%Y-%m-%d %H:%M")
    except ValueError as exc:
        raise ImportValidationError(
            f"Fecha/hora inválida en '{field}': '{val}' (esperado YYYY-MM-DD HH:MM).",
            file=filename,
            row=row_num,
        ) from exc


def _parse_shift_time(val: str, filename: str, row_num: int, field: str) -> tuple[time, bool]:
    """Normalize 24:00 to 00:00 of the next day (R1)."""
    if val == "24:00":
        return time(0, 0), True
    try:
        return datetime.strptime(val, "%H:%M").time(), False
    except ValueError as exc:
        raise ImportValidationError(
            f"Hora inválida en '{field}': '{val}' (esperado HH:MM o 24:00).",
            file=filename,
            row=row_num,
        ) from exc


def _parse_decimal(val: str, filename: str, row_num: int, field: str) -> Decimal:
    try:
        d = Decimal(val)
    except (InvalidOperation, ValueError) as exc:
        raise ImportValidationError(
            f"Valor decimal inválido en '{field}': '{val}'.",
            file=filename,
            row=row_num,
        ) from exc
    if d <= Decimal("0"):
        raise ImportValidationError(
            f"El valor de '{field}' debe ser positivo (recibido {val}).",
            file=filename,
            row=row_num,
        )
    return d


def _parse_positive_int(val: str, filename: str, row_num: int, field: str) -> int:
    try:
        iv = int(val)
    except ValueError as exc:
        raise ImportValidationError(
            f"Entero inválido en '{field}': '{val}'.",
            file=filename,
            row=row_num,
        ) from exc
    if iv <= 0:
        raise ImportValidationError(
            f"El entero en '{field}' debe ser > 0 (recibido {val}).",
            file=filename,
            row=row_num,
        )
    return iv


def import_reto_dataset(
    data_dir: str | Path, *, imported_by: str = "cli"
) -> ImportResult:
    """
    Stage, validate, and atomically import the 7 official CSV tables.
    - Reimporting an identical SHA-256 dataset returns the existing batch without creating rows.
    - Reimporting a modified dataset creates a new active batch and deactivates older batches atomically.
    - Any error rolls back the entire transaction without leaving partial batches.
    """
    base_dir = Path(data_dir)
    if not base_dir.is_dir():
        raise ImportValidationError(f"El directorio de datos no existe: {base_dir}")

    staged_rows: dict[str, list[tuple[int, dict[str, str]]]] = {}
    file_hashes: dict[str, dict[str, Any]] = {}
    bundle_hasher = hashlib.sha256()
    total_source_rows = 0

    for filename in sorted(EXPECTED_HEADERS.keys()):
        file_sha, rows = _read_csv_file(base_dir / filename, filename)
        staged_rows[filename] = rows
        file_hashes[filename] = {"sha256": file_sha, "rows": len(rows)}
        total_source_rows += len(rows)
        bundle_hasher.update(f"{filename}:{file_sha}\n".encode("utf-8"))

    bundle_sha = bundle_hasher.hexdigest()

    existing = ImportBatch.objects.filter(sha256=bundle_sha).first()
    if existing is not None:
        if not existing.is_active:
            with transaction.atomic():
                ImportBatch.objects.exclude(pk=existing.pk).update(is_active=False)
                existing.is_active = True
                existing.save(update_fields=["is_active"])
        return ImportResult(batch=existing, created=False, reused=True)

    with transaction.atomic():
        ImportBatch.objects.filter(is_active=True).update(is_active=False)
        batch = ImportBatch.objects.create(
            sha256=bundle_sha,
            source_rows=total_source_rows,
            is_active=True,
            results_version=1,
            file_hashes=file_hashes,
            imported_by=imported_by,
        )

        # 1. Shifts (turnos.csv)
        shifts_by_code: dict[str, Shift] = {}
        for row_num, r in staged_rows["turnos.csv"]:
            code = r["turno"]
            if code in shifts_by_code:
                raise ImportValidationError(
                    f"Turno duplicado '{code}'.", file="turnos.csv", row=row_num
                )
            h_ini, span_ini = _parse_shift_time(
                r["hora_inicio"], "turnos.csv", row_num, "hora_inicio"
            )
            if span_ini:
                raise ImportValidationError(
                    "hora_inicio no puede ser 24:00.", file="turnos.csv", row=row_num
                )
            h_fin, spans_next = _parse_shift_time(
                r["hora_fin"], "turnos.csv", row_num, "hora_fin"
            )
            sh = Shift.objects.create(
                batch=batch,
                row_number=row_num,
                code=code,
                hora_inicio=h_ini,
                hora_fin=h_fin,
                spans_next_day=spans_next,
            )
            shifts_by_code[code] = sh

        # 2. PortCalls (recaladas.csv)
        calls_by_id: dict[str, PortCall] = {}
        for row_num, r in staged_rows["recaladas.csv"]:
            cid = r["id_recalada"]
            if cid in calls_by_id:
                raise ImportValidationError(
                    f"id_recalada duplicada '{cid}'.", file="recaladas.csv", row=row_num
                )
            atraque = _parse_datetime(r["atraque"], "recaladas.csv", row_num, "atraque")
            desatraque = _parse_datetime(
                r["desatraque"], "recaladas.csv", row_num, "desatraque"
            )
            if desatraque <= atraque:
                raise ImportValidationError(
                    "desatraque debe ser posterior a atraque.",
                    file="recaladas.csv",
                    row=row_num,
                )
            pc = PortCall.objects.create(
                batch=batch,
                row_number=row_num,
                call_id=cid,
                nave=r["nave"],
                tipo_carga=r["tipo_carga"],
                cliente=r["cliente"],
                muelle=r["muelle"],
                atraque=atraque,
                desatraque=desatraque,
            )
            calls_by_id[cid] = pc

        # 3. Crews & CrewMembers (cuadrillas.csv) — R2: 6 members per crew, unique worker
        crews_by_code: dict[str, Crew] = {}
        worker_to_crew: dict[str, str] = {}
        members_per_crew: dict[str, int] = {}
        for row_num, r in staged_rows["cuadrillas.csv"]:
            c_code = r["cuadrilla"]
            w_id = r["id_trabajador"]
            if w_id in worker_to_crew:
                raise ImportValidationError(
                    f"Trabajador '{w_id}' ya pertenece a {worker_to_crew[w_id]} (R2).",
                    file="cuadrillas.csv",
                    row=row_num,
                )
            crew = crews_by_code.get(c_code)
            if crew is None:
                crew = Crew.objects.create(batch=batch, code=c_code)
                crews_by_code[c_code] = crew
            CrewMember.objects.create(
                batch=batch,
                crew=crew,
                row_number=row_num,
                worker_id=w_id,
            )
            worker_to_crew[w_id] = c_code
            members_per_crew[c_code] = members_per_crew.get(c_code, 0) + 1

        for c_code, cnt in members_per_crew.items():
            if cnt != 6:
                raise ImportValidationError(
                    f"La cuadrilla {c_code} tiene {cnt} integrantes en lugar de 6 (R2).",
                    file="cuadrillas.csv",
                )

        # 4. DailyCallUp & PlannedFrontSummary (nombrada_diaria.csv)
        # Aggregate the 6 members per (fecha, turno, cuadrilla) before joining parts.
        grouped_callups: dict[tuple[date, str, str], dict[str, Any]] = {}
        crew_shift_by_day: dict[tuple[date, str], str] = {}
        worker_day_seen: set[tuple[date, str]] = set()

        for row_num, r in staged_rows["nombrada_diaria.csv"]:
            fecha = _parse_date(r["fecha"], "nombrada_diaria.csv", row_num, "fecha")
            turno = r["turno"]
            if turno not in shifts_by_code:
                raise ImportValidationError(
                    f"Turno desconocido '{turno}'.", file="nombrada_diaria.csv", row=row_num
                )
            cuadrilla = r["cuadrilla"]
            if cuadrilla not in crews_by_code:
                raise ImportValidationError(
                    f"Cuadrilla desconocida '{cuadrilla}'.",
                    file="nombrada_diaria.csv",
                    row=row_num,
                )
            w_id = r["id_trabajador"]
            if worker_to_crew.get(w_id) != cuadrilla:
                raise ImportValidationError(
                    f"Trabajador '{w_id}' no pertenece a la cuadrilla '{cuadrilla}' (R2).",
                    file="nombrada_diaria.csv",
                    row=row_num,
                )
            if (fecha, w_id) in worker_day_seen:
                raise ImportValidationError(
                    f"Trabajador '{w_id}' convocado más de una vez el {fecha} (R2).",
                    file="nombrada_diaria.csv",
                    row=row_num,
                )
            worker_day_seen.add((fecha, w_id))

            prev_shift = crew_shift_by_day.get((fecha, cuadrilla))
            if prev_shift is not None and prev_shift != turno:
                raise ImportValidationError(
                    f"Cuadrilla '{cuadrilla}' convocada en múltiples turnos el {fecha} (R2).",
                    file="nombrada_diaria.csv",
                    row=row_num,
                )
            crew_shift_by_day[(fecha, cuadrilla)] = turno

            frente = r["frente_asignado"]
            callup = DailyCallUp.objects.create(
                batch=batch,
                row_number=row_num,
                fecha=fecha,
                turno=turno,
                cuadrilla=cuadrilla,
                worker_id=w_id,
                frente_asignado=frente,
            )

            ctx_key = (fecha, turno, cuadrilla)
            bucket = grouped_callups.setdefault(
                ctx_key, {"workers": 0, "frentes": [], "refs": []}
            )
            bucket["workers"] += 1
            if frente and frente not in bucket["frentes"]:
                bucket["frentes"].append(frente)
            bucket["refs"].append(callup.ref)

        for (fecha, turno, cuadrilla), info in grouped_callups.items():
            if info["workers"] != 6:
                raise ImportValidationError(
                    f"Nombrada de ({fecha}, {turno}, {cuadrilla}) tiene {info['workers']} trabajadores en lugar de 6 (R2).",
                    file="nombrada_diaria.csv",
                )
            PlannedFrontSummary.objects.create(
                batch=batch,
                fecha=fecha,
                turno=turno,
                cuadrilla=cuadrilla,
                worker_count=info["workers"],
                frentes=info["frentes"],
                nombrada_refs=info["refs"],
            )

        # 5. Tariffs (tarifario.csv)
        jornal_tariffs = 0
        destajo_tariffs: dict[str, Tariff] = {}
        for row_num, r in staged_rows["tarifario.csv"]:
            modalidad = r["modalidad"]
            concepto = r["concepto"]
            tarifa_usd = _parse_decimal(
                r["tarifa_usd"], "tarifario.csv", row_num, "tarifa_usd"
            )
            t = Tariff.objects.create(
                batch=batch,
                row_number=row_num,
                modalidad=modalidad,
                concepto=concepto,
                unidad=r["unidad"],
                tarifa_usd=tarifa_usd,
            )
            if modalidad == "Jornal":
                jornal_tariffs += 1
            elif modalidad == "Destajo":
                destajo_tariffs[concepto] = t
            else:
                raise ImportValidationError(
                    f"Modalidad desconocida '{modalidad}'.",
                    file="tarifario.csv",
                    row=row_num,
                )

        if jornal_tariffs != 1:
            raise ImportValidationError(
                f"Se requiere exactamente 1 tarifa de Jornal (encontradas: {jornal_tariffs}).",
                file="tarifario.csv",
            )

        # 6. WageParts (partes_jornal.csv)
        for row_num, r in staged_rows["partes_jornal.csv"]:
            fecha = _parse_date(r["fecha"], "partes_jornal.csv", row_num, "fecha")
            turno = r["turno"]
            if turno not in shifts_by_code:
                raise ImportValidationError(
                    f"Turno inválido '{turno}'.", file="partes_jornal.csv", row=row_num
                )
            cuadrilla = r["cuadrilla"]
            if cuadrilla not in crews_by_code:
                raise ImportValidationError(
                    f"Cuadrilla inválida '{cuadrilla}'.",
                    file="partes_jornal.csv",
                    row=row_num,
                )
            personas = _parse_positive_int(
                r["personas"], "partes_jornal.csv", row_num, "personas"
            )
            jornales = _parse_decimal(
                r["jornales"], "partes_jornal.csv", row_num, "jornales"
            )
            if not r["tarea"]:
                raise ImportValidationError(
                    "Tarea vacía.", file="partes_jornal.csv", row=row_num
                )
            if not r["supervisor"]:
                raise ImportValidationError(
                    "Supervisor vacío.", file="partes_jornal.csv", row=row_num
                )
            WagePart.objects.create(
                batch=batch,
                row_number=row_num,
                fecha=fecha,
                turno=turno,
                cuadrilla=cuadrilla,
                tarea=r["tarea"],
                personas=personas,
                jornales=jornales,
                supervisor=r["supervisor"],
                observacion=r["observacion"],
            )

        # 7. PieceworkProduction (produccion_destajo.csv)
        for row_num, r in staged_rows["produccion_destajo.csv"]:
            cid = r["id_recalada"]
            pc = calls_by_id.get(cid)
            if pc is None:
                raise ImportValidationError(
                    f"id_recalada desconocida '{cid}'.",
                    file="produccion_destajo.csv",
                    row=row_num,
                )
            fecha = _parse_date(
                r["fecha"], "produccion_destajo.csv", row_num, "fecha"
            )
            turno = r["turno"]
            if turno not in shifts_by_code:
                raise ImportValidationError(
                    f"Turno inválido '{turno}'.",
                    file="produccion_destajo.csv",
                    row=row_num,
                )
            cuadrilla = r["cuadrilla"]
            if cuadrilla not in crews_by_code:
                raise ImportValidationError(
                    f"Cuadrilla inválida '{cuadrilla}'.",
                    file="produccion_destajo.csv",
                    row=row_num,
                )
            concepto = r["tipo_carga_destajo"]
            if concepto not in destajo_tariffs:
                raise ImportValidationError(
                    f"Concepto de destajo sin tarifa en tarifario.csv: '{concepto}'.",
                    file="produccion_destajo.csv",
                    row=row_num,
                )
            personas = _parse_positive_int(
                r["personas"], "produccion_destajo.csv", row_num, "personas"
            )
            toneladas = _parse_decimal(
                r["toneladas"], "produccion_destajo.csv", row_num, "toneladas"
            )
            PieceworkProduction.objects.create(
                batch=batch,
                row_number=row_num,
                port_call=pc,
                call_id=cid,
                fecha=fecha,
                turno=turno,
                cuadrilla=cuadrilla,
                concepto=concepto,
                personas=personas,
                toneladas=toneladas,
            )

        apply_attribution_for_batch(batch)
        build_ledger_for_batch(batch)

    return ImportResult(batch=batch, created=True, reused=False)
