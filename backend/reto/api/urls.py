from django.urls import path

from reto.api.views import (
    CallDetailView,
    CallListView,
    ExportView,
    LoginView,
    LogoutView,
    PartDetailView,
    PartListView,
    PartReviewCreateView,
    SessionView,
    SummaryView,
)

urlpatterns = [
    path("auth/session", SessionView.as_view(), name="api-auth-session"),
    path("auth/login", LoginView.as_view(), name="api-auth-login"),
    path("auth/logout", LogoutView.as_view(), name="api-auth-logout"),
    path("summary", SummaryView.as_view(), name="api-summary"),
    path("calls", CallListView.as_view(), name="api-call-list"),
    path("calls/<str:call_id>", CallDetailView.as_view(), name="api-call-detail"),
    path("parts", PartListView.as_view(), name="api-part-list"),
    path("parts/<int:part_id>", PartDetailView.as_view(), name="api-part-detail"),
    path("parts/<int:part_id>/reviews", PartReviewCreateView.as_view(), name="api-part-reviews"),
    path("exports/<str:kind>", ExportView.as_view(), name="api-export"),
]
