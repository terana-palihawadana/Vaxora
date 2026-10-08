import pytest

import patient_tools


@pytest.mark.asyncio
async def test_get_patient_profile_uses_requested_patient_demographics(monkeypatch):
    requested_profile_id = "8f2dfb53-5808-43df-9c4d-7e6fbe1b609a"
    requested_endpoint = (
        f"/patient-medical-history/patients/{requested_profile_id}/timeline"
    )
    observed = {}

    async def fake_api_get(endpoint, token=None, params=None):
        observed["endpoint"] = endpoint
        observed["token"] = token
        return {
            "patientProfileId": requested_profile_id,
            "patientName": "Target Patient",
            "nicNumber": "991122334V",
            "dateOfBirth": "2000-03-04T00:00:00",
            "phoneNumber": "0770000002",
        }

    monkeypatch.setattr(patient_tools, "_api_get", fake_api_get)

    result = await patient_tools.tool_get_patient_profile(
        requested_profile_id,
        token="clinician-token",
    )

    assert observed == {
        "endpoint": requested_endpoint,
        "token": "clinician-token",
    }
    assert result == {
        "success": True,
        "profile": {
            "name": "Target Patient",
            "phone": "0770000002",
            "nic": "991122334V",
            "date_of_birth": "2000-03-04T00:00:00",
        },
    }
