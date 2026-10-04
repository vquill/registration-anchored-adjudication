// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// 简化原型：双向可归因承诺 + 版本感知的历史适用性 + 三层最小充分裁决
contract AccountableArbitration {
    bytes1 constant TAG_V = 0x01;
    bytes1 constant TAG_E = 0x02;
    address public immutable authority; // 因子库版本登记方（主管部门）
    struct Version { bytes32 chainRoot; uint64 validFrom; uint64 validTo; }
    mapping(uint32 => Version) public versions;
    uint32 public latest;
    struct Dataset { address owner; uint32 ver; uint64 period; uint32 depth; bytes32 rootV; bytes32 rootE; }
    mapping(uint256 => Dataset) public ds;
    uint256 public ttpCalls;
    event Ruling(uint256 indexed id, uint32 i, uint8 layer, uint8 outcome); // outcome：1 DO 违约，2 质疑不成立，3 升级 TTP
    error BadProofLength();
    error UnknownVersion();

    constructor() { authority = msg.sender; }

    /// 版本链：R(e) = H(e ‖ libRoot ‖ R(e−1))，新版本生效即为上一版本的失效时刻
    function registerVersion(bytes32 libRoot, uint64 validFrom) external {
        require(msg.sender == authority, "authority only");
        uint32 e = latest + 1;
        if (latest > 0) versions[latest].validTo = validFrom;
        versions[e] = Version(keccak256(abi.encodePacked(e, libRoot, versions[latest].chainRoot)), validFrom, type(uint64).max);
        latest = e;
    }

    function registerDataset(uint256 id, uint32 ver, uint64 period, uint32 depth, bytes32 rootV, bytes32 rootE) external {
        if (versions[ver].chainRoot == bytes32(0)) revert UnknownVersion();
        ds[id] = Dataset(msg.sender, ver, period, depth, rootV, rootE);
    }

    function _root(bytes32 leaf, uint32 i, bytes32[] calldata p, uint32 depth) internal pure returns (bytes32 h) {
        if (p.length != depth) revert BadProofLength(); // 固定深度：封堵内部节点冒充叶子
        h = leaf;
        for (uint256 k = 0; k < p.length; k++) {
            h = ((i >> k) & 1) == 0 ? keccak256(abi.encodePacked(h, p[k])) : keccak256(abi.encodePacked(p[k], h));
        }
    }

    function _signer(bytes32 m, bytes calldata sig) internal pure returns (address) {
        bytes32 d = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", m));
        return ecrecover(d, uint8(sig[64]), bytes32(sig[0:32]), bytes32(sig[32:64]));
    }

    /// 第一层（数值一致性）：DO 签名有效而不在承诺中 → DO 违约；签名无效或与承诺一致 → 质疑不成立
    function disputeValue(uint256 id, uint32 i, int256 v, bytes calldata sig, bytes32[] calldata p) external {
        Dataset storage d = ds[id];
        bytes32 m = keccak256(abi.encodePacked(TAG_V, id, i, d.ver, v));
        uint8 out = 2;
        if (_signer(m, sig) == d.owner && _root(keccak256(abi.encodePacked(TAG_V, m, sig)), i, p, d.depth) != d.rootV) out = 1;
        emit Ruling(id, i, 1, out);
    }

    /// 证据：DB 出示 DO 签署的交付回执。回执无效 → 质疑不成立；回执有效而不在承诺中 → DO 替换证据（第一层）；
    /// 回执有效且与承诺一致 → 仅剩证据充分性问题，升级 TTP（第三层）
    function disputeEvidence(uint256 id, uint32 i, bytes32 eh, bytes32 salt, bytes calldata rcpt, bytes32[] calldata p) external {
        Dataset storage d = ds[id];
        bytes32 m = keccak256(abi.encodePacked(TAG_E, id, i, d.ver, eh, salt));
        uint8 out = 2;
        uint8 layer = 1;
        if (_signer(m, rcpt) == d.owner) {
            if (_root(keccak256(abi.encodePacked(TAG_E, m)), i, p, d.depth) != d.rootE) out = 1;
            else { out = 3; layer = 3; ttpCalls++; }
        }
        emit Ruling(id, i, layer, out);
    }

    /// 第三层的终局：TTP 签署裁决，合约验证签名并向胜诉方结算押金（两个合约实现相同，便于公平比较）
    function verdict(uint256 id, uint32 i, uint8 winner, bytes calldata sig) external {
        bytes32 m = keccak256(abi.encodePacked(bytes1(0x03), address(this), id, i, winner));
        require(_signer(m, sig) == authority, "ttp sig");
        address to = winner == 1 ? ds[id].owner : msg.sender;
        (bool ok, ) = payable(to).call{value: 0.001 ether}("");
        require(ok, "pay");
        emit Ruling(id, i, 3, winner == 1 ? 2 : 1);
    }

    receive() external payable {}

    /// 拒绝出具回执的处置：DB 在链上请求证据，DO 须在 DELTA 内连同交付回执提交；逾期即判 DO 违约
    uint64 public constant DELTA = 1 days;
    mapping(bytes32 => uint64) public evReq;
    event EvidenceDelivered(uint256 indexed id, uint32 i, bytes32 eh, bytes32 salt, bytes rcpt);

    function requestEvidence(uint256 id, uint32 i) external { evReq[keccak256(abi.encodePacked(id, i))] = uint64(block.timestamp); }

    function respondEvidence(uint256 id, uint32 i, bytes32 eh, bytes32 salt, bytes calldata rcpt) external {
        Dataset storage d = ds[id];
        require(_signer(keccak256(abi.encodePacked(TAG_E, id, i, d.ver, eh, salt)), rcpt) == d.owner, "receipt");
        delete evReq[keccak256(abi.encodePacked(id, i))];
        emit EvidenceDelivered(id, i, eh, salt, rcpt);
    }

    function claimNoReceipt(uint256 id, uint32 i) external {
        bytes32 key = keccak256(abi.encodePacked(id, i));
        uint64 t = evReq[key];
        require(t != 0 && block.timestamp > t + DELTA, "not expired");
        delete evReq[key];
        emit Ruling(id, i, 1, 1);
    }

    /// 第二层（规则可判定）：核算期不在所声明版本的有效期内 → DO 违约（版本过期或回滚）
    function disputeVersion(uint256 id) external {
        Dataset storage d = ds[id];
        Version storage v = versions[d.ver];
        emit Ruling(id, 0, 2, (d.period >= v.validFrom && d.period < v.validTo) ? 2 : 1);
    }
}

/// 基线：按原论文设计——证据叶子 H(H(e) ‖ r) 无签名、证据准入直接接收叶子且不校验路径长度、无版本信息
contract BaselineArbitration {
    address public immutable ttp;
    constructor() { ttp = msg.sender; }
    struct Dataset { address owner; bytes32 rootE; }
    mapping(uint256 => Dataset) public ds;
    uint256 public ttpCalls;
    event Ruling(uint256 indexed id, uint32 i, uint8 layer, uint8 outcome);

    function registerDataset(uint256 id, bytes32 rootE) external { ds[id] = Dataset(msg.sender, rootE); }

    /// δ = 1（路径成立）→ 升级 TTP；δ = 0 → 质疑不成立
    function disputeEvidence(uint256 id, uint32 i, bytes32 leaf, bytes32[] calldata p) external {
        bytes32 h = leaf;
        for (uint256 k = 0; k < p.length; k++) {
            h = ((i >> k) & 1) == 0 ? keccak256(abi.encodePacked(h, p[k])) : keccak256(abi.encodePacked(p[k], h));
        }
        if (h == ds[id].rootE) { ttpCalls++; emit Ruling(id, i, 3, 3); }
        else emit Ruling(id, i, 1, 2);
    }

    function verdict(uint256 id, uint32 i, uint8 winner, bytes calldata sig) external {
        bytes32 m = keccak256(abi.encodePacked(bytes1(0x03), address(this), id, i, winner));
        bytes32 d = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", m));
        require(ecrecover(d, uint8(sig[64]), bytes32(sig[0:32]), bytes32(sig[32:64])) == ttp, "ttp sig");
        address to = winner == 1 ? ds[id].owner : msg.sender;
        (bool ok, ) = payable(to).call{value: 0.001 ether}("");
        require(ok, "pay");
        emit Ruling(id, i, 3, winner == 1 ? 2 : 1);
    }

    receive() external payable {}
}
