"""Pure-logic tests: no running Home Assistant instance required."""
from custom_components.kids_credits.models import CreditRequest, Kid, LedgerEntry, new_entry_id, slugify_id


def test_slugify_id_basic():
    assert slugify_id("Limanah") == "limanah"
    assert slugify_id("Aline") == "aline"


def test_slugify_id_strips_accents_and_punctuation_to_underscores():
    assert slugify_id("Sven-Göran!") == "sven_g_ran"


def test_slugify_id_falls_back_to_a_random_id_when_nothing_alphanumeric_survives():
    slug = slugify_id("!!!")
    assert slug  # non-empty
    assert slug != slugify_id("???")  # two blank names don't collide


def test_kid_storage_round_trip():
    kid = Kid(id="limanah", name="Limanah", icon="mdi:star")
    restored = Kid.from_storage_dict(kid.to_storage_dict())
    assert restored == kid


def test_kid_from_storage_dict_defaults_icon_when_missing():
    kid = Kid.from_storage_dict({"id": "aline", "name": "Aline"})
    assert kid.icon == "mdi:account-child"
    assert kid.photo is None


def test_kid_storage_round_trip_preserves_photo():
    kid = Kid(id="aline", name="Aline", photo="data:image/png;base64,abcd")
    restored = Kid.from_storage_dict(kid.to_storage_dict())
    assert restored.photo == "data:image/png;base64,abcd"


def test_ledger_entry_storage_round_trip():
    entry = LedgerEntry(
        id=new_entry_id(),
        kid_id="limanah",
        delta=3,
        reason="Kamer opgeruimd",
        category="task",
        created_at=1700000000.0,
        actor="papa",
    )
    restored = LedgerEntry.from_storage_dict(entry.to_storage_dict())
    assert restored == entry


def test_new_entry_id_is_unique():
    assert new_entry_id() != new_entry_id()


def test_credit_request_defaults_to_pending_with_no_resolution():
    request = CreditRequest(id=new_entry_id(), kid_id="limanah", reason="Kamer opgeruimd")
    assert request.status == "pending"
    assert request.resolved_at is None
    assert request.actor is None
    assert request.amount is None


def test_credit_request_storage_round_trip():
    request = CreditRequest(
        id=new_entry_id(),
        kid_id="limanah",
        reason="Kamer opgeruimd",
        status="approved",
        created_at=1700000000.0,
        resolved_at=1700000100.0,
        actor="papa",
        amount=3,
    )
    restored = CreditRequest.from_storage_dict(request.to_storage_dict())
    assert restored == request
