import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { circleExecute, circleWallets } from "./circle";
// setupProblems reads process.env directly so it works before any wallet call.
import { privateKeyToAccount } from "viem/accounts";
import { arc, arcTestnet } from "viem/chains";
import { NETWORKS, type Net } from "@/lib/networks";

/**
 * Arc, on both networks. Each job runs on one: testnet (free test USDC) or mainnet (real money).
 * `chainOf(net)` gives that network's client, contracts and signing roles; the bare exports below
 * (publicClient, USDC, FACTORY, send, …) are the testnet ones, for code that only ever runs there.
 *
 * Roles on mainnet use their own keys when set (MAINNET_AGENT_PRIVATE_KEY, …), so real money never
 * shares a key with test money by accident; without them the testnet keys are used (same address
 * on every EVM chain). Circle developer-controlled wallets are testnet wallets here.
 */
type Role = "agent" | "client" | "seller";

const key = (name: string) => {
  const v = process.env[name];
  return v ? privateKeyToAccount(v as Hex) : undefined;
};

const keysFor = (net: Net) =>
  net === "mainnet"
    ? { agent: key("MAINNET_AGENT_PRIVATE_KEY") ?? key("AGENT_PRIVATE_KEY"), client: key("MAINNET_CLIENT_PRIVATE_KEY") ?? key("CLIENT_PRIVATE_KEY"), seller: key("MAINNET_SELLER_PRIVATE_KEY") ?? key("SELLER_PRIVATE_KEY") }
    : { agent: key("AGENT_PRIVATE_KEY"), client: key("CLIENT_PRIVATE_KEY"), seller: key("SELLER_PRIVATE_KEY") };

function build(net: Net) {
  const n = NETWORKS[net];
  const chain = net === "mainnet" ? arc : arcTestnet;
  const rpc = http(net === "mainnet" ? (process.env.ARC_MAINNET_RPC_URL ?? n.rpc) : (process.env.ARC_RPC_URL ?? n.rpc));
  const keys = keysFor(net);
  const circle = net === "testnet" ? circleWallets : { agent: undefined, seller: undefined };
  return {
    net,
    chain,
    publicClient: createPublicClient({ chain, transport: rpc }),
    rpc,
    usdc: (net === "testnet" ? (process.env.USDC_ADDRESS as Hex | undefined) : undefined) ?? (n.usdc as Hex),
    factory: (net === "mainnet" ? process.env.MAINNET_FACTORY_ADDRESS : process.env.FACTORY_ADDRESS) as Hex | undefined,
    explorer: net === "testnet" ? (process.env.NEXT_PUBLIC_EXPLORER_URL ?? n.explorer) : n.explorer,
    accounts: keys,
    circle,
    addresses: {
      agent: circle.agent?.address ?? keys.agent?.address,
      client: keys.client?.address,
      seller: circle.seller?.address ?? keys.seller?.address,
    } as Record<Role, Hex | undefined>,
  };
}

const built = new Map<Net, ReturnType<typeof build>>();
export const chainOf = (net: Net = "testnet") => {
  if (!built.has(net)) built.set(net, build(net));
  return built.get(net)!;
};

const test = chainOf("testnet");
export const USDC: Hex = test.usdc;
export const FACTORY = test.factory;
export const EXPLORER = test.explorer;
export const publicClient = test.publicClient;
export const accounts = test.accounts;
export const addresses = test.addresses;

export const wallet = (who: Role, net: Net = "testnet") => {
  const c = chainOf(net);
  const account = c.accounts[who];
  if (!account) throw new Error(`${who} key missing`);
  return createWalletClient({ account, chain: c.chain, transport: c.rpc });
};

export const signerKind = (who: Role, net: Net = "testnet") => (who !== "client" && chainOf(net).circle[who] ? "circle" : chainOf(net).accounts[who] ? "key" : "none");

/** Most a mainnet job may hold in its vault, in USD: real money starts small. */
export const MAINNET_MAX_JOB_USD = Number(process.env.MAINNET_MAX_JOB_USD ?? 5);

export const liveReady = (net: Net = "testnet") => {
  const c = chainOf(net);
  return Boolean(c.factory && c.addresses.agent && c.addresses.client && c.addresses.seller) && setupProblems(net).length === 0;
};

/** Plain-language list of what stops live payments on a network (or the AI) from working on this machine. */
export function setupProblems(net: Net = "testnet"): string[] {
  if (net === "mainnet") {
    const c = chainOf("mainnet");
    const out: string[] = [];
    if (!c.factory) out.push("MAINNET_FACTORY_ADDRESS is not set: deploy the vault factory to Arc mainnet (npm run deploy:mainnet)");
    if (!c.addresses.client) out.push("No mainnet payer wallet: set MAINNET_CLIENT_PRIVATE_KEY (or pay from your passkey wallet)");
    if (!c.addresses.agent) out.push("No mainnet agent wallet: set MAINNET_AGENT_PRIVATE_KEY");
    if (!c.addresses.seller) out.push("No mainnet seller wallet: set MAINNET_SELLER_PRIVATE_KEY");
    return out;
  }
  const out: string[] = [];
  // Behind an injecting proxy (cloud sessions) a placeholder key is fine; on a laptop it isn't.
  const placeholder = (v?: string) => !process.env.HTTPS_PROXY && (!v || /proxy|injected/i.test(v));
  if (!FACTORY) out.push("FACTORY_ADDRESS is not set");
  if (!addresses.client) out.push("CLIENT_PRIVATE_KEY is not set");
  if (!addresses.agent) out.push("No agent wallet: set the CIRCLE_AGENT_* values or AGENT_PRIVATE_KEY");
  if (!addresses.seller) out.push("No seller wallet: set the CIRCLE_SELLER_* values or SELLER_PRIVATE_KEY");
  if ((process.env.CIRCLE_AGENT_WALLET_ID || process.env.CIRCLE_SELLER_WALLET_ID) && placeholder(process.env.CIRCLE_API_KEY))
    out.push("CIRCLE_API_KEY is missing (needed to sign with the Circle agent and seller wallets)");
  if ((process.env.CIRCLE_AGENT_WALLET_ID || process.env.CIRCLE_SELLER_WALLET_ID) && !process.env.CIRCLE_ENTITY_SECRET) out.push("CIRCLE_ENTITY_SECRET is not set");
  return out;
}

/** The AI key is a placeholder in cloud sessions, where a proxy adds the real one. */
export const aiKeyProblem = () => {
  const k = process.env.AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!k) return "AI_API_KEY is not set, so agents use simple rules instead of Gemini";
  if (/proxy|injected/i.test(k) && !process.env.HTTPS_PROXY) return "AI_API_KEY is a placeholder; put your real Gemini API key in .env.local";
  return null;
};

export const usdcAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function authorizationState(address,bytes32) view returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature)",
]);

export const factoryAbi = parseAbi([
  "function open(address agent, bytes32 planRoot, bytes32 orderId, uint256 amount) returns (address)",
  "function vaultFor(address payer, bytes32 orderId) view returns (address)",
  "event Opened(address indexed vault, address indexed payer, address indexed agent, bytes32 planRoot, bytes32 orderId, uint256 funded)",
  "error FailedDeployment()",
  "error CapsExceedFunds(uint256 caps, uint256 funds)",
]);

export const vaultAbi = parseAbi([
  "struct Line { uint32 index; address payee; uint128 cap; }",
  "function pay(Line line, bytes32[] proof, uint128 amount, bytes32 ref)",
  "function authorize(Line line, bytes32[] proof, address to, uint128 value, uint64 validAfter, uint64 validBefore, bytes32 nonce) returns (bytes32)",
  "function release(bytes32 nonce)",
  "function setPlan(bytes32 newRoot)",
  "function planRoot() view returns (bytes32)",
  "function topUp(uint256 amount)",
  "function close()",
  "function funded() view returns (uint256)",
  "function payer() view returns (address)",
  "function agent() view returns (address)",
  "function closed() view returns (bool)",
  "function usedRef(bytes32) view returns (bool)",
  "event Closed(address indexed by, uint256 spent, uint256 refunded)",
  "error NotPayer()",
  "error NotAgent()",
  "error IsClosed()",
  "error NotInPlan(uint256 line)",
  "error OverCap(uint256 line, uint256 cap, uint256 wouldSpend)",
  "error WrongPayee(uint256 line, address expected, address got)",
  "error RefUsed(bytes32 ref)",
  "error AuthNotReleasable(bytes32 nonce)",
]);

const queues = new Map<string, Promise<unknown>>();

/** One in-flight transaction per wallet, so parallel steps never reuse a nonce. */
function serialized<T>(who: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(who) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(job);
  queues.set(who, next);
  return next;
}

/** Sends a tx and returns hash + fee (18-decimal native USDC) once mined. */
export function send(
  who: Role,
  req: { address: Hex; abi: readonly unknown[]; functionName: string; args: readonly unknown[] },
  net: Net = "testnet",
) {
  return serialized(`${net}:${who}`, () => sendNow(who, req, net));
}

async function sendNow(
  who: Role,
  req: { address: Hex; abi: readonly unknown[]; functionName: string; args: readonly unknown[] },
  net: Net,
) {
  const { publicClient, circle } = chainOf(net);
  const cw = who !== "client" ? circle[who] : undefined;
  if (cw) {
    // Simulate first so reverts surface with decoded errors, then let Circle sign and send.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await publicClient.simulateContract({ ...(req as any), account: cw.address });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = encodeFunctionData(req as any);
    const hash = await circleExecute(cw.id, req.address, data);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`tx reverted ${hash}`);
    return { hash, fee: (receipt.gasUsed * receipt.effectiveGasPrice).toString(), receipt };
  }
  const w = wallet(who, net);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { request } = await publicClient.simulateContract({ ...(req as any), account: w.account });
  const hash = await w.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`tx reverted ${hash}`);
  return { hash, fee: (receipt.gasUsed * receipt.effectiveGasPrice).toString(), receipt };
}
