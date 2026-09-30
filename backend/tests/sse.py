"""Reads a `text/event-stream` body into (event, data) pairs, the way a browser client would."""

import json
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Event:
    name: str
    data: dict[str, Any]


def parse_events(lines: Iterable[str]) -> Iterator[Event]:
    name, data = "message", []
    for line in lines:
        if line == "":
            if data:
                yield Event(name, json.loads("\n".join(data)))
            name, data = "message", []
        elif line.startswith(":"):
            continue  # keepalive comment
        elif line.startswith("event:"):
            name = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].strip())
    if data:
        yield Event(name, json.loads("\n".join(data)))
