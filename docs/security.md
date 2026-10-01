# Security and privacy

Proportionate to a local single user app, and honest about what is out of scope. The case brief does not grade production hardening; this is what was done anyway and why.

## Threat model

| Threat | Measure |
|---|---|
| A hostile document (malware, parser bomb, prompt injection) | ClamAV scan with quarantine; size, magic byte and encoding checks; pdfium in a separate process with timeouts per batch; PDF active content detected and shown; only linear regular expressions on untrusted text (a backtracking pattern on one long line used to be able to stall the API); documents reach the model only as `search_result` data |
| A hostile web page calling `localhost:3000` | Mutating requests need `X-Requested-With: docchat` (a page cannot set it without a preflight the app never answers) and a matching `Origin`; JSON routes accept JSON only; backend has no host port |
| DNS rebinding against the app (a site whose name switches to 127.0.0.1 is same-origin, so header and Origin checks pass) | Every `/api` request, reads included, must be addressed to a loopback `Host` (`localhost`, `127.0.0.1`, `[::1]`); the rebound page still sends its own name and gets 403. The app listens on 127.0.0.1 only, so a legitimate request never has another name. Residual: server-rendered pages themselves are not guarded; they carry the theme, language and the greeting name, no documents or chats |
| Data leaving through a rendered answer (prompt injection exfiltration) | Answers render without images and raw HTML, links only http(s) and mailto, opened with `noopener noreferrer nofollow`; CSP `img-src` and `connect-src` allow only the app itself |
| The API key leaking | Read only by the backend, never `NEXT_PUBLIC_*`, never logged, never returned (the API shows its last four characters only); a key from Settings lives in `DATA_DIR/secrets` (folder 0700, file 0600, overwritten on delete), outside SQLite and every export; `.env` is ignored and `.env.example` is committed |
| Content in logs | Logs carry ids, codes and timings, never documents, questions, answers or names (a test asserts it) |
| A compromised container | Non-root users, `cap_drop: ALL`, `no-new-privileges`, read-only root filesystem with small tmpfs mounts, pid and memory limits |
| Telemetry | None. ONNX Runtime (`ORT_DISABLE_TELEMETRY`, `disable_telemetry_events()`), Hugging Face, Next.js and Electron are switched off; a test guards ONNX |

## Import from a link (SSRF)

The backend downloads a URL the user typed, so a hostile link (or a hostile page that redirects) could try to make it reach into this machine, the home or office network, the other containers or a cloud metadata service. Measures, in `domain/url_import.py`, `services/url_import_service.py` and the HTTP adapter:

| Threat | Measure |
|---|---|
| Other schemes (`file:`, `ftp:`, `gopher:`) | Only `http` and `https` |
| Credentials in the link, or sent along | `user:pass@` is refused; no cookies, no `Authorization`, no `.netrc` or proxy from the environment (`trust_env` off), a fresh client per request |
| Loopback, private networks, link-local and cloud metadata (169.254.169.254, fd00:ec2::254), CGNAT (100.64.0.0/10, Alibaba's 100.100.100.200), multicast, unspecified, reserved and documentation ranges | Every address must be global unicast (`ipaddress` plus explicit IPv6 ranges); IPv4-mapped, IPv4-compatible, NAT64, 6to4 and Teredo forms are judged by, or refused for, the address they wrap |
| Local and Docker names (`localhost`, `backend`, `frontend`, `clamav`, `*.internal`, `*.local`, single labels) | Refused by name before any DNS lookup |
| A name with one public and one private answer | Refused: every answer must be public |
| DNS rebinding (public at check time, private at connect time) | The name is resolved once per hop and the connection goes to that vetted IP; Host header and TLS server name (SNI and certificate check) carry the original name |
| Redirects into the network | Not followed by the HTTP client; at most 5 hops, each one parsed and vetted like the first |
| Huge or endless responses | `Content-Length` above the upload limit is refused at once; the body is counted while streaming and cut off at the limit; connect, read and total timeouts |
| Wrong content | Content type PDF, HTML, plain text or Markdown, then the upload's magic and markup checks on the bytes; the malware scan and the HTML text extraction apply as for uploads |
| Abuse as a crawler | One request per import, a descriptive User-Agent, the upload rate limit |

The link is stored with the document (shown in its details); it is never logged.

## Containers

`compose.yaml`: backend and frontend run with `read_only: true`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `pids_limit`, `mem_limit`. Writable: the `/data` volume (backend), and tmpfs for `/tmp` and the Next.js cache. The ClamAV image starts as root, generates its configuration from environment variables into `/etc/clamav` and drops to the clamav user itself, so its root filesystem stays writable and it keeps five capabilities (CHOWN, FOWNER, DAC_OVERRIDE, SETUID, SETGID); signatures live in a volume. Only the web port is published, on `127.0.0.1`.

## Browser

Static CSP in production: `default-src 'self'`, `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob:`, `connect-src 'self'`, `worker-src 'self' blob:`, `object-src 'none'`, `frame-ancestors 'none'`, plus `nosniff`, `X-Frame-Options: DENY` and a strict referrer policy. Document downloads carry their own `sandbox; default-src 'none'` policy.

Review notes (accepted, not bugs): `'unsafe-inline'` for scripts is needed because the App Router streams its payload in inline scripts and the theme script must run before first paint; a nonce policy would need dynamic rendering of every page and is listed as not built. `'wasm-unsafe-eval'` is for PDF.js image decoders (WebAssembly only, not JavaScript eval). `data:` and `blob:` images are canvas output of the PDF viewer. The E2E suite asserts the browser makes no request to any other origin.

## The MCP exception

`/api/mcp` is for MCP clients, which are not browsers: they send no `X-Requested-With` and usually no `Origin`. Like every `/api` request it must carry a loopback `Host` (`localhost`, `127.0.0.1`, `[::1]`; this stops DNS rebinding); for this path the proxy accepts a request without `Origin` or with the app's own origin, and refuses any other `Origin` (including `null`). A web page in a browser always sends an `Origin` on cross-site POST, so it cannot reach the endpoint. Extra headers (`authorization`, `mcp-protocol-version`, `mcp-session-id`) are forwarded for this path only. The tools are read only; `MCP_TOKEN` adds a bearer check. Reviewed again for release: no issue found, no change made. Residual risk: anything on the machine that can call `localhost` can read the library through MCP, which is why the port must not be exposed.

## GDPR

Software is not "GDPR compliant" by itself; it can be built so that compliant operation is possible. Technical measures:

- Minimization (Art. 5): only the question and the top passages go to Anthropic, never whole files (except small scopes in full-context mode, visible in the answer details) and never the user's name. Embeddings, search, OCR and the malware scan run locally.
- No third parties in the browser: no CDN, self-hosted Inter font, no analytics, no external images.
- Transparency (Art. 13): privacy notice in onboarding and in Settings (what data, where it goes, how long, purpose).
- Erasure (Art. 17): deleting a document removes the file, chunks and vectors and redacts the cited snippets in all chats; deleting a chat removes its messages; "Delete all data" also resets the profile; `VACUUM` after mass deletes.
- Portability (Art. 20): Settings, Data, export: a ZIP with chats (JSON and Markdown), settings and the document list.
- Storage limitation: optional automatic deletion after 30, 90 or 365 days, chosen in Settings > Data (off by default; `RETENTION_DAYS` is only the installation default).
- Security (Art. 32): the measures above, content-free logs, backend not reachable from the network.

Known limit: if the model quoted a document in an answer, that wording is part of the answer text and stays until the chat is deleted. Deleting the document does not rewrite answers. The privacy page says so. Anthropic keeps API data for up to 30 days and does not train on it.

Organizational steps for production (not software): a DPA with Anthropic including standard contractual clauses, a transfer impact assessment, an entry in the record of processing activities, a DPIA check, and EU processing through Claude on AWS Bedrock (Frankfurt) or Vertex AI (EU region); optionally zero data retention by agreement.

## Deliberately not built

Login and multi-user (single local workspace by design), TLS (local only; do not expose the port), a nonce based CSP, content disarm and reconstruction for PDFs, rate limits per user (limits are global: 20 questions and 30 uploads per minute), signed desktop builds.
