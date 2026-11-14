// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {WorkOrderFactory} from "../src/WorkOrderFactory.sol";
import {WorkOrderVault} from "../src/WorkOrderVault.sol";

contract WorkOrderVaultTest is Test {
    MockUSDC usdc;
    WorkOrderFactory factory;
    WorkOrderVault vault;

    address payer = makeAddr("payer");
    address agent = makeAddr("agent");
    address dataSeller = makeAddr("dataSeller");
    address modelSeller = makeAddr("modelSeller");
    address stranger = makeAddr("stranger");
    bytes32 plan = keccak256("plan-v1");

    function setUp() public {
        usdc = new MockUSDC();
        factory = new WorkOrderFactory(usdc);
        usdc.mint(payer, 100e6);

        address[] memory payees = new address[](2);
        payees[0] = dataSeller;
        payees[1] = modelSeller;
        uint128[] memory caps = new uint128[](2);
        caps[0] = 3e6;
        caps[1] = 2e6;

        vm.startPrank(payer);
        usdc.approve(address(factory), 6e6);
        vault = WorkOrderVault(factory.open(agent, plan, payees, caps, 6e6));
        vm.stopPrank();
    }

    function test_open_fundsAndRecordsPlan() public view {
        assertEq(usdc.balanceOf(address(vault)), 6e6);
        assertEq(vault.payer(), payer);
        assertEq(vault.agent(), agent);
        assertEq(vault.planHash(), plan);
        assertEq(vault.lineCount(), 2);
        assertEq(factory.vaultFor(payer, plan), address(vault));
    }

    function test_open_revertsWhenCapsExceedFunds() public {
        address[] memory payees = new address[](1);
        payees[0] = dataSeller;
        uint128[] memory caps = new uint128[](1);
        caps[0] = 5e6;
        vm.startPrank(payer);
        usdc.approve(address(factory), 4e6);
        vm.expectRevert(abi.encodeWithSelector(WorkOrderVault.CapsExceedFunds.selector, 5e6, 4e6));
        factory.open(agent, keccak256("p2"), payees, caps, 4e6);
        vm.stopPrank();
    }

    function test_pay_withinCap() public {
        vm.prank(agent);
        vault.pay(0, 1e6, "r1");
        assertEq(usdc.balanceOf(dataSeller), 1e6);
        assertEq(vault.lines(0).spent, 1e6);
    }

    function test_pay_overCapReverts() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(WorkOrderVault.OverCap.selector, 0, 3e6, 4e6));
        vault.pay(0, 4e6, "r1");
    }

    function test_pay_sameRefTwiceReverts() public {
        vm.startPrank(agent);
        vault.pay(0, 1e6, "r1");
        vm.expectRevert(abi.encodeWithSelector(WorkOrderVault.RefUsed.selector, bytes32("r1")));
        vault.pay(0, 1e6, "r1");
        vm.stopPrank();
        assertEq(usdc.balanceOf(dataSeller), 1e6);
    }

    function test_pay_onlyAgent() public {
        vm.prank(stranger);
        vm.expectRevert(WorkOrderVault.NotAgent.selector);
        vault.pay(0, 1e6, "r1");
    }

    function test_x402_authorizeAndSettle() public {
        bytes32 nonce = keccak256("n1");
        vm.prank(agent);
        vault.authorize(0, dataSeller, 1e6, 0, uint64(block.timestamp + 60), nonce);
        // any relayer (x402 facilitator) can settle; the token checks ERC-1271 on the vault
        vm.prank(stranger);
        usdc.transferWithAuthorization(address(vault), dataSeller, 1e6, 0, block.timestamp + 60, nonce, "");
        assertEq(usdc.balanceOf(dataSeller), 1e6);
    }

    function test_x402_wrongPayeeReverts() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(WorkOrderVault.WrongPayee.selector, 0, dataSeller, stranger));
        vault.authorize(0, stranger, 1e6, 0, uint64(block.timestamp + 60), keccak256("n1"));
    }

    function test_x402_unapprovedTransferFails() public {
        vm.prank(stranger);
        vm.expectRevert("bad sig");
        usdc.transferWithAuthorization(address(vault), stranger, 1e6, 0, block.timestamp + 60, keccak256("x"), "");
    }

    function test_x402_tamperedAmountFails() public {
        bytes32 nonce = keccak256("n1");
        vm.prank(agent);
        vault.authorize(0, dataSeller, 1e6, 0, uint64(block.timestamp + 60), nonce);
        vm.expectRevert("bad sig");
        usdc.transferWithAuthorization(address(vault), dataSeller, 2e6, 0, block.timestamp + 60, nonce, "");
    }

    function test_x402_releaseExpiredUnused() public {
        bytes32 nonce = keccak256("n1");
        vm.prank(agent);
        vault.authorize(0, dataSeller, 3e6, 0, uint64(block.timestamp + 60), nonce);
        assertEq(vault.lines(0).spent, 3e6);
        vm.expectRevert(abi.encodeWithSelector(WorkOrderVault.AuthNotReleasable.selector, nonce));
        vault.release(nonce);
        vm.warp(block.timestamp + 61);
        vault.release(nonce);
        assertEq(vault.lines(0).spent, 0);
    }

    function test_x402_releaseAfterSettleReverts() public {
        bytes32 nonce = keccak256("n1");
        vm.prank(agent);
        vault.authorize(0, dataSeller, 1e6, 0, uint64(block.timestamp + 60), nonce);
        usdc.transferWithAuthorization(address(vault), dataSeller, 1e6, 0, block.timestamp + 60, nonce, "");
        vm.warp(block.timestamp + 61);
        vm.expectRevert(abi.encodeWithSelector(WorkOrderVault.AuthNotReleasable.selector, nonce));
        vault.release(nonce);
    }

    function test_close_invalidatesPendingAuth() public {
        bytes32 nonce = keccak256("n1");
        vm.prank(agent);
        vault.authorize(0, dataSeller, 1e6, 0, uint64(block.timestamp + 60), nonce);
        vm.prank(payer);
        vault.close();
        vm.expectRevert("bad sig");
        usdc.transferWithAuthorization(address(vault), dataSeller, 1e6, 0, block.timestamp + 60, nonce, "");
    }

    function test_close_refundsUnspentToPayer() public {
        vm.prank(agent);
        vault.pay(1, 2e6, "r1");
        uint256 before = usdc.balanceOf(payer);
        vm.prank(agent);
        vault.close();
        assertEq(usdc.balanceOf(payer) - before, 4e6);
        assertTrue(vault.closed());
        vm.prank(agent);
        vm.expectRevert(WorkOrderVault.IsClosed.selector);
        vault.pay(0, 1, "r2");
    }

    function test_close_strangerReverts() public {
        vm.prank(stranger);
        vm.expectRevert(WorkOrderVault.NotPayer.selector);
        vault.close();
    }

    function test_setLine_reapprovalRaisesCap() public {
        vm.prank(agent);
        vm.expectRevert();
        vault.pay(1, 2.5e6, "r1");

        vm.prank(payer);
        vault.setLine(1, modelSeller, 2.5e6, keccak256("plan-v2"));
        vm.prank(agent);
        vault.pay(1, 2.5e6, "r1");
        assertEq(vault.planHash(), keccak256("plan-v2"));
    }

    function test_setLine_newPayeeLine() public {
        vm.prank(payer);
        vault.setLine(2, stranger, 1e6, keccak256("plan-v2"));
        vm.prank(agent);
        vault.pay(2, 1e6, "r1");
        assertEq(usdc.balanceOf(stranger), 1e6);
    }

    function test_setLine_onlyPayer() public {
        vm.prank(agent);
        vm.expectRevert(WorkOrderVault.NotPayer.selector);
        vault.setLine(0, agent, 6e6, plan);
    }

    function test_setLine_capsCannotExceedFunds() public {
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(WorkOrderVault.CapsExceedFunds.selector, 7e6, 6e6));
        vault.setLine(0, dataSeller, 5e6, plan);
    }

    function test_topUp_allowsHigherCaps() public {
        vm.startPrank(payer);
        usdc.approve(address(vault), 1e6);
        vault.topUp(1e6);
        vault.setLine(0, dataSeller, 5e6, plan);
        vm.stopPrank();
        assertEq(vault.funded(), 7e6);
    }

    function test_initialize_onlyOnce() public {
        vm.expectRevert(WorkOrderVault.AlreadyInitialized.selector);
        vault.initialize(stranger, stranger, usdc, plan, new address[](0), new uint128[](0), 0);
    }

    function testFuzz_agentNeverExceedsCaps(uint128 a, uint128 b) public {
        vm.startPrank(agent);
        try vault.pay(0, a, "f1") {} catch {}
        try vault.pay(0, b, "f2") {} catch {}
        vm.stopPrank();
        assertLe(usdc.balanceOf(dataSeller), 3e6);
    }
}
