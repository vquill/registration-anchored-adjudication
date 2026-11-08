// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "./FinalRevised.sol";

/// 基线方案（不含签名绑定与来源绑定的常规双 Merkle 承诺）：依据叶子无签名、准入不绑定路径、来源争议须升级第三方。
/// 为与修订版同口径，加入同样的押金规则：准入时留存 DB 押金，第三方裁决后结算。
contract BaselineRevised {
    address public immutable ttp;
    uint256 public constant DEPOSIT = 0.01 ether;
    struct Dataset { address owner; bytes32 rootE; }
    mapping(uint256 => Dataset) public ds;
    struct Case { uint256 id; uint32 i; address db; uint8 state; }
    mapping(uint256 => Case) public cases;
    uint256 public caseCount;
    event Ruling(uint256 indexed id, uint32 i, uint8 layer, uint8 outcome);
    constructor() { ttp = msg.sender; }
    receive() external payable {}
    function registerDataset(uint256 id, bytes32 rootE) external { ds[id] = Dataset(msg.sender, rootE); }
    function disputeEvidence(uint256 id, uint32 i, bytes32 leaf, bytes32[] calldata p) external payable {
        require(msg.value == DEPOSIT, "deposit");
        bytes32 h = leaf;
        for (uint256 k = 0; k < p.length; k++) h = ((i >> k) & 1) == 0 ? keccak256(abi.encodePacked(h, p[k])) : keccak256(abi.encodePacked(p[k], h));
        if (h == ds[id].rootE) { uint256 cid = ++caseCount; cases[cid] = Case(id, i, msg.sender, 1); emit Ruling(id, i, 3, 3); }
        else { emit Ruling(id, i, 1, 2); (bool ok, ) = payable(ds[id].owner).call{value: DEPOSIT}(""); require(ok, "pay"); }
    }
    function verdict(uint256 cid, uint8 winner, bytes calldata sig) external {
        Case storage c = cases[cid];
        require(c.state == 1, "not pending");
        bytes32 m = keccak256(abi.encodePacked(bytes1(0x03), block.chainid, address(this), cid, winner));
        bytes32 d = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", m));
        require(ecrecover(d, uint8(sig[64]), bytes32(sig[0:32]), bytes32(sig[32:64])) == ttp, "ttp sig");
        c.state = 2;
        address to = winner == 1 ? ds[c.id].owner : c.db;
        (bool ok, ) = payable(to).call{value: DEPOSIT}(""); require(ok, "pay");
        emit Ruling(c.id, c.i, 3, winner == 1 ? 2 : 1);
    }
}

/// 直接存储（未打包）：主管部门把因子值逐条写入存储，每个因子值占一个存储槽；争议时读取比对。
/// 记录侧的验证与结算与修订版相同（包含性 + 押金），仅因子表侧不同。
contract DirectUnpackedRevised is DualMerkleArbitrationRevised {
    mapping(uint16 => mapping(uint8 => mapping(uint8 => uint32))) public stored;
    constructor(address ra_, address ttp_) DualMerkleArbitrationRevised(ra_, ttp_) {}
    function registerTableStored(uint16 year, uint8 src, uint32[] calldata vals) external onlyRA {
        for (uint256 r = 0; r < vals.length; r++) stored[year][src][uint8(r)] = vals[r];
    }
    function disputeReferenceStored(uint256 id, RefDispute calldata d) external payable {
        _takeDeposit();
        Dataset storage s = ds[id];
        uint8 out = 0;
        if (s.owner != address(0) && _inTree(s, id, d)) {
            uint32 v = stored[s.year][uint8(d.region >> 8)][uint8(d.region)];
            out = v == 0 ? 0 : (v != d.value ? 1 : 2);
        }
        _settle(id, d.i, 2, K_SOURCE, out, bytes32(0));
    }
}

/// 直接存储（紧凑打包）：8 个 4 B 因子值装入一个存储槽（38 条 → 5 个槽）
contract DirectPackedRevised is DualMerkleArbitrationRevised {
    mapping(uint16 => mapping(uint8 => mapping(uint256 => uint256))) internal words;
    constructor(address ra_, address ttp_) DualMerkleArbitrationRevised(ra_, ttp_) {}
    function registerTablePacked(uint16 year, uint8 src, uint32[] calldata vals) external onlyRA {
        require(words[year][src][0] == 0, "already registered");
        uint256 n = vals.length;
        for (uint256 j = 0; j * 8 < n; j++) {
            uint256 w;
            for (uint256 t = 0; t < 8 && j * 8 + t < n; t++) w |= uint256(vals[j * 8 + t]) << (32 * t);
            words[year][src][j] = w;
        }
    }
    function disputeReferencePacked(uint256 id, RefDispute calldata d) external payable {
        _takeDeposit();
        Dataset storage s = ds[id];
        uint8 out = 0;
        if (s.owner != address(0) && _inTree(s, id, d)) {
            uint256 r = uint8(d.region);
            uint32 v = uint32(words[s.year][uint8(d.region >> 8)][r / 8] >> (32 * (r % 8)));
            out = v == 0 ? 0 : (v != d.value ? 1 : 2);
        }
        _settle(id, d.i, 2, K_SOURCE, out, bytes32(0));
    }
    /// 直接存储的批量争议（与修订版批量接口对应）
    function disputeReferenceBatchPacked(uint256 id, RefDispute[] calldata recs) external payable {
        _takeDeposit();
        Dataset storage s = ds[id];
        uint32 faults; uint32 fresh;
        for (uint256 t = 0; t < recs.length; t++) {
            RefDispute calldata r = recs[t];
            if (_inTree(s, id, r)) {
                uint256 rr = uint8(r.region);
                uint32 v = uint32(words[s.year][uint8(r.region >> 8)][rr / 8] >> (32 * (rr % 8)));
                if (v != 0 && v != r.value) { faults++; if (_firstClaim(id, r.i, K_SOURCE)) fresh++; emit Ruling(id, r.i, 2, 1, bytes32(0)); }
            }
        }
        emit BatchRuling(id, faults, uint32(recs.length));
        if (faults > 0) _pay(msg.sender, DEPOSIT + _penalty(s.owner, fresh)); else _pay(s.owner, DEPOSIT);
    }
}
