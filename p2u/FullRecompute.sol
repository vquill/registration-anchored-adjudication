// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// 全量重算基线：不引入 Merkle 证明，争议时提交全部数值叶子，合约在链上重算树根后比对（不引入承诺结构的朴素实现）
contract FullRecompute {
    mapping(uint256 => bytes32) public root;
    event Ruling(uint256 indexed id, uint32 i, uint8 outcome);
    function registerDataset(uint256 id, bytes32 r) external { root[id] = r; }
    function disputeFull(uint256 id, uint32 i, bytes32 leaf, bytes32[] calldata leaves) external {
        uint256 n = leaves.length;
        bytes32[] memory lv = new bytes32[](n);
        for (uint256 k = 0; k < n; k++) lv[k] = leaves[k];
        while (n > 1) {
            uint256 m = (n + 1) / 2;
            for (uint256 k = 0; k < m; k++) {
                bytes32 a = lv[2 * k]; bytes32 b = 2 * k + 1 < n ? lv[2 * k + 1] : a;
                lv[k] = keccak256(abi.encodePacked(a, b));
            }
            n = m;
        }
        emit Ruling(id, i, (lv[0] == root[id] && leaves[i] == leaf) ? 2 : 1);
    }
}
