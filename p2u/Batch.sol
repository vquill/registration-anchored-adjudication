// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "./Final.sol";

/// 批量引用一致性裁决：一笔交易裁决多条记录，权威表整表哈希只核对一次（在最终合约上派生，原有逻辑不变）
contract DualMerkleBatch is DualMerkleArbitration {
    struct Rec { uint32 i; uint16 region; uint32 value; bytes sig; bytes32[] p; uint256 k; }
    event BatchRuling(uint256 indexed id, uint32 doFaults, uint32 total);

    function disputeReferenceBatch(uint256 id, Rec[] calldata recs, bytes calldata table) external {
        require(keccak256(table) == tableHash[ds[id].year][uint8(recs[0].region >> 8)], "table");
        uint32 faults;
        for (uint256 t = 0; t < recs.length; t++) {
            Rec calldata r = recs[t];
            if (_inTree(id, r.i, r.region, r.value, r.sig, r.p) && _entryMismatch(ds[id].year, r.region, r.value, table, r.k)) {
                faults++; emit Ruling(id, r.i, 2, 1);
            }
        }
        emit BatchRuling(id, faults, uint32(recs.length));
    }

    function _entryMismatch(uint16 year, uint16 region, uint32 value, bytes calldata table, uint256 k) internal pure returns (bool) {
        uint256 o = k * 8;
        return uint16(bytes2(table[o:o + 2])) == year && uint16(bytes2(table[o + 2:o + 4])) == region && uint32(bytes4(table[o + 4:o + 8])) != value;
    }
}
