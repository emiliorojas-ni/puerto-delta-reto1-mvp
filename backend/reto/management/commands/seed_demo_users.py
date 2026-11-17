from __future__ import annotations

import os

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand


DEMO_USERS = [
    ("consulta", "consulta", "DEMO_PASSWORD_CONSULTA", "delta-consulta-2026"),
    ("operador", "operador", "DEMO_PASSWORD_OPERADOR", "delta-operador-2026"),
    ("validador", "validador", "DEMO_PASSWORD_VALIDADOR", "delta-validador-2026"),
]


def ensure_demo_users() -> list[str]:
    User = get_user_model()
    created_or_updated: list[str] = []
    for username, role_name, env_var, default_pwd in DEMO_USERS:
        group, _ = Group.objects.get_or_create(name=role_name)
        password = os.environ.get(env_var, default_pwd)
        user, _ = User.objects.get_or_create(username=username)
        user.is_active = True
        user.set_password(password)
        user.save()
        user.groups.set([group])
        created_or_updated.append(f"{username} (rol: {role_name})")
    return created_or_updated


class Command(BaseCommand):
    help = "Crea o actualiza las cuentas de demostración declaradas (consulta, operador, validador)."

    def handle(self, *args, **options) -> None:
        accounts = ensure_demo_users()
        self.stdout.write(
            self.style.SUCCESS("Cuentas de demo listas: " + ", ".join(accounts))
        )
