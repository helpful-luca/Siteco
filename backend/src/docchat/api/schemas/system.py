from typing import Literal

from pydantic import BaseModel


class LiveOut(BaseModel):
    app: str
    status: Literal["ok"]
