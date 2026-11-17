from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from reto.costing.services import compute_batch_summary
from reto.imports.services import ImportValidationError, import_reto_dataset


class Command(BaseCommand):
    help = "Importa las 7 tablas CSV oficiales del Reto 1 desde un directorio local fuera del repositorio."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--data-dir",
            required=True,
            help="Ruta local al directorio que contiene los 7 archivos CSV oficiales.",
        )
        parser.add_argument(
            "--imported-by",
            default="operador",
            help="Identificador del operador que ejecuta la importación.",
        )

    def handle(self, *args, **options) -> None:
        data_dir = options["data_dir"]
        imported_by = options["imported_by"]
        try:
            result = import_reto_dataset(data_dir, imported_by=imported_by)
        except ImportValidationError as exc:
            raise CommandError(str(exc)) from exc

        summary = compute_batch_summary(result.batch)
        action = "reutilizado (sin filas nuevas)" if result.reused else "creado y activado"
        self.stdout.write(
            self.style.SUCCESS(
                f"Lote #{result.batch.id} {action} | SHA-256: {result.batch.sha256[:16]}… | "
                f"Filas origen: {result.batch.source_rows} | "
                f"Total período: USD {summary['totals']['total_usd']} | "
                f"Control OK: {summary['control']['ok']}"
            )
        )
