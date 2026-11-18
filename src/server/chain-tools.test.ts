import { expect, it } from "vitest";
import { checkQuestion } from "./chain-tools";

it("refuses chain questions that aren't well formed, before any node is called", () => {
  expect(checkQuestion({ what: "balance", address: "0x0000000000000000000000000000000000000000" })).toHaveProperty("error");
  expect(checkQuestion({ what: "balance", address: "vitalik.eth" })).toHaveProperty("error");
  expect(checkQuestion({ what: "tx", hash: "0x1234" })).toHaveProperty("error");
  expect(checkQuestion({ what: "payment", from: "0x00000000000000000000000000000000000000aa", nonce: "0x01" })).toHaveProperty("error");
  expect(checkQuestion({ what: "send", address: "0x00000000000000000000000000000000000000aa" } as never)).toHaveProperty("error");
  expect(checkQuestion({ what: "balance", address: "0x00000000000000000000000000000000000000aa" })).toEqual({ what: "balance", address: "0x00000000000000000000000000000000000000aa" });
  expect(checkQuestion({ what: "tx", hash: `0x${"ab".repeat(32)}` })).toEqual({ what: "tx", hash: `0x${"ab".repeat(32)}` });
});
