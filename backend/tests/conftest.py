"""Shared test fixtures.

Every test runs against a throwaway data dir (its own SQLite DB and file tree),
configured *before* any backend module is imported, so tests never touch the
user's real data. DB access goes through the FastAPI app (TestClient) so all
async work shares the app's managed event loop.
"""
import os
import tempfile

# Must be set before backend.config is imported anywhere.
os.environ.setdefault("LABELHUB_DATA_DIR", tempfile.mkdtemp(prefix="labelhub_test_"))
os.environ.setdefault("LABELHUB_SKIP_WARMUP", "1")  # don't load torch in tests

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def client():
    import backend.main as m
    with TestClient(m.app) as c:
        yield c
