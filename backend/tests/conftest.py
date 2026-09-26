import pytest
from fastapi.testclient import TestClient

from app.auth import AUTH_PROTOCOL, issue_token
from app.main import app


def signed_in_token():
    return issue_token({"sub": "test@example.com", "name": "Test", "provider": "google"})[0]


@pytest.fixture
def client():
    """A client with a valid session, as the signed-in frontend would be."""
    return TestClient(app, headers={"Authorization": f"Bearer {signed_in_token()}"})


@pytest.fixture
def socket_protocols():
    return [AUTH_PROTOCOL, signed_in_token()]
