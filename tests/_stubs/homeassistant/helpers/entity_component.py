class EntityComponent:
    def __init__(self, logger, domain, hass):
        self.logger = logger
        self.domain = domain
        self.hass = hass
        self.entities = []
        self._by_entity_id = {}

    async def async_add_entities(self, new_entities):
        for entity in new_entities:
            self.entities.append(entity)
            self._by_entity_id[getattr(entity, "entity_id", None)] = entity

    def get_entity(self, entity_id):
        return self._by_entity_id.get(entity_id)
