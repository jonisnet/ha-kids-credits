def async_dispatcher_send(hass, signal, *args):
    pass


def async_dispatcher_connect(hass, signal, target):
    def _unsub():
        pass

    return _unsub
