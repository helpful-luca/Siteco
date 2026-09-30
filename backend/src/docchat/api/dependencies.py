"""FastAPI dependency providers. Routes get services from here, never build them."""

from typing import Annotated

from fastapi import Depends, Request

from docchat.core.container import Container
from docchat.services.document_service import DocumentService
from docchat.services.upload_service import UploadService


def get_container(request: Request) -> Container:
    container: Container = request.app.state.container
    return container


def get_document_service(request: Request) -> DocumentService:
    return get_container(request).documents


def get_upload_service(request: Request) -> UploadService:
    return get_container(request).uploads


ContainerDep = Annotated[Container, Depends(get_container)]
DocumentServiceDep = Annotated[DocumentService, Depends(get_document_service)]
UploadServiceDep = Annotated[UploadService, Depends(get_upload_service)]
