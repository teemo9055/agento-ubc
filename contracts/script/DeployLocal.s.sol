// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";
import {WorkOrderFactory} from "../src/WorkOrderFactory.sol";

/// Local chain only: mock USDC (EIP-3009 + ERC-1271) and a factory.
contract DeployLocal is Script {
    function run() external {
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        MockUSDC usdc = new MockUSDC();
        usdc.mint(vm.envAddress("CLIENT_ADDRESS"), 100e6);
        WorkOrderFactory factory = new WorkOrderFactory(IERC20(address(usdc)));
        vm.stopBroadcast();
        console.log("USDC", address(usdc));
        console.log("FACTORY", address(factory));
    }
}
