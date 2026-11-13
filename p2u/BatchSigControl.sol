// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "./FinalRevised.sol";

/// 逐条验签对照（4.5 节）：批量来源争议在包含性之外逐条验证叶子内的 DO 签名（原投稿式(4)的 Ver 项），
/// 其余逻辑与修订版 disputeReferenceBatch 相同，用于测量“登记交易批量认证”相对逐条验签节省的开销。
contract BatchSigControl is DualMerkleArbitrationRevised {
    constructor(address ra_, address ttp_) DualMerkleArbitrationRevised(ra_, ttp_) {}
    function disputeReferenceBatchSig(uint256 id, RefDispute[] calldata recs, bytes calldata table) external payable {
        require(recs.length > 0, "empty batch");
        _takeDeposit();
        Dataset storage s = ds[id];
        (uint8 st, bytes32 h) = _tableFor(s.year, uint8(recs[0].region >> 8));
        require(st == 3 && keccak256(table) == h, "table");
        uint32 faults; uint32 fresh;
        for (uint256 t = 0; t < recs.length; t++) {
            RefDispute calldata r = recs[t];
            if (_inTree(s, id, r) && _signer(_mv(id, r.i, s.year, r.region, r.value), r.sig) == s.owner) {
                (bool ok, uint32 v) = _entry(table, r.k, s.year, r.region);
                if (ok && v != r.value) { faults++; if (_firstClaim(id, r.i, K_SOURCE)) fresh++; emit Ruling(id, r.i, 2, 1, h); }
            }
        }
        emit BatchRuling(id, faults, uint32(recs.length));
        if (faults > 0) _pay(msg.sender, DEPOSIT + _penalty(s.owner, fresh)); else _pay(s.owner, DEPOSIT);
    }
}
