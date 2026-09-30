"""FastAPI dependency providers. Routes get services from here, never build them."""

from typing import Annotated

from fastapi import Depends, Request

from docchat.core.container import Container


def get_container(request: Request) -> Container:
    container: Container = request.app.state.container
    return container


ContainerDep = Annotated[Container, Depends(get_container)]
