#!/usr/bin/env bash
# Local chain with Arc's chain id, mock USDC (EIP-3009 + ERC-1271) and the factory.
# Writes .env.local so `npm run dev` uses it. Needs Foundry (anvil, forge, cast).
set -euo pipefail
cd "$(dirname "$0")/.."

RPC=http://127.0.0.1:8545
# Anvil's well-known dev keys. Never use them on a real network.
K0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
K1=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
K2=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
K3=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6

up() { curl -sf -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' $RPC >/dev/null 2>&1; }

if ! up; then
  # Prefer Arc's own fork of anvil (simulates Arc's USDC and value rules); fall back to plain anvil.
  if command -v arc-anvil >/dev/null 2>&1; then
    nohup arc-anvil --network arc --chain-id 5042002 --block-time 1 --silent >/dev/null 2>&1 &
  else
    echo "Note: arc-anvil not found; plain anvil runs a standard EVM, not Arc's."
    nohup anvil --chain-id 5042002 --block-time 1 --silent >/dev/null 2>&1 &
  fi
  for _ in $(seq 1 20); do up && break; sleep 0.5; done
fi

OUT=$(cd contracts && DEPLOYER_PRIVATE_KEY=$K0 CLIENT_ADDRESS=$(cast wallet address $K2) \
  forge script script/DeployLocal.s.sol --rpc-url $RPC --broadcast 2>&1)
USDC=$(echo "$OUT" | awk '/  USDC/ {print $2}')
FACTORY=$(echo "$OUT" | awk '/FACTORY/ {print $2}')
if [ -z "$USDC" ] || [ -z "$FACTORY" ]; then echo "$OUT"; echo "Deploy failed" >&2; exit 1; fi

OUT_FILE=.env.local
if [ -f .env.local ]; then OUT_FILE=.env.anvil; fi
cat > $OUT_FILE <<ENV
ARC_RPC_URL=$RPC
USDC_ADDRESS=$USDC
FACTORY_ADDRESS=$FACTORY
AGENT_PRIVATE_KEY=$K1
CLIENT_PRIVATE_KEY=$K2
SELLER_PRIVATE_KEY=$K3
SELLER_ADDRESS=$(cast wallet address $K3)
MIRROR_ADDRESS=0x000000000000000000000000000000000000B0B0
APP_URL=http://localhost:3000
ENV
echo "Local chain ready. USDC $USDC · factory $FACTORY · wrote $OUT_FILE"
if [ "$OUT_FILE" != .env.local ]; then echo "Your .env.local was left untouched. To use the local chain, back it up and copy .env.anvil over it."; fi
