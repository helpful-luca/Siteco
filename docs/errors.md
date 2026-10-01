# Error codes

Generated from `contracts/openapi.json` (status and retryable, exported from
`backend/src/docchat/domain/errors.py`), `frontend/src/shared/api/error-catalog.ts` (where a
code appears) and `frontend/messages/de.json` (the text, with example values). Do not edit by
hand: `cd frontend && UPDATE_ERRORS_DOC=1 npx vitest run error-catalog` rewrites it, and the
same test fails when it is out of date.

Every error travels as one envelope `{error: {code, message, retryable, retry_after, request_id,
params, details}}`. The UI never shows `message`; it shows the text of `code`. HTTP is the
status before a stream opens; inside an answer stream the same codes arrive as an `error` event
(HTTP 200). Our own limit is `RATE_LIMITED` (429 with `Retry-After`); Claude being busy is
`LLM_RATE_LIMITED` or `LLM_OVERLOADED`, sent as 503, never as 429. Ingestion failures are no
HTTP errors: the document ends `failed` with the code.

| Code | HTTP | Retry | From | Where it appears | What you see (DE) |
|---|---|---|---|---|---|
| `VALIDATION_ERROR` | 422 | no | backend | composer note, next to the control | Da hat etwas mit der Anfrage nicht gepasst. Lade die Seite neu und versuch es noch einmal. |
| `NOT_FOUND` | 404 | no | backend | whole view, source panel | Das gibt es nicht mehr, vielleicht wurde es in einem anderen Fenster gelöscht. Lade die Seite neu. |
| `METHOD_NOT_ALLOWED` | 405 | no | backend | composer note, next to the control | Diese Aktion ist hier nicht möglich. Lade die Seite neu und versuch es noch einmal. |
| `UNAUTHORIZED_CLIENT` | 401 | no | backend | startup screen, composer note | Der Server hat diese Anfrage abgewiesen. Prüfe INTERNAL_TOKEN in der .env und starte die App neu. |
| `SERVICE_STARTING` | 503 | yes | backend | startup screen | Die App startet noch. Das dauert meist nur ein paar Sekunden. |
| `INTERNAL_ERROR` | 500 | yes | backend | composer note, inline in the answer, library row, whole view | Bei uns ist etwas schiefgelaufen. Versuch es gleich noch einmal. |
| `REQUEST_TOO_LARGE` | 413 | no | backend | composer note, next to the control | Diese Anfrage ist zu groß. Kürze den Text und versuch es erneut. |
| `RATE_LIMITED` | 429 | yes | backend | countdown (composer, upload row) | Kurze Pause. In 23 Sekunden kannst du weitermachen. |
| `UPLOAD_TOO_LARGE` | 413 | no | backend | library row | Diese Datei ist größer als 1024 MB. Teile sie auf oder nimm eine kleinere Version. |
| `UNSUPPORTED_TYPE` | 415 | no | backend | library row | Dieses Format wird nicht unterstützt. Möglich sind PDF, TXT und Markdown. |
| `FILE_CONTENT_MISMATCH` | 415 | no | backend | library row | Der Inhalt passt nicht zur Dateiendung. Speichere die Datei neu als PDF, TXT oder Markdown. |
| `EMPTY_FILE` | 422 | no | backend | library row | Diese Datei ist leer. Wähle eine andere Datei. |
| `DUPLICATE_DOCUMENT` | 409 | no | backend | library row | Diese Datei ist schon in deiner Bibliothek. Du kannst sie direkt verwenden. |
| `STORAGE_QUOTA` | 409 | no | backend | library row | Deine Bibliothek hat ihr Limit von 1024 MB erreicht. Entferne ein Dokument, um Platz zu schaffen. |
| `STORAGE_FULL` | 507 | no | backend | library row | Auf dem Rechner ist kein Speicherplatz mehr frei. Gib etwas Platz frei oder entferne Dokumente. |
| `UPLOAD_INCOMPLETE` | 400 | yes | backend | library row | Der Upload wurde unterbrochen. Versuch es noch einmal. |
| `DOCUMENT_NOT_READY` | 409 | yes | backend | source panel | Dieses Dokument wird noch verarbeitet. Gleich ist es bereit. |
| `DOCUMENT_FILE_MISSING` | 410 | no | backend | source panel | Die Originaldatei ist nicht mehr da. Lade das Dokument erneut hoch. |
| `DELETE_FAILED` | 500 | yes | backend | library row, next to the control | Das Löschen hat nicht ganz geklappt. Versuch es noch einmal, bereits Gelöschtes bleibt gelöscht. |
| `RANGE_NOT_SATISFIABLE` | 416 | no | backend | source panel | Dieser Teil der Datei existiert nicht. Lade die Ansicht neu. |
| `EVAL_RESULTS_MISSING` | 404 | no | backend | whole view | Es gibt noch keine Auswertung. Führe make eval aus, um sie zu erzeugen. |
| `PDF_ENCRYPTED` | 422 | no | backend | library row | Dieses PDF ist passwortgeschützt. Speichere eine Kopie ohne Passwort und lade sie hoch. |
| `PDF_CORRUPT` | 422 | no | backend | library row | Dieses PDF lässt sich nicht öffnen, vielleicht ist es beschädigt. Exportiere es neu und versuch es erneut. |
| `PDF_NO_TEXT` | 422 | no | backend | library row | In diesem PDF haben wir keinen lesbaren Text gefunden, vermutlich ist es ein Scan. Nimm eine Version mit Textebene oder eine schärfere Kopie. |
| `PDF_TOO_MANY_PAGES` | 422 | no | backend | library row | Dieses PDF hat mehr Seiten, als die App verarbeiten kann. Teile es in kleinere Dateien auf. |
| `TEXT_ENCODING_UNSUPPORTED` | 422 | no | backend | library row | Die Zeichenkodierung dieser Datei können wir nicht lesen. Speichere sie als UTF-8 und lade sie erneut hoch. |
| `DOCUMENT_EMPTY` | 422 | no | backend | library row | In dieser Datei haben wir keinen Text gefunden. Wähle eine Datei mit Text. |
| `DOCUMENT_TOO_LONG` | 422 | no | backend | library row | Dieses Dokument ist zu lang. Teile es in kleinere Dateien auf. |
| `PROCESSING_TIMEOUT` | 500 | yes | backend | library row | Die Verarbeitung hat zu lange gedauert. Versuch es noch einmal oder teile die Datei auf. |
| `PROCESSING_FAILED` | 500 | yes | backend | library row | Beim Verarbeiten ist etwas schiefgelaufen. Versuch es noch einmal. |
| `PROCESSING_INTERRUPTED` | 500 | yes | backend | library row | Die Verarbeitung wurde durch einen Neustart unterbrochen. Starte sie einfach neu. |
| `MALWARE_DETECTED` | 422 | no | backend | library row | Die Virenprüfung hat in dieser Datei Schadsoftware gefunden und sie sofort gelöscht. Hol dir eine saubere Kopie aus einer vertrauenswürdigen Quelle. |
| `MALWARE_SCAN_FAILED` | 422 | yes | backend | library row | Die Virenprüfung konnte diese Datei nicht prüfen. Sicherheitshalber wurde sie nicht übernommen. Versuch es noch einmal. |
| `CHAT_NOT_FOUND` | 404 | no | backend | whole view | Diesen Chat gibt es nicht mehr. Vielleicht wurde er in einem anderen Fenster gelöscht. |
| `CHAT_BUSY` | 409 | yes | backend | composer note | In diesem Chat entsteht gerade noch eine Antwort. Warte kurz oder stoppe sie. |
| `CHAT_LIMIT` | 409 | no | backend | composer note | Du hast 100 Chats. Lösche ältere Chats, um einen neuen zu beginnen. |
| `MESSAGE_LIMIT` | 409 | no | backend | composer note | Dieser Chat ist sehr lang geworden. Starte für weitere Fragen einen neuen Chat. |
| `MESSAGE_NOT_LATEST` | 409 | no | backend | composer note | Neu erzeugen geht nur für die Antwort auf die letzte Frage. Stell deine Frage einfach noch einmal. |
| `DUPLICATE_REQUEST` | 409 | no | backend | nothing (ignored) | Diese Frage ist schon unterwegs. |
| `CONCURRENCY_LIMIT` | 429 | yes | backend | countdown (composer, upload row) | Es laufen schon 3 Antworten gleichzeitig. Sobald eine fertig ist, kannst du weitermachen. |
| `NO_DOCUMENTS` | 409 | no | backend | composer note | Lade zuerst ein Dokument hoch. Danach kannst du Fragen dazu stellen. |
| `DOCUMENTS_NOT_READY` | 409 | yes | backend | composer note | Deine Dokumente werden noch verarbeitet. Sobald eins bereit ist, kannst du fragen. |
| `QUESTION_EMPTY` | 422 | no | backend | composer note | Schreib eine Frage, dann geht es los. |
| `QUESTION_TOO_LONG` | 422 | no | backend | composer note | Die Frage ist länger als 4000 Zeichen. Kürze sie ein wenig. |
| `MODEL_NOT_ALLOWED` | 422 | no | backend | composer note | Dieses Modell steht hier nicht zur Wahl. Wähle oben ein anderes. |
| `COMPARE_SAME_MODEL` | 422 | no | backend | inline in the answer | Beide Spalten nutzen dasselbe Modell. Wähle für den Vergleich zwei unterschiedliche Modelle. |
| `TOKEN_BUDGET_EXCEEDED` | 429 | yes | backend | global banner, composer note | Das Tagesbudget dieser Demo ist aufgebraucht. Ab 02:00 Uhr kannst du wieder fragen. |
| `LLM_AUTH` | 503 | no | backend | global banner, inline in the answer | Der Claude API-Schlüssel wird nicht akzeptiert. Prüfe ANTHROPIC_API_KEY in der .env und starte die App neu. |
| `LLM_BILLING` | 503 | no | backend | global banner, inline in the answer | Das Guthaben oder Ausgabenlimit des API-Kontos ist erreicht. Prüfe die Abrechnung in der Claude Console. |
| `LLM_FORBIDDEN` | 503 | no | backend | inline in the answer | Dieser API-Schlüssel darf das gewählte Modell nicht nutzen. Wähle ein anderes Modell oder prüfe die Freigaben in der Claude Console. |
| `MODEL_UNAVAILABLE` | 503 | no | backend | inline in the answer, composer note | Claude Sonnet 5.5 ist gerade nicht verfügbar. Wähle ein anderes Modell. |
| `LLM_RATE_LIMITED` | 503 | yes | backend | inline in the answer | Claude bekommt gerade zu viele Anfragen von diesem Konto. Versuch es in 23 Sekunden erneut. |
| `LLM_OVERLOADED` | 503 | yes | backend | inline in the answer | Claude ist gerade stark ausgelastet. Versuch es in ein paar Sekunden noch einmal oder nimm ein anderes Modell. |
| `LLM_UNAVAILABLE` | 502 | yes | backend | inline in the answer | Bei Claude gab es gerade ein Problem. Versuch es gleich noch einmal. |
| `LLM_TIMEOUT` | 504 | yes | backend | inline in the answer | Claude hat zu lange nicht geantwortet. Versuch es noch einmal. |
| `LLM_UNREACHABLE` | 502 | yes | backend | inline in the answer | Claude ist gerade nicht erreichbar. Prüfe die Internetverbindung und versuch es erneut. |
| `LLM_BAD_REQUEST` | 500 | no | backend | inline in the answer | Die Anfrage an Claude war fehlerhaft. Das liegt an der App. Starte einen neuen Chat und versuch es dort. |
| `LLM_CONTEXT_TOO_LARGE` | 500 | no | backend | inline in the answer | Diese Unterhaltung ist zu lang geworden. Starte einen neuen Chat. |
| `LLM_EMPTY_ANSWER` | 502 | yes | backend | inline in the answer | Es kam keine Antwort zurück. Versuch es noch einmal. |
| `BACKEND_UNAVAILABLE` | 503 | yes | proxy | global banner, startup screen, composer note | Der Server antwortet gerade nicht. Wir versuchen es automatisch weiter. |
| `FORBIDDEN_ORIGIN` | 403 | no | proxy | composer note, next to the control | Diese Anfrage kam nicht aus der App und wurde blockiert. Lade die App neu und versuch es noch einmal. |
| `NETWORK_ERROR` | none | yes | browser | global banner, startup screen, composer note, library row | Die App ist gerade nicht erreichbar. Prüfe, ob sie noch läuft, und versuch es erneut. |
| `STREAM_INTERRUPTED` | none | yes | browser | inline in the answer, composer note | Die Verbindung ist abgerissen, bevor die Antwort fertig war. Versuch es noch einmal. |
| `UNKNOWN_ERROR` | none | yes | browser | composer note, inline in the answer, library row, whole view | Etwas Unerwartetes ist passiert. Versuch es noch einmal. |
