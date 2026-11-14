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
    bytes32 orderId = keccak256("order-1");

    WorkOrderVault.Line l0;
    WorkOrderVault.Line l1;
    bytes32 root;

    // OpenZeppelin StandardMerkleTree leaf and sorted-pair hashing.
    function _leaf(WorkOrderVault.Line memory l) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(l.index, l.payee, l.cap))));
    }

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    function _proof(bytes32 sibling) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = sibling;
    }

    function setUp() public {
        usdc = new MockUSDC();
        factory = new WorkOrderFactory(usdc);
        usdc.mint(payer, 100e6);
        l0 = WorkOrderVault.Line(0, dataSeller, 3e6);
        l1 = WorkOrderVault.Line(1, modelSeller, 2e6);
        root = _pair(_leaf(l0), _leaf(l1));

        vm.startPrank(payer);
        usdc.approve(address(factory), 6e6);
        vault = WorkOrderVault(factory.open(agent, root, orderId, 6e6));
        vm.stopPrank();
    }

    function test_open_fundsAndCommitsOnlyTheRoot() public view {
        assertEq(usdc.balanceOf(address(vault)), 6e6);
        assertEq(vault.payer(), payer);
        assertEq(vault.agent(), agent);
        assertEq(vault.planRoot(), root);
        assertEq(factory.vaultFor(payer, orderId), address(vault));
    }

    function test_pay_withinCapWithProof() public {
        vm.prank(agent);
        vault.pay(l0, _proof(_leaf(l1)), 1e6, "r1");
        assertEq(usdc.balanceOf(dataSeller), 1e6);
        assertEq(vault.spent(0), 1e6);
    }

    function test_pay_lineNotInPlanReverts() public {
        WorkOrderVault.Line memory fake = WorkOrderVault.Line(0, stranger, 3e6);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(WorkOrderVault.NotInPlan.selector, 0));
        vault.pay(fake, _proof(_leaf(l1)), 1e6, "r1");
    }

    function test_pay_forgedHigherCapReverts() public {
        WorkOrderVault.Line memory inflated = WorkOrderVault.Line(0, dataSeller, 50e6);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(WorkOrderVault.NotInPlan.selector, 0));
        vault.pay(inflated, _proof(_leaf(l1)), 4e6, "r1");
    }

    function test_pay_overCapReverts() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(WorkOrderVault.OverCap.selector, 0, 3e6, 4e6));
        vault.pay(l0, _proof(_leaf(l1)), 4e6, "r1");
    }

    function test_pay_sameRefTwiceReverts() public {
        vm.startPrank(agent);
        vault.pay(l0, _proof(_leaf(l1)), 1e6, "r1");
        vm.expectRevert(abi.encodeWithSelector(WorkOrderVault.RefUsed.selector, bytes32("r1")));
        vault.pay(l0, _proof(_leaf(l1)), 1e6, "r1");
        vm.stopPrank();
        assertEq(usdc.balanceOf(dataSeller), 1e6);
    }

    function test_pay_onlyAgent() public {
        bytes32[] memory p = _proof(_leaf(l1));
        vm.prank(stranger);
        vm.expectRevert(WorkOrderVault.NotAgent.selector);
        vault.pay(l0, p, 1e6, "r1");
    }

    function test_x402_authorizeAndSettle() public {
        bytes32 nonce = keccak256("n1");
        vm.prank(agent);
        vault.authorize(l0, _proof(_leaf(l1)), dataSeller, 1e6, 0, uint64(block.timestamp + 60), nonce);
        vm.prank(stranger); // any relayer (x402 facilitator) can settle
        usdc.transferWithAuthorization(address(vault), dataSeller, 1e6, 0, block.timestamp + 60, nonce, "");
        assertEq(usdc.balanceOf(dataSeller), 1e6);
    }

    function test_x402_wrongPayeeReverts() public {
        bytes32[] memory p = _proof(_leaf(l1));
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(WorkOrderVault.WrongPayee.selector, 0, dataSeller, stranger));
        vault.authorize(l0, p, stranger, 1e6, 0, uint64(block.timestamp + 60), keccak256("n1"));
    }

    function test_x402_unapprovedTransferFails() public {
        vm.prank(stranger);
        vm.expectRevert("bad sig");
        usdc.transferWithAuthorization(address(vault), stranger, 1e6, 0, block.timestamp + 60, keccak256("x"), "");
    }

    function test_x402_tamperedAmountFails() public {
        bytes32 nonce = keccak256("n1");
        vm.prank(agent);
        vault.authorize(l0, _proof(_leaf(l1)), dataSeller, 1e6, 0, uint64(block.timestamp + 60), nonce);
        vm.expectRevert("bad sig");
        usdc.transferWithAuthorization(address(vault), dataSeller, 2e6, 0, block.timestamp + 60, nonce, "");
    }

    function test_x402_releaseExpiredUnused() public {
        bytes32 nonce = keccak256("n1");
        vm.prank(agent);
        vault.authorize(l0, _proof(_leaf(l1)), dataSeller, 3e6, 0, uint64(block.timestamp + 60), nonce);
        assertEq(vault.spent(0), 3e6);
        vm.expectRevert(abi.encodeWithSelector(WorkOrderVault.AuthNotReleasable.selector, nonce));
        vault.release(nonce);
        vm.warp(block.timestamp + 61);
        vault.release(nonce);
        assertEq(vault.spent(0), 0);
    }

    function test_x402_releaseAfterSettleReverts() public {
        bytes32 nonce = keccak256("n1");
        vm.prank(agent);
        vault.authorize(l0, _proof(_leaf(l1)), dataSeller, 1e6, 0, uint64(block.timestamp + 60), nonce);
        usdc.transferWithAuthorization(address(vault), dataSeller, 1e6, 0, block.timestamp + 60, nonce, "");
        vm.warp(block.timestamp + 61);
        vm.expectRevert(abi.encodeWithSelector(WorkOrderVault.AuthNotReleasable.selector, nonce));
        vault.release(nonce);
    }

    function test_close_invalidatesPendingAuth() public {
        bytes32 nonce = keccak256("n1");
        vm.prank(agent);
        vault.authorize(l0, _proof(_leaf(l1)), dataSeller, 1e6, 0, uint64(block.timestamp + 60), nonce);
        vm.prank(payer);
        vault.close();
        vm.expectRevert("bad sig");
        usdc.transferWithAuthorization(address(vault), dataSeller, 1e6, 0, block.timestamp + 60, nonce, "");
    }

    function test_close_refundsUnspentToPayer() public {
        vm.prank(agent);
        vault.pay(l1, _proof(_leaf(l0)), 2e6, "r1");
        uint256 before = usdc.balanceOf(payer);
        vm.prank(agent);
        vault.close();
        assertEq(usdc.balanceOf(payer) - before, 4e6);
        assertTrue(vault.closed());
        bytes32[] memory p = _proof(_leaf(l1));
        vm.prank(agent);
        vm.expectRevert(WorkOrderVault.IsClosed.selector);
        vault.pay(l0, p, 1, "r2");
    }

    function test_close_strangerReverts() public {
        vm.prank(stranger);
        vm.expectRevert(WorkOrderVault.NotPayer.selector);
        vault.close();
    }

    function test_setPlan_reapprovalRaisesCap() public {
        bytes32[] memory p = _proof(_leaf(l0));
        vm.prank(agent);
        vm.expectRevert();
        vault.pay(l1, p, 2.5e6, "r1");

        WorkOrderVault.Line memory l1b = WorkOrderVault.Line(1, modelSeller, 2.5e6);
        vm.prank(payer);
        vault.setPlan(_pair(_leaf(l0), _leaf(l1b)));
        vm.prank(agent);
        vault.pay(l1b, _proof(_leaf(l0)), 2.5e6, "r1");
        assertEq(usdc.balanceOf(modelSeller), 2.5e6);
    }

    function test_setPlan_onlyPayer() public {
        vm.prank(agent);
        vm.expectRevert(WorkOrderVault.NotPayer.selector);
        vault.setPlan(bytes32(0));
    }

    function test_topUp() public {
        vm.startPrank(payer);
        usdc.approve(address(vault), 1e6);
        vault.topUp(1e6);
        vm.stopPrank();
        assertEq(vault.funded(), 7e6);
    }

    function test_initialize_onlyOnce() public {
        vm.expectRevert(WorkOrderVault.AlreadyInitialized.selector);
        vault.initialize(stranger, stranger, usdc, root, 0);
    }

    function testFuzz_agentNeverExceedsCaps(uint128 a, uint128 b) public {
        bytes32[] memory p = _proof(_leaf(l1));
        vm.startPrank(agent);
        try vault.pay(l0, p, a, "f1") {} catch {}
        try vault.pay(l0, p, b, "f2") {} catch {}
        vm.stopPrank();
        assertLe(usdc.balanceOf(dataSeller), 3e6);
    }

    function testFuzz_forgedLinesNeverPay(address payee, uint128 cap, uint128 amount) public {
        vm.assume(payee != dataSeller || cap != 3e6);
        WorkOrderVault.Line memory forged = WorkOrderVault.Line(0, payee, cap);
        bytes32[] memory p = _proof(_leaf(l1));
        vm.prank(agent);
        try vault.pay(forged, p, amount, "f1") {
            fail();
        } catch {}
    }
}
