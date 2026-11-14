import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { circleExecute, circleWallets } from "./circle";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

export const USDC: Hex = (process.env.USDC_ADDRESS as Hex) ?? "0x3600000000000000000000000000000000000000";
export const FACTORY = process.env.FACTORY_ADDRESS as Hex | undefined;
export const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://explorer.testnet.arc.io";

const rpc = http(process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network");
export const publicClient = createPublicClient({ chain: arcTestnet, transport: rpc });

const key = (name: string) => {
  const v = process.env[name];
  return v ? privateKeyToAccount(v as Hex) : undefined;
};

export const accounts = {
  agent: key("AGENT_PRIVATE_KEY"),
  client: key("CLIENT_PRIVATE_KEY"),
  seller: key("SELLER_PRIVATE_KEY"),
};

export const wallet = (who: keyof typeof accounts) => {
  const account = accounts[who];
  if (!account) throw new Error(`${who} key missing`);
  return createWalletClient({ account, chain: arcTestnet, transport: rpc });
};

/** Addresses of the app's roles: a Circle wallet when configured, else the local key. */
export const addresses = {
  agent: circleWallets.agent?.address ?? accounts.agent?.address,
  client: accounts.client?.address,
  seller: circleWallets.seller?.address ?? accounts.seller?.address,
};

export const signerKind = (who: keyof typeof accounts) => (who !== "client" && circleWallets[who] ? "circle" : accounts[who] ? "key" : "none");

export const liveReady = () => Boolean(FACTORY && addresses.agent && addresses.client && addresses.seller);

export const usdcAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function authorizationState(address,bytes32) view returns (bool)",
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
  who: keyof typeof accounts,
  req: { address: Hex; abi: readonly unknown[]; functionName: string; args: readonly unknown[] },
) {
  return serialized(who, () => sendNow(who, req));
}

async function sendNow(
  who: keyof typeof accounts,
  req: { address: Hex; abi: readonly unknown[]; functionName: string; args: readonly unknown[] },
) {
  const cw = who !== "client" ? circleWallets[who] : undefined;
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
  const w = wallet(who);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { request } = await publicClient.simulateContract({ ...(req as any), account: w.account });
  const hash = await w.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`tx reverted ${hash}`);
  return { hash, fee: (receipt.gasUsed * receipt.effectiveGasPrice).toString(), receipt };
}
