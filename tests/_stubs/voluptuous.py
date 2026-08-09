"""Minimal offline stand-in for the `voluptuous` package.

The real HA test suite runs against the real `homeassistant` + `voluptuous`
packages via PyPI. This sandbox has no PyPI access, so this stub exists only
so the pure business-logic tests (models/store/migration) can import the
integration's modules without pulling in real HA. It intentionally does not
implement real schema validation -- it just needs to not blow up when the
integration's modules build vol.Schema({...}) at import time.
"""
from __future__ import annotations


class Invalid(Exception):
    pass


class Marker:
    def __init__(self, key, default=None):
        self.key = key
        self.default = default

    def __hash__(self):
        return hash(self.key)

    def __eq__(self, other):
        return self.key == getattr(other, "key", other)

    def __str__(self):
        return str(self.key)


class Required(Marker):
    pass


class Optional(Marker):
    def __init__(self, key, default=None):
        super().__init__(key, default)
        self._default = default

    def default(self):
        return self._default if not callable(self._default) else self._default()


ALLOW_EXTRA = "allow_extra"


class Schema:
    def __init__(self, schema, extra=None):
        self.schema = schema
        self.extra = extra

    def __call__(self, data):
        return data


def All(*validators):
    def _validate(value):
        for v in validators:
            value = v(value) if callable(v) else value
        return value

    return _validate


def Any(*validators):
    def _validate(value):
        return value

    return _validate


def In(options):
    def _validate(value):
        return value

    return _validate
