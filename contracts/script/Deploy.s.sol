// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {WorkOrderFactory} from "../src/WorkOrderFactory.sol";

contract Deploy is Script {
    function run() external {
        address usdc = vm.envOr("USDC_ADDRESS", address(0x3600000000000000000000000000000000000000));
        // A separate key for real money when one is given (scripts/deploy.sh sets it for mainnet).
        vm.startBroadcast(vm.envOr("DEPLOY_PRIVATE_KEY", vm.envUint("DEPLOYER_PRIVATE_KEY")));
        WorkOrderFactory factory = new WorkOrderFactory(IERC20(usdc));
        vm.stopBroadcast();
        console.log("WorkOrderFactory", address(factory));
        console.log("WorkOrderVault implementation", factory.implementation());
    }
}
