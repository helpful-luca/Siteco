import { describe, expect, it } from "vitest";
import {
  checkMutationGuard,
  exceedsBodyLimit,
  forwardRequestHeaders,
  isMcpPath,
  isSafePath,
  pickHeaders,
} from "@/shared/api/proxy-rules";

describe("isSafePath", () => {
  it("accepts normal segments", () =>
    expect(isSafePath(["chats", "c_12", "messages"])).toBe(true));
  it.each([
    [["..", "x"]],
    [["a%2Fb"]],
    [["."]],
    [["a b"]],
    [[]],
    [["health", ""]],
    [["a/b"]],
  ])("rejects %j", (segments) => expect(isSafePath(segments)).toBe(false));
});

describe("checkMutationGuard", () => {
  const headers = (init: Record<string, string>) => new Headers(init);
  const host = "localhost:3000";

  it("allows GET without extra headers", () =>
    expect(checkMutationGuard("GET", headers({}), host)).toBe("ok"));
  it("rejects POST without X-Requested-With", () =>
    expect(
      checkMutationGuard(
        "POST",
        headers({ origin: "http://localhost:3000" }),
        host,
      ),
    ).toBe("FORBIDDEN_ORIGIN"));
  it("rejects POST from a foreign origin", () =>
    expect(
      checkMutationGuard(
        "POST",
        headers({
          origin: "https://evil.example",
          "x-requested-with": "docchat",
        }),
        host,
      ),
    ).toBe("FORBIDDEN_ORIGIN"));
  it("rejects a malformed origin", () =>
    expect(
      checkMutationGuard(
        "POST",
        headers({ origin: "null", "x-requested-with": "docchat" }),
        host,
      ),
    ).toBe("FORBIDDEN_ORIGIN"));
  it("allows POST from the same origin with the header", () =>
    expect(
      checkMutationGuard(
        "POST",
        headers({
          origin: "http://localhost:3000",
          "x-requested-with": "docchat",
        }),
        host,
      ),
    ).toBe("ok"));
  it("allows DELETE without Origin but with the header", () =>
    expect(
      checkMutationGuard(
        "DELETE",
        headers({ "x-requested-with": "docchat" }),
        host,
      ),
    ).toBe("ok"));
});

describe("checkMutationGuard for the MCP endpoint", () => {
  const headers = (init: Record<string, string>) => new Headers(init);
  const mcp = ["mcp"];

  it("recognises only /api/mcp", () => {
    expect(isMcpPath(mcp)).toBe(true);
    expect(isMcpPath(["mcp", "x"])).toBe(false);
    expect(isMcpPath(["documents"])).toBe(false);
  });
  it("allows a client without Origin and without X-Requested-With on localhost", () => {
    for (const host of [
      "localhost:3000",
      "127.0.0.1:3000",
      "[::1]:3000",
      "localhost",
    ]) {
      expect(checkMutationGuard("POST", headers({}), host, mcp)).toBe("ok");
    }
  });
  it("allows the app origin", () =>
    expect(
      checkMutationGuard(
        "POST",
        headers({ origin: "http://localhost:3000" }),
        "localhost:3000",
        mcp,
      ),
    ).toBe("ok"));
  it("rejects a foreign or malformed Origin", () => {
    expect(
      checkMutationGuard(
        "POST",
        headers({ origin: "https://evil.example" }),
        "localhost:3000",
        mcp,
      ),
    ).toBe("FORBIDDEN_ORIGIN");
    expect(
      checkMutationGuard(
        "POST",
        headers({ origin: "null" }),
        "localhost:3000",
        mcp,
      ),
    ).toBe("FORBIDDEN_ORIGIN");
  });
  it("rejects a non-local Host (DNS rebinding, remote access)", () => {
    for (const host of [
      "evil.example:3000",
      "192.168.1.5:3000",
      "localhost.evil.example",
      "",
    ]) {
      expect(checkMutationGuard("POST", headers({}), host, mcp)).toBe(
        "FORBIDDEN_ORIGIN",
      );
    }
  });
  it("rejects a foreign Origin even when the Host is the attacker own", () =>
    expect(
      checkMutationGuard(
        "POST",
        headers({ origin: "http://evil.example:3000" }),
        "evil.example:3000",
        mcp,
      ),
    ).toBe("FORBIDDEN_ORIGIN"));
  it("keeps the CSRF guard for every other path", () => {
    expect(
      checkMutationGuard("POST", headers({}), "localhost:3000", ["chats"]),
    ).toBe("FORBIDDEN_ORIGIN");
    expect(checkMutationGuard("POST", headers({}), "localhost:3000")).toBe(
      "FORBIDDEN_ORIGIN",
    );
  });
});

describe("forwardRequestHeaders", () => {
  it("forwards Authorization and the MCP headers to /api/mcp only", () => {
    const incoming = new Headers({
      authorization: "Bearer t",
      "mcp-protocol-version": "2025-06-18",
      "content-type": "application/json",
      cookie: "a=b",
    });
    const mcp = forwardRequestHeaders(incoming, ["mcp"]);
    expect(mcp.get("authorization")).toBe("Bearer t");
    expect(mcp.get("mcp-protocol-version")).toBe("2025-06-18");
    expect(mcp.get("cookie")).toBeNull();
    const other = forwardRequestHeaders(incoming, ["chats"]);
    expect(other.get("authorization")).toBeNull();
    expect(other.get("content-type")).toBe("application/json");
  });
});

describe("pickHeaders", () => {
  it("keeps only allowlisted headers", () => {
    const out = pickHeaders(
      new Headers({ cookie: "a=b", "content-type": "application/json" }),
      ["content-type"],
    );
    expect(out.get("cookie")).toBeNull();
    expect(out.get("content-type")).toBe("application/json");
  });
});

describe("exceedsBodyLimit", () => {
  it("refuses JSON bodies over 64 KB before they reach the backend", () => {
    expect(exceedsBodyLimit("POST", ["chats"], String(64 * 1024 + 1))).toBe(
      true,
    );
    expect(exceedsBodyLimit("PATCH", ["chats", "c1"], "70000")).toBe(true);
  });

  it("lets small bodies, reads and the raw upload through", () => {
    expect(exceedsBodyLimit("POST", ["chats"], "512")).toBe(false);
    expect(exceedsBodyLimit("POST", ["chats"], null)).toBe(false);
    expect(exceedsBodyLimit("GET", ["documents"], "999999")).toBe(false);
    expect(
      exceedsBodyLimit("POST", ["documents"], String(500 * 1024 * 1024)),
    ).toBe(false);
  });
});
