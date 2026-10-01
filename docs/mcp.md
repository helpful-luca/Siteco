# MCP server

The app can be searched from Claude Desktop and Claude Code. It exposes two read-only tools over
MCP (streamable HTTP). There is no answer generation and no API key involved: the tools return
passages, your MCP client's model writes the answer.

| Tool | Returns |
|---|---|
| `list_documents()` | Ready documents: `id`, `filename`, `kind`, `pages` |
| `search_documents(query, top_k=5, document_ids=null)` | Up to `top_k` passages (at most 10), best first: `source_id`, `document_id`, `filename`, `page`, `heading`, `text` |

`search_documents` runs the same hybrid search as the chat (`RetrievalService`). Documents that are
still processing, failed or deleted are never returned. `query` has at most 500 characters.
`document_ids` narrows the search (ids from `list_documents`, at most 50; unknown ids are ignored).
`source_id` is the id of the passage in the index and stays the same until the document is deleted.

## Connect

Start the app (`make up` or the desktop app), then:

Claude Code:

    claude mcp add --transport http docchat http://localhost:3000/api/mcp

Claude Desktop does not take a local HTTP URL in its config file directly; it starts servers as
commands. Use the `mcp-remote` bridge (needs Node.js) in
`~/Library/Application Support/Claude/claude_desktop_config.json`:

    {
      "mcpServers": {
        "docchat": {
          "command": "npx",
          "args": ["-y", "mcp-remote", "http://localhost:3000/api/mcp", "--allow-http"]
        }
      }
    }

Restart Claude Desktop afterwards. Then ask, for example: "Which protection rating does the Mira
luminaire have according to my documents?"

The port is `APP_PORT` (default 3000). The backend itself also serves the endpoint at
`http://127.0.0.1:8000/api/mcp` when you run it without Docker, but the web app address is the one
to use: it is the one that checks the request origin.

## Token (optional)

By default there is no token: the app is local and single user. To require one, set it in `.env` and
restart:

    MCP_TOKEN=a-long-random-string

Clients must then send `Authorization: Bearer a-long-random-string`:

    claude mcp add --transport http docchat http://localhost:3000/api/mcp \
      --header "Authorization: Bearer a-long-random-string"

With `mcp-remote` add `"--header", "Authorization:${MCP_AUTH}"` to `args` and
`"env": { "MCP_AUTH": "Bearer a-long-random-string" }` to the server entry.

## Security notes

- Only requests addressed to this machine are served: the Host must be `localhost`, `127.0.0.1` or
  `[::1]`. Compose publishes the web port on `127.0.0.1` only. Do not expose the port to a network
  without setting `MCP_TOKEN`, and do not put it on the internet at all: there is no TLS and no
  per-user access control. Everything in the library is readable by whoever can call the tools.
- MCP clients are not browsers: they send `POST` without the `X-Requested-With` header the rest of
  the API requires, and usually without `Origin`. For `/api/mcp` the proxy therefore accepts a
  request with no `Origin` or with the app's own origin, and refuses any other `Origin`. A web page
  in your browser always sends its `Origin`, so it cannot call the endpoint, and a DNS rebinding page
  arrives with a foreign Host. Every other `/api` route keeps the full CSRF guard.
- The server is stateless (JSON responses, no sessions). `GET` and `DELETE` answer 405.
- No telemetry. Passage text is returned to the MCP client you connected; from there it goes to
  whatever model that client uses, so connect only clients you trust with these documents.
- Not built on purpose: OAuth, remote hosting, write tools (upload through MCP), MCP resources and
  prompts.
