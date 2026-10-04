// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// 按 Chen 等（INFOCOM 2022）原文第 IV-C 节与算法 1 复现：数据 S 分为大部分 S1（链下交付）与小部分 S2（链上公开）；
/// Tag(S) = Hash(S1) ⊕ Hash(S2)；链上仲裁检验异或是否等于 Tag(S)；Tag 一致而数据无用时由 DB 申请链下仲裁，仲裁方调用合约记录结果
contract Chen2022Trading {
    address public immutable arbitrator; address public immutable buyer; address public immutable owner;
    enum St { Init, Requested, SenderProof, ReceiverProof, Available, BuyerSuspect, OffchainPending, Closed }
    St public st;
    bytes32 public tag; bytes32 public h1; bytes32 public s2;
    uint256 public fee; uint256 public ownerPenalty; uint256 public buyerPenalty;
    event Verdict(uint8 who); // 1 DO 恶意，2 DB 恶意

    constructor(address _buyer, address _owner) { arbitrator = msg.sender; buyer = _buyer; owner = _owner; }
    function requestData() external { require(msg.sender == buyer && st == St.Init); st = St.Requested; }
    function publishSenderProof(bytes32 _tag, bytes32 _h1) external payable {
        require(msg.sender == owner && st == St.Requested); tag = _tag; h1 = _h1; ownerPenalty = msg.value; st = St.SenderProof;
    }
    function publishReceiverProof(uint256 _fee) external payable {
        require(msg.sender == buyer && st == St.SenderProof && msg.value > _fee); fee = _fee; buyerPenalty = msg.value - _fee; st = St.ReceiverProof;
    }
    function makeDataAvailable(bytes32 _s2) external { require(msg.sender == owner && st == St.ReceiverProof); s2 = _s2; st = St.Available; }
    /// 算法 1
    function onChainArbitrate() external {
        require(msg.sender == buyer && st == St.Available);
        if (h1 ^ keccak256(abi.encodePacked(s2)) == tag) { st = St.BuyerSuspect; emit Verdict(2); }
        else { st = St.Closed; (bool ok, ) = payable(buyer).call{value: fee + buyerPenalty + ownerPenalty}(""); require(ok); emit Verdict(1); }
    }
    /// 仲裁方线下审查后调用合约记录结果并处置押金（原文表 I 的 Off-chain arbitrate 事件）
    function offChainArbitrate(uint8 who) external {
        require(msg.sender == arbitrator && (st == St.BuyerSuspect || st == St.Available)); st = St.Closed;
        address to = who == 1 ? buyer : owner;
        (bool ok, ) = payable(to).call{value: fee + buyerPenalty + ownerPenalty}(""); require(ok); emit Verdict(who);
    }
}
