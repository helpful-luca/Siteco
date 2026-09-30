"""Chat services wired with real SQLite and fakes for index, embedder and model."""

from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

from docchat.adapters.fake_llm import FakeLLMClient
from docchat.adapters.sqlite.chat_repository import SqliteChatRepository
from docchat.adapters.sqlite.database import Database
from docchat.adapters.sqlite.document_repository import SqliteDocumentRepository
from docchat.adapters.sqlite.usage_ledger import SqliteUsageLedger
from docchat.domain.chat_models import Chat
from docchat.domain.enums import ChatScope, DocumentKind, DocumentStatus, LlmStatus, Locale
from docchat.domain.models import Chunk, Document, Sentence
from docchat.domain.ports import LLMClient
from docchat.domain.sentences import split_sentences
from docchat.services.answer_run import RunDeps, RunTimings
from docchat.services.answer_service import AnswerLimits, AnswerOptions, AnswerService, AskCommand
from docchat.services.chat_service import ChatService
from docchat.services.limits import DailyBudget, LimitScope, RateLimit
from docchat.services.llm_health import LlmHealth
from docchat.services.model_availability import ModelAvailability
from docchat.services.retrieval_service import RetrievalService, RetrievalSettings
from docchat.services.run_events import RunEvent
from docchat.services.run_registry import RunRegistry
from tests.fakes import FakeClock, FakeEmbedder, FakeSleep, FakeTicker, FakeVectorStore

MODELS = ("claude-haiku-4-5", "claude-sonnet-5-5", "claude-opus-5-5")


@dataclass
class ChatHarness:
    documents: SqliteDocumentRepository
    chats_repo: SqliteChatRepository
    ledger: SqliteUsageLedger
    vectors: FakeVectorStore
    llm: FakeLLMClient | None
    health: LlmHealth
    clock: FakeClock
    sleep: FakeSleep
    registry: RunRegistry
    chats: ChatService
    answers: AnswerService
    models: ModelAvailability
    ticker: FakeTicker
    options: AnswerOptions = field(
        default_factory=lambda: AnswerOptions(model="claude-sonnet-5-5", locale=Locale.DE)
    )

    def add_document(
        self,
        texts: Sequence[str] = ("Die Leuchte Mira hat die Schutzart IP66.",),
        *,
        status: DocumentStatus = DocumentStatus.READY,
        filename: str = "Datenblatt Mira.pdf",
        char_count: int | None = None,
    ) -> Document:
        doc_id = str(uuid4())
        now = self.clock.now()
        document = Document(
            id=doc_id,
            filename=filename,
            kind=DocumentKind.PDF,
            size_bytes=100,
            sha256=uuid4().hex,
            status=DocumentStatus.QUEUED,
            created_at=now,
            updated_at=now,
        )
        self.documents.insert(document)
        chunks = [
            Chunk(
                chunk_id=str(uuid4()),
                document_id=doc_id,
                ordinal=i,
                page=i + 1,
                heading="",
                text=text,
                search_text=text,
                sentences=tuple(
                    Sentence(n, text[a:b], a, b) for n, (a, b) in enumerate(split_sentences(text))
                ),
            )
            for i, text in enumerate(texts)
        ]
        self.vectors.add(chunks, [[0.0] * 4 for _ in chunks])
        chars = char_count if char_count is not None else sum(len(t) for t in texts)
        self.documents.start_parsing(doc_id, now)
        self.documents.start_embedding(
            doc_id, now, page_count=len(texts), chunk_count=len(chunks), char_count=chars,
            notices=(),
        )  # fmt: skip
        if status is DocumentStatus.READY:
            self.documents.mark_ready(doc_id, now)
        elif status is DocumentStatus.FAILED:
            from docchat.domain.errors import ErrorCode

            self.documents.mark_failed(doc_id, ErrorCode.PDF_CORRUPT, now)
        got = self.documents.get(doc_id)
        assert got is not None
        return got

    def chunks(self, document: Document) -> list[Chunk]:
        return self.vectors.chunks_of([document.id])

    def new_chat(
        self, scope: ChatScope = ChatScope.ALL, document_ids: list[str] | None = None
    ) -> Chat:
        return self.chats.create(scope, document_ids)

    def command(
        self, chat: Chat, content: str = "Welche Schutzart hat die Mira?", **changes: object
    ) -> AskCommand:
        base: dict[str, object] = {
            "chat_id": chat.id,
            "client_message_id": str(uuid4()),
            "content": content,
            "options": self.options,
        }
        return AskCommand(**(base | changes))  # type: ignore[arg-type]

    async def ask(self, chat: Chat, content: str = "Welche Schutzart hat die Mira?",
                  **changes: object) -> list[RunEvent]:  # fmt: skip
        run = await self.answers.ask(self.command(chat, content, **changes))
        return [event async for event in run.events()]


def build_chat_harness(
    root: Path,
    *,
    llm: FakeLLMClient | None = None,
    without_llm: bool = False,
    timings: RunTimings | None = None,
    daily_budget_usd: float | None = None,
    max_concurrent: int = 3,
    full_context_max_tokens: int = 20_000,
    max_messages: int = 200,
    chat_per_minute: int = 0,
) -> ChatHarness:
    database = Database(root / "app.db")
    database.migrate()
    documents = SqliteDocumentRepository(database)
    chats_repo = SqliteChatRepository(database)
    ledger = SqliteUsageLedger(database)
    vectors = FakeVectorStore()
    clock = FakeClock()
    sleep = FakeSleep()
    registry = RunRegistry(max_concurrent)
    client = None if without_llm else (llm or FakeLLMClient())
    health = LlmHealth(LlmStatus.OK if client is not None else LlmStatus.MISSING_KEY)
    retrieval = RetrievalService(
        documents,
        vectors,
        FakeEmbedder(dim=4),
        RetrievalSettings(full_context_max_tokens=full_context_max_tokens),
    )
    llm_port: LLMClient | None = client
    models = ModelAvailability(MODELS, "claude-sonnet-5-5")
    ticker = FakeTicker()
    deps = RunDeps(
        chats=chats_repo,
        retrieval=retrieval,
        llm=llm_port,
        health=health,
        ledger=ledger,
        clock=clock,
        registry=registry,
        timings=timings or RunTimings(),
        models=models,
        sleep=sleep,
    )
    answers = AnswerService(
        deps,
        AnswerLimits(
            enabled_models=MODELS,
            max_messages_per_chat=max_messages,
        ),
        rate=RateLimit(LimitScope.CHAT, chat_per_minute, ticker),
        budget=DailyBudget(ledger, clock, daily_budget_usd),
    )
    chats = ChatService(chats_repo, documents, registry, clock, max_chats=5)
    return ChatHarness(
        documents, chats_repo, ledger, vectors, client, health, clock, sleep, registry, chats,
        answers, models, ticker,
    )  # fmt: skip
