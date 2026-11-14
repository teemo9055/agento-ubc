// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

interface IERC3009 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
}

/// @notice Holds the budget for one approved work order. The approved plan is
/// committed as a Merkle root of (index, payee, cap) lines: payees and caps stay
/// private until a line is used. The agent can only pay a line it proves is in
/// the root, to that line's payee, up to that line's cap. Unspent funds return
/// to the payer on close.
contract WorkOrderVault {
    using SafeERC20 for IERC20;

    struct Line {
        uint32 index;
        address payee;
        uint128 cap;
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
    /// @notice Merkle root of the approved lines (OpenZeppelin StandardMerkleTree, leaf = (uint32,address,uint128)).
    bytes32 public planRoot;
    uint256 public funded;
    bool public closed;

    mapping(uint256 => uint128) public spent;
    mapping(bytes32 => bool) public usedRef;
    mapping(bytes32 => bool) public approvedDigest;
    mapping(bytes32 => Auth) public auths;

    event Paid(uint256 indexed line, address indexed payee, uint256 amount, bytes32 ref);
    event Authorized(uint256 indexed line, address indexed payee, uint256 amount, bytes32 nonce, bytes32 digest);
    event Released(uint256 indexed line, uint256 amount, bytes32 nonce);
    event PlanSet(bytes32 planRoot);
    event ToppedUp(address indexed from, uint256 amount);
    event Closed(address indexed by, uint256 spent, uint256 refunded);

    error NotPayer();
    error NotAgent();
    error IsClosed();
    error AlreadyInitialized();
    error NotInPlan(uint256 line);
    error OverCap(uint256 line, uint256 cap, uint256 wouldSpend);
    error WrongPayee(uint256 line, address expected, address got);
    error RefUsed(bytes32 ref);
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

    function initialize(address payer_, address agent_, IERC20 token_, bytes32 planRoot_, uint256 funded_) external {
        if (payer != address(0)) revert AlreadyInitialized();
        require(payer_ != address(0) && agent_ != address(0), "zero address");
        payer = payer_;
        agent = agent_;
        token = token_;
        planRoot = planRoot_;
        funded = funded_;
        emit PlanSet(planRoot_);
    }

    // ---------- agent ----------

    /// @notice Direct transfer for an approved line. `ref` makes retries idempotent.
    function pay(Line calldata line, bytes32[] calldata proof, uint128 amount, bytes32 ref) external onlyAgent whenOpen {
        if (usedRef[ref]) revert RefUsed(ref);
        usedRef[ref] = true;
        _spend(line, proof, amount);
        token.safeTransfer(line.payee, amount);
        emit Paid(line.index, line.payee, amount, ref);
    }

    /// @notice Pre-approve an EIP-3009 transferWithAuthorization from this vault
    /// (x402). The token validates it through ERC-1271 against this approval.
    function authorize(
        Line calldata line,
        bytes32[] calldata proof,
        address to,
        uint128 value,
        uint64 validAfter,
        uint64 validBefore,
        bytes32 nonce
    ) external onlyAgent whenOpen returns (bytes32 digest) {
        if (auths[nonce].validBefore != 0) revert RefUsed(nonce);
        if (to != line.payee) revert WrongPayee(line.index, line.payee, to);
        _spend(line, proof, value);
        digest = transferAuthDigest(to, value, validAfter, validBefore, nonce);
        approvedDigest[digest] = true;
        auths[nonce] = Auth(line.index, value, validBefore, false);
        emit Authorized(line.index, to, value, nonce, digest);
    }

    /// @notice Return cap from an x402 authorization that expired unused.
    function release(bytes32 nonce) external {
        Auth storage a = auths[nonce];
        if (a.validBefore == 0 || a.released || block.timestamp <= a.validBefore) revert AuthNotReleasable(nonce);
        if (IERC3009(address(token)).authorizationState(address(this), nonce)) revert AuthNotReleasable(nonce);
        a.released = true;
        spent[a.line] -= a.value;
        emit Released(a.line, a.value, nonce);
    }

    // ---------- payer ----------

    /// @notice Re-approval: replace the plan with a new root (changed price, payee or step).
    function setPlan(bytes32 newRoot) external onlyPayer whenOpen {
        planRoot = newRoot;
        emit PlanSet(newRoot);
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

    function lineLeaf(Line calldata line) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(line.index, line.payee, line.cap))));
    }

    // ---------- internal ----------

    function _spend(Line calldata line, bytes32[] calldata proof, uint128 amount) internal {
        if (!MerkleProof.verifyCalldata(proof, planRoot, lineLeaf(line))) revert NotInPlan(line.index);
        uint256 next = uint256(spent[line.index]) + amount;
        if (next > line.cap) revert OverCap(line.index, line.cap, next);
        spent[line.index] = uint128(next);
    }
}
