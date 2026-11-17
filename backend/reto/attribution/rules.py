from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import Decimal
import re
import unicodedata
from typing import Any

RULE_VERSION = "1.2-peru"
DEST_SSGG = "REC-SSGG"

SSGG_TASKS = {
    "barrido almacen": "R8_SSGG_BARRIDO_ALMACEN",
    "apoyo en senalizacion": "R8_SSGG_SENALIZACION",
}

CALL_ALIASES: list[tuple[str, str, str]] = [
    ("orion bay", "REC-2051", "alias"),
    ("orio bay", "REC-2051", "alias"),
    ("orion", "REC-2051", "alias"),
    ("north crest", "REC-2052", "alias"),
    ("n. crest", "REC-2052", "alias"),
    ("n crest", "REC-2052", "alias"),
    ("north", "REC-2052", "alias"),
    ("santa lucia", "REC-2053", "alias"),
]

MUELLE_PATTERNS: list[tuple[re.Pattern[str], str, str]] = [
    (re.compile(r"\b(?:muelle\s*1|m-?1)\b"), "Muelle 1", "muelle"),
    (re.compile(r"\b(?:muelle\s*2|m-?2)\b"), "Muelle 2", "muelle"),
    (re.compile(r"\b(?:muelle\s*3|m-?3)\b"), "Muelle 3", "muelle"),
]


def normalize_text(value: str) -> str:
    if not value:
        return ""
    decomposed = unicodedata.normalize("NFD", value.strip().lower())
    without_accents = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", without_accents).strip()


def compute_shift_interval(
    fecha: date, hora_inicio: time, hora_fin: time, spans_next_day: bool
) -> tuple[datetime, datetime]:
    start_dt = datetime.combine(fecha, hora_inicio)
    end_date = fecha + timedelta(days=1) if spans_next_day else fecha
    end_dt = datetime.combine(end_date, hora_fin)
    return start_dt, end_dt


def compute_overlap_minutes(
    shift_start: datetime, shift_end: datetime, atraque: datetime, desatraque: datetime
) -> int:
    start = max(shift_start, atraque)
    end = min(shift_end, desatraque)
    if end <= start:
        return 0
    return int((end - start).total_seconds() // 60)


@dataclass
class AttributionOutcome:
    status: str
    destination: str | None
    suggested_destination: str | None
    strength: str | None
    rule_code: str
    rule_version: str
    reason: str
    candidates: list[str] = field(default_factory=list)
    evidence: dict[str, Any] = field(default_factory=dict)
    alerts: list[dict[str, str]] = field(default_factory=list)


def match_observation_tokens(
    raw_obs: str, muelle_to_calls: dict[str, list[str]]
) -> tuple[str, list[dict[str, str]]]:
    norm = normalize_text(raw_obs)
    if not norm:
        return "", []

    matches: list[dict[str, str]] = []
    seen_calls_terms: set[tuple[str, str]] = set()

    for term, call_id, kind in CALL_ALIASES:
        pattern = re.compile(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])")
        if pattern.search(norm):
            # Avoid adding shorter substring alias if a more specific alias for same call matched
            if any(m["call"] == call_id and term in m["term"] for m in matches):
                continue
            key = (call_id, term)
            if key not in seen_calls_terms:
                seen_calls_terms.add(key)
                matches.append({"call": call_id, "by": kind, "term": term})

    for pattern, muelle_name, kind in MUELLE_PATTERNS:
        m = pattern.search(norm)
        if m:
            for call_id in muelle_to_calls.get(muelle_name, []):
                key = (call_id, m.group(0))
                if key not in seen_calls_terms:
                    seen_calls_terms.add(key)
                    matches.append({"call": call_id, "by": kind, "term": m.group(0)})

    return norm, matches


def evaluate_part_attribution(
    *,
    tarea: str,
    personas: int,
    jornales: Decimal,
    observacion: str,
    shift_start: datetime,
    shift_end: datetime,
    port_calls: list[dict[str, Any]],
    planned_frentes: list[str],
    nombrada_refs: list[str],
    piecework_items: list[dict[str, Any]],
) -> AttributionOutcome:
    """
    Evaluate a single WagePart row following R1–R13 and the conservative MVP policy:
    1. R5: alert when jornales > personas (preserve paid jornales).
    2. R8: tipified general service tasks -> confirmado REC-SSGG.
    3. R7/R9: explicit observation identifying a single active port call -> confirmado.
       If observation contradicts planned front or piecework, R7 note prevails and adds alert.
       If observation points outside active windows or to multiple calls -> pendiente.
    4. Empty or generic observation:
       - If generic closing phrase ('final de nave') with unique active window + piecework + front -> sugerido (fuerte).
       - If piecework + planned front agree on a single active call -> sugerido (fuerte).
       - If only planned front points to a single active call -> sugerido (debil).
       - Otherwise -> pendiente with all active window candidates.
    """
    alerts: list[dict[str, str]] = []
    if jornales > Decimal(personas):
        alerts.append(
            {
                "code": "JORNALES_GT_PERSONAS",
                "message": (
                    f"{jornales:g} jornales registrados para {personas} personas (R5). "
                    "Se conserva el importe pagado y se solicita aclaración."
                ),
            }
        )

    muelle_to_calls: dict[str, list[str]] = {}
    windows_evidence: list[dict[str, Any]] = []
    active_calls: list[str] = []

    for pc in port_calls:
        cid = pc["call_id"]
        muelle_to_calls.setdefault(pc["muelle"], []).append(cid)
        overlap = compute_overlap_minutes(shift_start, shift_end, pc["atraque"], pc["desatraque"])
        is_active = overlap > 0
        if is_active:
            active_calls.append(cid)
        windows_evidence.append(
            {
                "call": cid,
                "nave": pc["nave"],
                "muelle": pc["muelle"],
                "overlap_minutes": overlap,
                "active": is_active,
            }
        )

    norm_obs, obs_matches = match_observation_tokens(observacion, muelle_to_calls)

    # Planned front -> candidate call (only if front is a berth with an active call in this shift)
    planned_calls: list[str] = []
    for frente in planned_frentes:
        for cid in muelle_to_calls.get(frente, []):
            if cid in active_calls and cid not in planned_calls:
                planned_calls.append(cid)
    planned_call = planned_calls[0] if len(planned_calls) == 1 else None

    piecework_calls: list[str] = []
    for pw in piecework_items:
        if pw["call"] not in piecework_calls:
            piecework_calls.append(pw["call"])

    evidence: dict[str, Any] = {
        "shift": {
            "start": shift_start.strftime("%Y-%m-%dT%H:%M"),
            "end": shift_end.strftime("%Y-%m-%dT%H:%M"),
        },
        "observation": {
            "raw": observacion,
            "normalized": norm_obs,
            "matches": obs_matches,
        },
        "planned_front": {
            "frentes": planned_frentes,
            "call": planned_call,
            "nombrada_refs": nombrada_refs,
        },
        "piecework": piecework_items,
        "windows": windows_evidence,
    }

    norm_task = normalize_text(tarea)

    # A recorded empty front is SSGG only without a note identifying a vessel.
    # Missing call-up is different from a recorded call-up with an empty front.
    if nombrada_refs and not obs_matches and (not planned_frentes or all(not normalize_text(f) for f in planned_frentes)):
        return AttributionOutcome(
            status="confirmado", destination=DEST_SSGG,
            suggested_destination=None, strength=None,
            rule_code="SSGG_FRENTE_VACIO", rule_version=RULE_VERSION,
            reason="La nombrada tiene frente vacío y la observación no identifica una nave. Se clasifica como servicios generales según la aclaración del equipo (Perú.pdf).",
            candidates=[DEST_SSGG], evidence=evidence, alerts=alerts,
        )

    # User clarification in Perú.pdf: warehouse work is general services.
    if "almacen" in norm_task or any(normalize_text(f) == "almacen" for f in planned_frentes):
        if norm_task not in SSGG_TASKS:
            return AttributionOutcome(
                status="confirmado", destination=DEST_SSGG,
                suggested_destination=None, strength=None,
                rule_code="SSGG_FRENTE_ALMACEN", rule_version=RULE_VERSION,
                reason="Frente o tarea de almacén clasificado como servicios generales según la aclaración del equipo (Perú.pdf).",
                candidates=[DEST_SSGG], evidence=evidence, alerts=alerts,
            )

    # Step 1: Tipified SSGG tasks (R8)
    if norm_task in SSGG_TASKS:
        rule_code = SSGG_TASKS[norm_task]
        if planned_frentes and any(normalize_text(f) == "almacen" for f in planned_frentes) and norm_obs:
            reason = (
                f"Tarea de servicios generales ({tarea}) con nota de ámbito interno "
                f"(frente en nombrada: {', '.join(planned_frentes)}). Se imputa a {DEST_SSGG} (R8)."
            )
        else:
            reason = f"Tarea tipificada de servicios generales ({tarea}) imputada a {DEST_SSGG} (R8)."
        return AttributionOutcome(
            status="confirmado",
            destination=DEST_SSGG,
            suggested_destination=None,
            strength=None,
            rule_code=rule_code,
            rule_version=RULE_VERSION,
            reason=reason,
            candidates=[DEST_SSGG],
            evidence=evidence,
            alerts=alerts,
        )

    # Step 2: Explicit observation matches (R7 / R9)
    matched_calls = list(dict.fromkeys(m["call"] for m in obs_matches))
    if len(matched_calls) == 1:
        target_call = matched_calls[0]
        if target_call in active_calls:
            if planned_call and planned_call != target_call:
                alerts.append(
                    {
                        "code": "OBS_OVERRIDES_PLAN",
                        "message": (
                            f"La evidencia ejecutada en observación ({target_call}) contradice "
                            f"el frente planificado ({', '.join(planned_frentes)} → {planned_call}) "
                            "y prevalece por Regla R7."
                        ),
                    }
                )
            elif piecework_calls and target_call not in piecework_calls:
                alerts.append(
                    {
                        "code": "OBS_DIFFERS_PIECEWORK",
                        "message": (
                            f"La observación ({target_call}) difiere del destajo "
                            f"de la cuadrilla en el turno ({', '.join(piecework_calls)})."
                        ),
                    }
                )
            if not planned_frentes:
                alerts.append(
                    {
                        "code": "EMPTY_PLANNED_FRONT",
                        "message": "Frente asignado vacío en nombrada diaria; atribución respaldada por observación.",
                    }
                )

            by_kinds = {m["by"] for m in obs_matches}
            if norm_task == "en espera":
                rule_code = "R9_ESPERA_CAUSA_OBSERVADA"
                reason = (
                    f"Tiempo en espera con causa explícita en observación "
                    f"imputado a {target_call} con ventana activa (R9)."
                )
            elif "alias" in by_kinds:
                rule_code = "R7_NOTA_NAVE"
                reason = (
                    f"La observación identifica inequívocamente la nave de {target_call} "
                    f"y corrobora solape activo en el turno (R7)."
                )
            else:
                rule_code = "R7_NOTA_MUELLE"
                reason = (
                    f"La observación indica el muelle de ejecución "
                    f"con única recalada activa {target_call} en el turno (R7)."
                )

            candidates = [target_call] + [c for c in active_calls if c != target_call]
            return AttributionOutcome(
                status="confirmado",
                destination=target_call,
                suggested_destination=None,
                strength=None,
                rule_code=rule_code,
                rule_version=RULE_VERSION,
                reason=reason,
                candidates=candidates,
                evidence=evidence,
                alerts=alerts,
            )
        else:
            alerts.append(
                {
                    "code": "OBS_OUTSIDE_WINDOW",
                    "message": (
                        f"La observación apunta a {target_call}, pero la nave no tiene solape activo en el turno."
                    ),
                }
            )
            return AttributionOutcome(
                status="pendiente",
                destination=None,
                suggested_destination=target_call,
                strength="debil",
                rule_code="R13_NOTA_FUERA_DE_VENTANA",
                rule_version=RULE_VERSION,
                reason=(
                    f"La observación menciona {target_call} fuera de su ventana de atraque. "
                    "Se escala a revisión del área solicitante."
                ),
                candidates=[target_call] + [c for c in active_calls if c != target_call],
                evidence=evidence,
                alerts=alerts,
            )

    if len(matched_calls) > 1:
        alerts.append(
            {
                "code": "MULTIPLE_CALLS_IN_OBS",
                "message": f"La observación menciona múltiples destinos posibles: {', '.join(matched_calls)}.",
            }
        )
        return AttributionOutcome(
            status="pendiente",
            destination=None,
            suggested_destination=None,
            strength=None,
            rule_code="R13_NOTA_MULTIPLE_AMBIGUA",
            rule_version=RULE_VERSION,
            reason="Observación con múltiples referencias de nave/muelle; requiere validación humana.",
            candidates=matched_calls,
            evidence=evidence,
            alerts=alerts,
        )

    # Step 3: Generic non-empty observation (e.g., row 35)
    if norm_obs:
        alerts.append(
            {
                "code": "GENERIC_OBSERVATION",
                "message": "Observación genérica sin código de nave o muelle explícito.",
            }
        )
        if (
            len(active_calls) == 1
            and planned_call == active_calls[0]
            and piecework_calls == [active_calls[0]]
        ):
            cand = active_calls[0]
            return AttributionOutcome(
                status="sugerido",
                destination=None,
                suggested_destination=cand,
                strength="fuerte",
                rule_code="R13_SUGERIDO_UNICO_SOLAPE_Y_CONTEXTO",
                rule_version=RULE_VERSION,
                reason=(
                    f"Nota genérica sin identificador de nave, pero {cand} es la única recalada activa en el turno "
                    "y coincide con el frente planificado y la producción a destajo. Pendiente de validación."
                ),
                candidates=active_calls,
                evidence=evidence,
                alerts=alerts,
            )

    # Step 4: Empty observation — evaluate context signals (piecework + planned front + window)
    alerts.append(
        {
            "code": "MISSING_OBSERVATION",
            "message": "Observación del parte vacía; falta evidencia directa de ejecución de la tarea.",
        }
    )

    if len(piecework_calls) == 1 and planned_call == piecework_calls[0] and planned_call in active_calls:
        cand = planned_call
        if len(active_calls) > 1:
            alerts.append(
                {
                    "code": "MULTI_VESSEL_SHIFT",
                    "message": (
                        f"Turno con {len(active_calls)} naves activas ({', '.join(active_calls)}); "
                        "no se asume automáticamente que toda la cuadrilla operó una sola nave (R4)."
                    ),
                }
            )
        return AttributionOutcome(
            status="sugerido",
            destination=None,
            suggested_destination=cand,
            strength="fuerte",
            rule_code="R13_SUGERIDO_DESTAJO_Y_NOMBRADA",
            rule_version=RULE_VERSION,
            reason=(
                f"Sin observación en el parte. El frente planificado ({', '.join(planned_frentes)}) "
                f"y el destajo del turno coinciden en {cand} con ventana activa. "
                "Se sugiere como candidato fuerte a espera de validación."
            ),
            candidates=[cand] + [c for c in active_calls if c != cand],
            evidence=evidence,
            alerts=alerts,
        )

    if planned_call and planned_call in active_calls and not piecework_calls:
        if len(active_calls) > 1:
            alerts.append(
                {
                    "code": "MULTI_VESSEL_NO_PIECEWORK",
                    "message": (
                        f"Sin observación ni destajo en el turno y con {len(active_calls)} recaladas activas "
                        f"({', '.join(active_calls)})."
                    ),
                }
            )
        return AttributionOutcome(
            status="sugerido",
            destination=None,
            suggested_destination=planned_call,
            strength="debil",
            rule_code="R13_SUGERIDO_SOLO_NOMBRADA",
            rule_version=RULE_VERSION,
            reason=(
                f"Sin observación ni producción a destajo para la cuadrilla en el turno. "
                f"Solo el frente planificado ({', '.join(planned_frentes)}) sugiere {planned_call}. "
                "Requiere confirmación del área solicitante."
            ),
            candidates=[planned_call] + [c for c in active_calls if c != planned_call],
            evidence=evidence,
            alerts=alerts,
        )

    return AttributionOutcome(
        status="pendiente",
        destination=None,
        suggested_destination=None,
        strength=None,
        rule_code="R13_PENDIENTE_SIN_EVIDENCIA",
        rule_version=RULE_VERSION,
        reason="Sin observación ni señales contextuales unívocas; requiere revisión manual.",
        candidates=active_calls,
        evidence=evidence,
        alerts=alerts,
    )
