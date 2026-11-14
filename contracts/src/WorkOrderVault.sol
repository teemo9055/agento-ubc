// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IERC3009 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
}

/// @notice Holds the budget for one approved work order. The agent can only pay
/// approved lines, to the approved payee, up to the approved cap. Unspent funds
/// return to the payer on close.
contract WorkOrderVault {
    using SafeERC20 for IERC20;

    struct Line {
        address payee;
        uint128 cap;
        uint128 spent;
    }

    struct Auth {
        uint32 line;
        uint128 value;
        uint64 validBefore;
        bool released;
    }

    bytes32 private constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes4 private constant ERC1271_MAGIC = 0x1626ba7e;

    address public payer;
    address public agent;
    IERC20 public token;
    bytes32 public planHash;
    uint256 public funded;
    bool public closed;

    Line[] internal _lines;
    mapping(bytes32 => bool) public usedRef;
    mapping(bytes32 => bool) public approvedDigest;
    mapping(bytes32 => Auth) public auths;

    event Paid(uint256 indexed line, address indexed payee, uint256 amount, bytes32 ref);
    event Authorized(uint256 indexed line, address indexed payee, uint256 amount, bytes32 nonce, bytes32 digest);
    event Released(uint256 indexed line, uint256 amount, bytes32 nonce);
    event LineSet(uint256 indexed line, address payee, uint256 cap, bytes32 planHash);
    event ToppedUp(address indexed from, uint256 amount);
    event Closed(address indexed by, uint256 spent, uint256 refunded);

    error NotPayer();
    error NotAgent();
    error IsClosed();
    error AlreadyInitialized();
    error OverCap(uint256 line, uint256 cap, uint256 wouldSpend);
    error WrongPayee(uint256 line, address expected, address got);
    error RefUsed(bytes32 ref);
    error CapsExceedFunds(uint256 caps, uint256 funds);
    error BadLine(uint256 line);
    error AuthNotReleasable(bytes32 nonce);

    modifier onlyPayer() {
        if (msg.sender != payer) revert NotPayer();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    modifier whenOpen() {
        if (closed) revert IsClosed();
        _;
    }

    function initialize(
        address payer_,
        address agent_,
        IERC20 token_,
        bytes32 planHash_,
        address[] calldata payees,
        uint128[] calldata caps,
        uint256 funded_
    ) external {
        if (payer != address(0)) revert AlreadyInitialized();
        require(payer_ != address(0) && agent_ != address(0), "zero address");
        require(payees.length == caps.length, "length");
        payer = payer_;
        agent = agent_;
        token = token_;
        planHash = planHash_;
        funded = funded_;
        for (uint256 i; i < payees.length; ++i) {
            _lines.push(Line(payees[i], caps[i], 0));
            emit LineSet(i, payees[i], caps[i], planHash_);
        }
        _checkCaps();
    }

    // ---------- agent ----------

    /// @notice Direct transfer for an approved line. `ref` makes retries idempotent.
    function pay(uint256 line, uint128 amount, bytes32 ref) external onlyAgent whenOpen {
        if (usedRef[ref]) revert RefUsed(ref);
        usedRef[ref] = true;
        Line storage l = _line(line);
        _spend(line, l, amount);
        token.safeTransfer(l.payee, amount);
        emit Paid(line, l.payee, amount, ref);
    }

    /// @notice Pre-approve an EIP-3009 transferWithAuthorization from this vault
    /// (x402). The token validates it through ERC-1271 against this approval.
    function authorize(uint256 line, address to, uint128 value, uint64 validAfter, uint64 validBefore, bytes32 nonce)
        external
        onlyAgent
        whenOpen
        returns (bytes32 digest)
    {
        if (auths[nonce].validBefore != 0) revert RefUsed(nonce);
        Line storage l = _line(line);
        if (to != l.payee) revert WrongPayee(line, l.payee, to);
        _spend(line, l, value);
        digest = transferAuthDigest(to, value, validAfter, validBefore, nonce);
        approvedDigest[digest] = true;
        auths[nonce] = Auth(uint32(line), value, validBefore, false);
        emit Authorized(line, to, value, nonce, digest);
    }

    /// @notice Return cap from an x402 authorization that expired unused.
    function release(bytes32 nonce) external {
        Auth storage a = auths[nonce];
        if (a.validBefore == 0 || a.released || block.timestamp <= a.validBefore) revert AuthNotReleasable(nonce);
        if (IERC3009(address(token)).authorizationState(address(this), nonce)) revert AuthNotReleasable(nonce);
        a.released = true;
        _lines[a.line].spent -= a.value;
        emit Released(a.line, a.value, nonce);
    }

    // ---------- payer ----------

    /// @notice Re-approval: change a line's payee or cap, or add a line.
    function setLine(uint256 line, address payee, uint128 cap, bytes32 newPlanHash) external onlyPayer whenOpen {
        if (line == _lines.length) {
            _lines.push(Line(payee, cap, 0));
        } else {
            Line storage l = _line(line);
            require(cap >= l.spent, "cap below spent");
            l.payee = payee;
            l.cap = cap;
        }
        planHash = newPlanHash;
        _checkCaps();
        emit LineSet(line, payee, cap, newPlanHash);
    }

    function topUp(uint256 amount) external whenOpen {
        token.safeTransferFrom(msg.sender, address(this), amount);
        funded += amount;
        emit ToppedUp(msg.sender, amount);
    }

    /// @notice Payer can close at any time (cancel); agent closes when done.
    /// Any unsettled x402 authorization becomes invalid.
    function close() external whenOpen {
        if (msg.sender != payer && msg.sender != agent) revert NotPayer();
        closed = true;
        uint256 bal = token.balanceOf(address(this));
        if (bal > 0) token.safeTransfer(payer, bal);
        emit Closed(msg.sender, funded - bal, bal);
    }

    // ---------- views ----------

    function isValidSignature(bytes32 hash, bytes calldata) external view returns (bytes4) {
        return (!closed && approvedDigest[hash]) ? ERC1271_MAGIC : bytes4(0xffffffff);
    }

    function transferAuthDigest(address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        public
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, address(this), to, value, validAfter, validBefore, nonce)
        );
        return keccak256(abi.encodePacked("\x19\x01", IERC3009(address(token)).DOMAIN_SEPARATOR(), structHash));
    }

    function lineCount() external view returns (uint256) {
        return _lines.length;
    }

    function lines(uint256 i) external view returns (Line memory) {
        return _lines[i];
    }

    function allLines() external view returns (Line[] memory) {
        return _lines;
    }

    // ---------- internal ----------

    function _line(uint256 i) internal view returns (Line storage) {
        if (i >= _lines.length) revert BadLine(i);
        return _lines[i];
    }

    function _spend(uint256 i, Line storage l, uint128 amount) internal {
        uint256 next = uint256(l.spent) + amount;
        if (next > l.cap) revert OverCap(i, l.cap, next);
        l.spent = uint128(next);
    }

    function _checkCaps() internal view {
        uint256 total;
        for (uint256 i; i < _lines.length; ++i) {
            total += _lines[i].cap;
        }
        if (total > funded) revert CapsExceedFunds(total, funded);
    }
}
