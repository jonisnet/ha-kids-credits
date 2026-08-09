SOURCE_IMPORT = "import"


class ConfigEntry:
    def __init__(self, entry_id="test", data=None):
        self.entry_id = entry_id
        self.data = data or {}


class ConfigFlow:
    def __init_subclass__(cls, domain=None, **kwargs):
        cls.domain = domain
        super().__init_subclass__(**kwargs)

    def _async_current_entries(self):
        return []

    def async_abort(self, reason):
        return {"type": "abort", "reason": reason}

    def async_create_entry(self, title, data):
        return {"type": "create_entry", "title": title, "data": data}

    def async_show_form(self, step_id, **kwargs):
        return {"type": "form", "step_id": step_id}
