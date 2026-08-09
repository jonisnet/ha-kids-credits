from __future__ import annotations

from enum import Enum
from typing import Any


class HomeAssistant:
    def __init__(self):
        self.data: dict[str, Any] = {}
        self.bus = _Bus()
        self.services = _Services()
        self.config_entries = None


class _Bus:
    def async_fire(self, event_type, event_data=None):
        pass


class _Services:
    def has_service(self, domain, service):
        return False

    def async_register(self, *args, **kwargs):
        pass

    def async_remove(self, *args, **kwargs):
        pass


class ServiceCall:
    def __init__(self, data: dict):
        self.data = data


ServiceResponse = dict


class SupportsResponse(Enum):
    NONE = "none"
    OPTIONAL = "optional"
    ONLY = "only"
