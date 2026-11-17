from __future__ import annotations

from rest_framework.permissions import BasePermission

ROLE_CONSULTA = "consulta"
ROLE_OPERADOR = "operador"
ROLE_VALIDADOR = "validador"
ALL_ROLES = (ROLE_CONSULTA, ROLE_OPERADOR, ROLE_VALIDADOR)


def get_user_roles(user) -> list[str]:
    if not user or not user.is_authenticated:
        return []
    group_names = set(user.groups.values_list("name", flat=True))
    roles = [r for r in ALL_ROLES if r in group_names]
    if user.is_superuser and ROLE_VALIDADOR not in roles:
        roles.append(ROLE_VALIDADOR)
    if not roles:
        roles.append(ROLE_CONSULTA)
    return roles


def user_can_review(user) -> bool:
    return ROLE_VALIDADOR in get_user_roles(user)


class IsAuthenticatedRead(BasePermission):
    message = "Autenticación requerida."

    def has_permission(self, request, view) -> bool:
        return bool(request.user and request.user.is_authenticated)


class IsValidatorRole(BasePermission):
    message = "Solo el rol 'validador' del área solicitante está autorizado para registrar revisiones."

    def has_permission(self, request, view) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False
        return user_can_review(request.user)
