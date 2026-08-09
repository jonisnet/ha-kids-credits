class Entity:
    should_poll = True

    def async_write_ha_state(self):
        pass

    async def async_remove(self, force_remove=False):
        pass
