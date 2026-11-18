import { it, expect } from "vitest";
import { sameOrigin } from "../src/lib/request-origin";
it("SEC7 accepts the incoming host behind a local proxy but rejects cross-origin mutations", () => {
  expect(sameOrigin("http://127.0.0.1:3001", "127.0.0.1:3001")).toBe(true);
  expect(sameOrigin("https://tripmate.example", "tripmate.example")).toBe(true);
  for (const value of [
    "https://evil.example",
    "null",
    null,
    "file://tripmate.example",
    "https://tripmate.example/path",
  ])
    expect(sameOrigin(value, "tripmate.example")).toBe(false);
});
