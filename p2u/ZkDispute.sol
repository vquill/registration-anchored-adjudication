// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "./Verifier.sol";

/// 零知识路线的争议合约（与本文的引用一致性裁决功能对等）：
/// ① 记录承诺 recCommit 属于 DO 已登记的数据集（keccak Merkle 证明，深度与本文相同）；② Groth16 证明有效
contract ZkReferenceDispute {
    Groth16Verifier public immutable v;
    struct Dataset { address owner; uint32 depth; bytes32 rootV; uint256 libRoot; }
    mapping(uint256 => Dataset) public ds;
    event Ruling(uint256 indexed id, uint32 i, uint8 layer, uint8 outcome);
    constructor(address _v) { v = Groth16Verifier(_v); }
    function registerDataset(uint256 id, uint32 depth, bytes32 rootV, uint256 libRoot) external { ds[id] = Dataset(msg.sender, depth, rootV, libRoot); }
    function _root(bytes32 leaf, uint32 i, bytes32[] calldata p) internal pure returns (bytes32 h) {
        h = leaf;
        for (uint256 k = 0; k < p.length; k++) h = ((i >> k) & 1) == 0 ? keccak256(abi.encodePacked(h, p[k])) : keccak256(abi.encodePacked(p[k], h));
    }
    function resolve(uint256 id, uint32 i, bytes32[] calldata pDs, uint[2] calldata a, uint[2][2] calldata b, uint[2] calldata c, uint[6] calldata pub) external {
        Dataset storage d = ds[id];
        bool ok = pDs.length == d.depth && pub[0] == d.libRoot && pub[2] == id && pub[3] == i
               && _root(keccak256(abi.encodePacked(pub[1])), i, pDs) == d.rootV && v.verifyProof(a, b, c, pub);
        emit Ruling(id, i, 2, ok ? 2 : 1);
    }
}
