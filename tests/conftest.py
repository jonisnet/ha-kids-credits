"""Pytest bootstrap.

Normal development/CI: `requirements.test.txt` installs the real
`homeassistant`, `voluptuous` and `pytest-homeassistant-custom-component`
packages, and this file does nothing extra beyond making the repo root
importable.

`tests/_stubs` only exists for environments with no PyPI access at all. It
is a deliberately minimal stand-in for the handful of homeassistant symbols
models.py/store.py/manager.py touch -- NOT a replacement for the real test
suite. It is only added to sys.path (and only as a low-priority fallback,
appended at the end) when the real `homeassistant` package isn't installed,
so it can never shadow the real package in normal CI.
"""
import importlib.util
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(__file__))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

if importlib.util.find_spec("homeassistant") is None:
    _STUBS = os.path.join(os.path.dirname(__file__), "_stubs")
    if _STUBS not in sys.path:
        sys.path.append(_STUBS)
