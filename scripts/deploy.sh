#!/usr/bin/env bash
# Deploys the WorkOrderFactory (and its vault implementation) to Arc with Foundry.
#   scripts/deploy.sh testnet        # Arc testnet, chain 5042002
#   scripts/deploy.sh mainnet        # Arc mainnet, chain 5042 (real USDC pays the gas)
# Reads keys from .env.local without printing them. On mainnet it uses MAINNET_DEPLOYER_PRIVATE_KEY
# when set (recommended), else DEPLOYER_PRIVATE_KEY. Prints the address to put in
# FACTORY_ADDRESS (testnet) or MAINNET_FACTORY_ADDRESS (mainnet).
set -euo pipefail
cd "$(dirname "$0")/.."
NET="${1:-}"
case "$NET" in
  testnet) CHAIN=5042002; RPC_DEFAULT="https://rpc.testnet.arc.network"; RPC_VAR=ARC_RPC_URL; ADDR_VAR=FACTORY_ADDRESS ;;
  mainnet) CHAIN=5042; RPC_DEFAULT="https://rpc.mainnet.arc.io"; RPC_VAR=ARC_MAINNET_RPC_URL; ADDR_VAR=MAINNET_FACTORY_ADDRESS ;;
  *) echo "usage: scripts/deploy.sh testnet|mainnet" >&2; exit 2 ;;
esac
set -a; [ -f .env.local ] && . ./.env.local; set +a
export ARC_RPC_URL="${ARC_RPC_URL:-https://rpc.testnet.arc.network}"
export ARC_MAINNET_RPC_URL="${ARC_MAINNET_RPC_URL:-https://rpc.mainnet.arc.io}"
RPC="${!RPC_VAR:-$RPC_DEFAULT}"
if [ "$NET" = mainnet ]; then export DEPLOY_PRIVATE_KEY="${MAINNET_DEPLOYER_PRIVATE_KEY:-${DEPLOYER_PRIVATE_KEY:?set MAINNET_DEPLOYER_PRIVATE_KEY in .env.local}}"; else export DEPLOY_PRIVATE_KEY="${DEPLOYER_PRIVATE_KEY:?set DEPLOYER_PRIVATE_KEY in .env.local}"; fi
GOT=$(cast chain-id --rpc-url "$RPC")
[ "$GOT" = "$CHAIN" ] || { echo "RPC $RPC is chain $GOT, expected $CHAIN. Stopping." >&2; exit 1; }
FROM=$(cast wallet address --private-key "$DEPLOY_PRIVATE_KEY")
BAL=$(cast call 0x3600000000000000000000000000000000000000 "balanceOf(address)(uint256)" "$FROM" --rpc-url "$RPC" | awk '{print $1}')
echo "Deploying from $FROM on Arc $NET (chain $CHAIN); it holds $(awk "BEGIN{printf \"%.4f\", $BAL/1e6}") USDC for gas."
[ "$BAL" -gt 0 ] || { echo "The deployer has no USDC on Arc $NET; gas is paid in USDC. Fund $FROM first (the Add money page can do it)." >&2; exit 1; }
if [ "$NET" = mainnet ] && [ "${CONFIRM:-}" != "yes" ]; then
  read -r -p "This spends real USDC on gas. Type yes to deploy: " ok; [ "$ok" = yes ] || exit 1
fi
cd contracts
forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --slow
echo "Put the WorkOrderFactory address above in $ADDR_VAR in .env.local, then restart the app."
