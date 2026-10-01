import { describe, expect, it } from "vitest";
import {
  checkRequestGuard,
  exceedsBodyLimit,
  forwardRequestHeaders,
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

describe("checkRequestGuard", () => {
  it("answers only requests addressed to this machine, for every method (DNS rebinding)", () => {
    const rebound = "evil.example:3000";
    expect(checkRequestGuard("GET", headers({}), rebound)).toBe("FORBIDDEN_ORIGIN");
    expect(
      checkRequestGuard(
        "POST",
        headers({ "x-requested-with": "docchat", origin: "http://evil.example:3000" }),
        rebound,
      ),
    ).toBe("FORBIDDEN_ORIGIN");
    for (const local of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "localhost"]) {
      expect(checkRequestGuard("GET", headers({}), local)).toBe("ok");
    }
    expect(checkRequestGuard("GET", headers({}), "")).toBe("FORBIDDEN_ORIGIN");
  });

  const headers = (init: Record<string, string>) => new Headers(init);
  const host = "localhost:3000";

  it("allows GET without extra headers", () =>
    expect(checkRequestGuard("GET", headers({}), host)).toBe("ok"));
  it("rejects POST without X-Requested-With", () =>
    expect(
      checkRequestGuard(
        "POST",
        headers({ origin: "http://localhost:3000" }),
        host,
      ),
    ).toBe("FORBIDDEN_ORIGIN"));
  it("rejects POST from a foreign origin", () =>
    expect(
      checkRequestGuard(
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
      checkRequestGuard(
        "POST",
        headers({ origin: "null", "x-requested-with": "docchat" }),
        host,
      ),
    ).toBe("FORBIDDEN_ORIGIN"));
  it("allows POST from the same origin with the header", () =>
    expect(
      checkRequestGuard(
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
      checkRequestGuard(
        "DELETE",
        headers({ "x-requested-with": "docchat" }),
        host,
      ),
    ).toBe("ok"));
});

describe("forwardRequestHeaders", () => {
  it("drops credentials and cookies before the request reaches the backend", () => {
    const out = forwardRequestHeaders(
      new Headers({
        authorization: "Bearer t",
        cookie: "a=b",
        "content-type": "application/json",
      }),
    );
    expect(out.get("authorization")).toBeNull();
    expect(out.get("cookie")).toBeNull();
    expect(out.get("content-type")).toBe("application/json");
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
