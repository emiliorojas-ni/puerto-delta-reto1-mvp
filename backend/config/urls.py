from __future__ import annotations

import mimetypes
from pathlib import Path

from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, Http404, HttpResponse
from django.urls import include, path, re_path


def serve_spa_or_root_asset(request, asset_path: str = ""):
    dist_dir: Path = settings.FRONTEND_DIST_DIR
    if asset_path:
        candidate = (dist_dir / asset_path).resolve()
        if dist_dir.exists() and str(candidate).startswith(str(dist_dir.resolve())) and candidate.is_file():
            content_type, _ = mimetypes.guess_type(str(candidate))
            return FileResponse(open(candidate, "rb"), content_type=content_type or "application/octet-stream")

    index_file = dist_dir / "index.html"
    if index_file.is_file():
        return FileResponse(open(index_file, "rb"), content_type="text/html; charset=utf-8")

    return HttpResponse(
        "<!doctype html><html lang='es'><head><meta charset='utf-8'><title>Puerto Delta · API Activa</title></head>"
        "<body><h1>Puerto Delta · API v1 activa</h1><p>Ejecute <code>npm run build</code> en <code>frontend/</code> "
        "o use el servidor de desarrollo de Vite.</p></body></html>",
        content_type="text/html; charset=utf-8",
    )


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include("reto.api.urls")),
    path("", serve_spa_or_root_asset, name="spa-root"),
    re_path(r"^(?P<asset_path>(?!api/|admin/|assets/).*)$", serve_spa_or_root_asset, name="spa-fallback"),
]
