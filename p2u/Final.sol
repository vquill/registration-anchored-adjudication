// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// 本文（最终版）：双 Merkle 结构——数值树 rootV 与证据树 rootE；权威因子表按（年度，来源）以整表哈希登记，每个（年度，来源）只写一次。
/// 记录的 region 字段为 16 位：高 8 位为所声明的权威来源（1 国家公告，2 地方发布），低 8 位为地区编号
contract DualMerkleArbitration {
    bytes1 constant TAG_V = 0x01;
    bytes1 constant TAG_E = 0x02;
    address public immutable authority;   // 因子表登记方，原型中兼任 TTP
    mapping(uint16 => mapping(uint8 => bytes32)) public tableHash;   // year => src => 整表哈希
    struct Dataset { address owner; uint16 year; uint32 depth; bytes32 rootV; bytes32 rootE; }
    mapping(uint256 => Dataset) public ds;
    mapping(bytes32 => uint64) public evReq;
    uint64 public constant DELTA = 1 days;
    event Ruling(uint256 indexed id, uint32 i, uint8 layer, uint8 outcome); // 1 DO 违约，2 质疑不成立，3 升级 TTP
    event EvidenceDelivered(uint256 indexed id, uint32 i, bytes32 eh, bytes32 salt, bytes rcpt);
    error BadProofLength();

    constructor() { authority = msg.sender; }
    receive() external payable {}

    function registerTable(uint16 year, uint8 src, bytes32 h) external {
        require(msg.sender == authority, "authority only");
        require(tableHash[year][src] == bytes32(0), "already registered");
        tableHash[year][src] = h;
    }
    /// 核算任务由 RA 登记：数据集编号、核算年度与核算主体，DO 不得自行设定
    struct Task { address owner; uint16 year; }
    mapping(uint256 => Task) public task;
    function registerTask(uint256 id, uint16 year, address owner) external {
        require(msg.sender == authority, "authority only");
        require(task[id].owner == address(0), "task exists");
        task[id] = Task(owner, year);
    }
    /// 数据集只能登记一次，且年度与核算主体须与 RA 登记的任务一致；更正须使用新的数据集编号
    function registerDataset(uint256 id, uint16 year, uint32 depth, bytes32 rootV, bytes32 rootE) external {
        Task storage t = task[id];
        require(t.owner == msg.sender && t.year == year, "task mismatch");
        require(ds[id].owner == address(0), "already registered");
        ds[id] = Dataset(msg.sender, year, depth, rootV, rootE);
    }
    function _root(bytes32 leaf, uint32 i, bytes32[] calldata p, uint32 depth) internal pure returns (bytes32 h) {
        if (p.length != depth) revert BadProofLength();
        h = leaf;
        for (uint256 k = 0; k < p.length; k++) h = ((i >> k) & 1) == 0 ? keccak256(abi.encodePacked(h, p[k])) : keccak256(abi.encodePacked(p[k], h));
    }
    function _signer(bytes32 m, bytes calldata sig) internal pure returns (address) {
        bytes32 d = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", m));
        return ecrecover(d, uint8(sig[64]), bytes32(sig[0:32]), bytes32(sig[32:64]));
    }
    /// 返回：签名是否来自 DO、记录是否在数值树中
    function _value(uint256 id, uint32 i, uint16 region, uint32 value, bytes calldata sig, bytes32[] calldata p) internal view returns (bool signedByDO, bool inTree) {
        Dataset storage d = ds[id];
        bytes32 m = keccak256(abi.encodePacked(TAG_V, id, i, d.year, region, value));
        signedByDO = _signer(m, sig) == d.owner;
        inTree = signedByDO && _root(keccak256(abi.encodePacked(TAG_V, m, sig)), i, p, d.depth) == d.rootV;
    }
    /// 不回退的路径校验：深度不符或根不一致均返回 false
    function _rootOk(bytes32 leaf, uint32 i, bytes32[] calldata p, uint32 depth, bytes32 root) internal pure returns (bool) {
        if (p.length != depth) return false;
        bytes32 h = leaf;
        for (uint256 k = 0; k < p.length; k++) h = ((i >> k) & 1) == 0 ? keccak256(abi.encodePacked(h, p[k])) : keccak256(abi.encodePacked(p[k], h));
        return h == root;
    }
    struct ValDisc { uint32 i; uint16 region; uint32 value; bytes sig; bytes dsig; bytes32[] p; }
    /// 第一层·数值一致性：DO 对披露包（叶子与证明路径哈希）签名；签名有效而路径不成立 → DO 违约；DB 改动路径将使签名失效
    function disputeValue(uint256 id, ValDisc calldata d) external {
        Dataset storage s = ds[id];
        bytes32 leaf = keccak256(abi.encodePacked(TAG_V, keccak256(abi.encodePacked(TAG_V, id, d.i, s.year, d.region, d.value)), d.sig));
        uint8 out = 2;
        if (_signer(keccak256(abi.encodePacked(bytes1(0x05), id, d.i, leaf, keccak256(abi.encodePacked(d.p)))), d.dsig) == s.owner
            && !_rootOk(leaf, d.i, d.p, s.depth, s.rootV)) out = 1;
        emit Ruling(id, d.i, 1, out);
    }
    /// 第一层·重复签名：同一位置存在两个 DO 签名的不同记录 → DO 违约（不依赖证明路径）
    function disputeDoubleSign(uint256 id, uint32 i, uint16 r1, uint32 v1, bytes calldata s1, uint16 r2, uint32 v2, bytes calldata s2) external {
        bytes32 m1 = _mv(id, i, r1, v1); bytes32 m2 = _mv(id, i, r2, v2);
        bool ok = m1 != m2 && _signer(m1, s1) == ds[id].owner && _signer(m2, s2) == ds[id].owner;
        emit Ruling(id, i, 1, ok ? 1 : 2);
    }
    function _mv(uint256 id, uint32 i, uint16 r, uint32 v) internal view returns (bytes32) { return keccak256(abi.encodePacked(TAG_V, id, i, ds[id].year, r, v)); }
    /// 第二层·引用一致性：记录在数值树中且与权威因子表不符 → DO 违约
    function disputeReference(uint256 id, uint32 i, uint16 region, uint32 value, bytes calldata sig, bytes32[] calldata p, bytes calldata table, uint256 k) external {
        uint8 out = 2;
        if (_inTree(id, i, region, value, sig, p) && _refMismatch(id, region, value, table, k)) out = 1;
        emit Ruling(id, i, 2, out);
    }
    function _inTree(uint256 id, uint32 i, uint16 region, uint32 value, bytes calldata sig, bytes32[] calldata p) internal view returns (bool) {
        (, bool t) = _value(id, i, region, value, sig, p);
        return t;
    }
    /// 所声明来源的整表哈希与已登记哈希一致，且表中对应条目的数值与记录不符
    function _refMismatch(uint256 id, uint16 region, uint32 value, bytes calldata table, uint256 k) internal view returns (bool) {
        uint16 year = ds[id].year;
        if (keccak256(table) != tableHash[year][uint8(region >> 8)]) return false;
        uint256 o = k * 8;
        return uint16(bytes2(table[o:o + 2])) == year && uint16(bytes2(table[o + 2:o + 4])) == region && uint32(bytes4(table[o + 4:o + 8])) != value;
    }
    /// 第一层/第三层·证据：回执有效而不在证据树中 → DO 替换证据；在证据树中 → 升级 TTP
    function disputeEvidence(uint256 id, uint32 i, bytes32 eh, bytes32 salt, bytes calldata rcpt, bytes32[] calldata p) external {
        Dataset storage d = ds[id];
        bytes32 m = keccak256(abi.encodePacked(TAG_E, id, i, eh, salt));
        uint8 out = 2; uint8 layer = 1;
        if (_signer(keccak256(abi.encodePacked(bytes1(0x06), m, keccak256(abi.encodePacked(p)))), rcpt) == d.owner) {
            if (!_rootOk(keccak256(abi.encodePacked(TAG_E, m)), i, p, d.depth, d.rootE)) out = 1;
            else { out = 3; layer = 3; }
        }
        emit Ruling(id, i, layer, out);
    }
    function requestEvidence(uint256 id, uint32 i) external { evReq[keccak256(abi.encodePacked(id, i))] = uint64(block.timestamp); }
    /// DO 响应须提交与登记一致的依据（证明路径成立）及覆盖该路径的回执
    function respondEvidence(uint256 id, uint32 i, bytes32 eh, bytes32 salt, bytes calldata rcpt, bytes32[] calldata p) external {
        Dataset storage d = ds[id]; bytes32 m = keccak256(abi.encodePacked(TAG_E, id, i, eh, salt));
        require(_signer(keccak256(abi.encodePacked(bytes1(0x06), m, keccak256(abi.encodePacked(p)))), rcpt) == d.owner, "receipt");
        require(_rootOk(keccak256(abi.encodePacked(TAG_E, m)), i, p, d.depth, d.rootE), "not registered");
        delete evReq[keccak256(abi.encodePacked(id, i))];
        emit EvidenceDelivered(id, i, eh, salt, rcpt);
    }
    function claimNoReceipt(uint256 id, uint32 i) external {
        bytes32 key = keccak256(abi.encodePacked(id, i)); uint64 t = evReq[key];
        require(t != 0 && block.timestamp > t + DELTA, "not expired");
        delete evReq[key]; emit Ruling(id, i, 1, 1);
    }
    /// 第三层终局：TTP 签署裁决并结算
    function verdict(uint256 id, uint32 i, uint8 winner, bytes calldata sig) external {
        require(_signer(keccak256(abi.encodePacked(bytes1(0x09), address(this), id, i, winner)), sig) == authority, "ttp sig");
        (bool ok, ) = payable(winner == 1 ? ds[id].owner : msg.sender).call{value: 0.001 ether}(""); require(ok, "pay");
        emit Ruling(id, i, 3, winner == 1 ? 2 : 1);
    }
}

/// 按 Chen 等（INFOCOM 2022）公开描述的方法复现：数据分块（分治）；两类承诺——数据块哈希（DO 签名，不可否认）与块哈希的 Merkle 根（整体承诺）；
/// 先由合约链上仲裁交付块与承诺是否一致，当事方不满意时申请链下仲裁，由仲裁方签名裁决
contract ChunkCommitArbitration {
    address public immutable arbitrator;
    struct Dataset { address owner; uint32 depth; bytes32 root; }
    mapping(uint256 => Dataset) public ds;
    uint256 public offlineCalls;
    event Ruling(uint256 indexed id, uint32 c, uint8 layer, uint8 outcome);
    constructor() { arbitrator = msg.sender; }
    receive() external payable {}
    function registerDataset(uint256 id, uint32 depth, bytes32 root) external { ds[id] = Dataset(msg.sender, depth, root); }
    function _signer(bytes32 m, bytes calldata sig) internal pure returns (address) {
        bytes32 d = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", m));
        return ecrecover(d, uint8(sig[64]), bytes32(sig[0:32]), bytes32(sig[32:64]));
    }
    function _inRoot(uint256 id, uint32 c, bytes32 h, bytes32[] calldata p) internal view returns (bool) {
        bytes32 x = keccak256(abi.encodePacked(c, h));
        for (uint256 k = 0; k < p.length; k++) x = ((c >> k) & 1) == 0 ? keccak256(abi.encodePacked(x, p[k])) : keccak256(abi.encodePacked(p[k], x));
        return x == ds[id].root;
    }
    /// 链上仲裁：DB 提交整块数据与 DO 对块哈希的签名；签名有效而块不在整体承诺中 → DO 违约；否则一致（质疑不成立）
    function arbitrateOnChain(uint256 id, uint32 c, bytes calldata chunk, bytes calldata sig, bytes32[] calldata p) external {
        bytes32 h = keccak256(chunk);
        bool signedByDO = _signer(keccak256(abi.encodePacked(id, c, h)), sig) == ds[id].owner;
        emit Ruling(id, c, 1, (signedByDO && !_inRoot(id, c, h, p)) ? 1 : 2);
    }
    /// 对链上结果不满意：申请链下仲裁
    function requestOffline(uint256 id, uint32 c) external { offlineCalls++; emit Ruling(id, c, 3, 3); }
    function verdict(uint256 id, uint32 c, uint8 winner, bytes calldata sig) external {
        require(_signer(keccak256(abi.encodePacked(bytes1(0x09), address(this), id, c, winner)), sig) == arbitrator, "arb sig");
        (bool ok, ) = payable(winner == 1 ? ds[id].owner : msg.sender).call{value: 0.001 ether}(""); require(ok, "pay");
        emit Ruling(id, c, 3, winner == 1 ? 2 : 1);
    }
}
