// Plays an outside agent buying from Agento over x402: read the catalog, ask for an answer,
// get the price (402), sign a USDC authorization, ask again with the payment, read the answer.
// Usage: BUYER_PRIVATE_KEY=0x… node scripts/agent-buyer.mjs [http://localhost:3000] [product] [query]
//   e.g. node scripts/agent-buyer.mjs http://localhost:3000 markets.new "list=new&limit=3"
// The wallet needs a little USDC on Arc testnet (faucet.circle.com). No Agento account or API key.
import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

const [base = "http://localhost:3000", product = "markets.new", query = "list=new&limit=3"] = process.argv.slice(2);
const key = process.env.BUYER_PRIVATE_KEY;
if (!key) {
  console.error("Set BUYER_PRIVATE_KEY to a wallet with USDC on Arc testnet.");
  process.exit(1);
}
const account = privateKeyToAccount(key);
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64");

const catalog = await (await fetch(`${base}/api/x402`)).json();
const listing = catalog.resources.find((r) => r.resource.endsWith(`/${product}`));
if (!listing) {
  console.error(`No such product. On sale: ${catalog.resources.map((r) => r.resource.split("/").pop()).join(", ")}`);
  process.exit(1);
}
console.log(`Agent ${account.address} wants: ${listing.description} ($${listing.priceUsd})`);

const url = `${base}/api/x402/${product}?${query}`;
const first = await fetch(url);
if (first.status !== 402) {
  console.error(`Expected a price (402), got ${first.status}: ${await first.text()}`);
  process.exit(1);
}
const req = (await first.json()).accepts[0];
console.log(`Seller asks ${Number(req.maxAmountRequired) / 1e6} USDC, paid to ${req.payTo} on ${req.network}`);

const now = Math.floor(Date.now() / 1000);
const authorization = { from: account.address, to: req.payTo, value: req.maxAmountRequired, validAfter: "0", validBefore: String(now + 60), nonce: `0x${randomBytes(32).toString("hex")}` };
const signature = await account.signTypedData({
  domain: { name: req.extra.name, version: req.extra.version, chainId: Number(req.network.split(":")[1]), verifyingContract: req.asset },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: "TransferWithAuthorization",
  message: { ...authorization, value: BigInt(authorization.value), validAfter: 0n, validBefore: BigInt(authorization.validBefore) },
});

const paid = await fetch(url, { headers: { "x-payment": b64({ x402Version: 1, scheme: "exact", network: req.network, payload: { signature, authorization } }) } });
const body = await paid.json();
if (!paid.ok) {
  console.error(`Not served (${paid.status}): ${body.error}`);
  process.exit(1);
}
const receipt = JSON.parse(Buffer.from(paid.headers.get("x-payment-response") ?? "e30=", "base64").toString("utf8"));
console.log(`Paid. Settlement: ${receipt.transaction}`);
console.log(JSON.stringify(body.data, null, 2).slice(0, 1500));
