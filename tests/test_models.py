"""Pure-logic tests: no running Home Assistant instance required."""
from custom_components.kids_credits.models import Kid, LedgerEntry, new_entry_id, slugify_id


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
