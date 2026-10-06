from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "switch-analysis"

def test_run_subscriptions_endpoint():
    response = client.post("/run/subscriptions")
    assert response.status_code == 200
    data = response.json()
    assert data["pipeline"] == "subscriptions"
    assert "count" in data

def test_run_invalid_pipeline_endpoint():
    response = client.post("/run/unknown_pipeline")
    assert response.status_code == 400
