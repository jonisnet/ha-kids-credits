class CalendarEntity:
    pass


class CalendarEvent:
    def __init__(self, start, end, summary, description=None):
        self.start = start
        self.end = end
        self.summary = summary
        self.description = description
