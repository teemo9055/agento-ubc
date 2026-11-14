// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {WorkOrderVault} from "./WorkOrderVault.sol";

/// @notice Opens one vault per approved work order and funds it in the same call.
contract WorkOrderFactory {
    using SafeERC20 for IERC20;

    address public immutable implementation;
    IERC20 public immutable token;

    event Opened(
        address indexed vault, address indexed payer, address indexed agent, bytes32 planHash, uint256 funded
    );

    constructor(IERC20 token_) {
        token = token_;
        implementation = address(new WorkOrderVault());
    }

    function open(
        address agent,
        bytes32 planHash,
        address[] calldata payees,
        uint128[] calldata caps,
        uint256 amount
    ) external returns (address vault) {
        vault = Clones.cloneDeterministic(implementation, keccak256(abi.encode(msg.sender, planHash)));
        token.safeTransferFrom(msg.sender, vault, amount);
        WorkOrderVault(vault).initialize(msg.sender, agent, token, planHash, payees, caps, amount);
        emit Opened(vault, msg.sender, agent, planHash, amount);
    }

    function vaultFor(address payer, bytes32 planHash) external view returns (address) {
        return Clones.predictDeterministicAddress(implementation, keccak256(abi.encode(payer, planHash)), address(this));
    }
}
