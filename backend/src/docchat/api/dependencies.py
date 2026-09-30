"""FastAPI dependency providers. Routes get services from here, never build them."""

from typing import Annotated

from fastapi import Depends, Request

from docchat.core.container import Container
from docchat.services.answer_service import AnswerService
from docchat.services.chat_service import ChatService
from docchat.services.document_service import DocumentService
from docchat.services.upload_service import UploadService


def get_container(request: Request) -> Container:
    container: Container = request.app.state.container
    return container


def get_document_service(request: Request) -> DocumentService:
    return get_container(request).documents


def get_upload_service(request: Request) -> UploadService:
    return get_container(request).uploads


def get_chat_service(request: Request) -> ChatService:
    return get_container(request).chats


def get_answer_service(request: Request) -> AnswerService:
    return get_container(request).answers


ContainerDep = Annotated[Container, Depends(get_container)]
DocumentServiceDep = Annotated[DocumentService, Depends(get_document_service)]
UploadServiceDep = Annotated[UploadService, Depends(get_upload_service)]
ChatServiceDep = Annotated[ChatService, Depends(get_chat_service)]
AnswerServiceDep = Annotated[AnswerService, Depends(get_answer_service)]
