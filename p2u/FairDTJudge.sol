// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// FairDT[文献] 的链上不当行为判定复现：按原文第 3 轮合约流程（第 37~46 行）与算法 3（Judge）实现。
/// 投诉时：校验 g^SK_r = PK_r → ElGamal 解密得对称密钥 k → Judge：验证 2+l 个 KZG 打开（此处 l = 2，共 4 个），
/// 对称解密输入与输出、按电路门重算并比对 → 不一致即判卖方不当行为，状态改为 not_sold 并向买方退款。
/// KZG 打开验证采用以太坊标准式 e(C − y·G1 + z·ω, G2) · e(−ω, τG2) = 1，调用 BN254 预编译 0x06/0x07/0x08。
contract FairDTJudge {
    uint256 constant P = 21888242871839275222246405745257275088696311157297823662689037894645226208583; // 基域模数
    uint256 constant R = 21888242871839275222246405745257275088548364400416034343698204186575808495617; // 标量域模数
    uint256 constant G2X1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant G2X0 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant G2Y1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant G2Y0 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256[4] public tG2;   // τ·G2（EIP-197 编码：x 虚部、x 实部、y 虚部、y 实部）

    struct Trade { address s; address r; uint256 price; uint64 t; uint8 state;
                   uint256 pkx; uint256 pky; uint256 c1x; uint256 c1y; uint256 c2x; uint256 c2y;
                   uint256 czx; uint256 czy; uint256 cpx; uint256 cpy; }
    mapping(uint256 => Trade) internal tr;   // 不生成 15 个返回值的公开读取函数
    uint8 constant REVEALED = 2; uint8 constant NOT_SOLD = 4;
    event Result(uint256 indexed id, uint8 outcome);   // 1 判卖方不当行为并退款，2 投诉不成立

    struct Op { uint256 z; uint256[2] w; }   // 密文块及其 KZG 见证
    struct Proof { uint256 i; uint256 op; uint256 in1; uint256 in2; uint256[2] wphi; Op out; Op a; Op b; }

    constructor(uint256[4] memory t2) { tG2 = t2; }

    /// 卖方揭示 CK 后的交易状态（原文第 2 轮结束时的状态），价格由买方冻结
    function open(uint256 id, address s, uint256[10] calldata v, uint64 t) external payable {
        Trade storage T = tr[id];
        T.s = s; T.r = msg.sender; T.price = msg.value; T.t = t; T.state = REVEALED;
        T.pkx = v[0]; T.pky = v[1]; T.c1x = v[2]; T.c1y = v[3]; T.c2x = v[4]; T.c2y = v[5];
        T.czx = v[6]; T.czy = v[7]; T.cpx = v[8]; T.cpy = v[9];
    }

    /// 原文第 37~46 行：买方以 {complain, id, SK_r, π} 投诉
    function complain(uint256 id, uint256 sk, Proof calldata pf) external {
        Trade storage T = tr[id];
        require(block.timestamp < T.t && T.state == REVEALED, "state");
        if (!_pkOk(T, sk)) { emit Result(id, 2); return; }          // PK'_r = g^{SK_r} 须等于 PK_r
        if (_judge(T, _elgamal(T, sk), pf)) {                       // k ← ElGamal.Dec(SK_r, CK)；Judge
            T.state = NOT_SOLD;
            payable(T.r).transfer(T.price);
            emit Result(id, 1);
        } else emit Result(id, 2);
    }
    function _pkOk(Trade storage T, uint256 sk) internal view returns (bool) {
        (uint256 px, uint256 py) = _mul(1, 2, sk);
        return px == T.pkx && py == T.pky;
    }
    function _elgamal(Trade storage T, uint256 sk) internal view returns (bytes32) {
        (uint256 sx, uint256 sy) = _mul(T.c1x, T.c1y, sk);
        (sx, sy) = _add(T.c2x, T.c2y, sx, sy == 0 ? 0 : P - sy);
        return keccak256(abi.encodePacked(sx, sy));
    }

    /// 算法 3：Judge(k, C_Z, C_φ, π, PK_com)
    function _judge(Trade storage T, bytes32 k, Proof calldata pf) internal view returns (bool) {
        if (!_kzg(T.cpx, T.cpy, pf.i, uint256(keccak256(abi.encodePacked(pf.op, pf.in1, pf.in2))) % R, pf.wphi)) return false;
        if (!_kzg(T.czx, T.czy, pf.i, uint256(keccak256(abi.encodePacked(pf.out.z))) % R, pf.out.w)) return false;
        if (!_kzg(T.czx, T.czy, pf.in1, uint256(keccak256(abi.encodePacked(pf.a.z))) % R, pf.a.w)) return false;
        if (!_kzg(T.czx, T.czy, pf.in2, uint256(keccak256(abi.encodePacked(pf.b.z))) % R, pf.b.w)) return false;
        return _gateMismatch(k, pf);
    }
    /// Sym.Dec 后按门运算重算并比对：不一致即卖方不当行为
    function _gateMismatch(bytes32 k, Proof calldata pf) internal pure returns (bool) {
        uint256 za = pf.a.z ^ uint256(keccak256(abi.encodePacked(k, pf.in1)));
        uint256 zb = pf.b.z ^ uint256(keccak256(abi.encodePacked(k, pf.in2)));
        uint256 zo = pf.out.z ^ uint256(keccak256(abi.encodePacked(k, pf.i)));
        unchecked { return (pf.op == 1 ? za + zb : za * zb) != zo; }
    }

    /// KZG 打开验证：e(C − y·G1 + z·ω, G2) · e(−ω, τG2) = 1
    function _kzg(uint256 cx, uint256 cy, uint256 z, uint256 y, uint256[2] calldata w) internal view returns (bool) {
        return _pairing(_kzgInput(cx, cy, z, y, w));
    }
    function _kzgInput(uint256 cx, uint256 cy, uint256 z, uint256 y, uint256[2] calldata w) internal view returns (uint256[12] memory inp) {
        (uint256 ax, uint256 ay) = _mul(1, 2, y);
        (inp[0], inp[1]) = _add(cx, cy, ax, ay == 0 ? 0 : P - ay);
        (ax, ay) = _mul(w[0], w[1], z);
        (inp[0], inp[1]) = _add(inp[0], inp[1], ax, ay);
        inp[2] = G2X1; inp[3] = G2X0; inp[4] = G2Y1; inp[5] = G2Y0;
        inp[6] = w[0]; inp[7] = w[1] == 0 ? 0 : P - w[1];
        inp[8] = tG2[0]; inp[9] = tG2[1]; inp[10] = tG2[2]; inp[11] = tG2[3];
    }
    function _pairing(uint256[12] memory inp) internal view returns (bool r) {
        uint256[1] memory out; bool ok;
        assembly { ok := staticcall(gas(), 0x08, inp, 384, out, 32) }
        r = ok && out[0] == 1;
    }
    function _mul(uint256 x, uint256 y, uint256 s) internal view returns (uint256 rx, uint256 ry) {
        uint256[3] memory inp; inp[0] = x; inp[1] = y; inp[2] = s;
        uint256[2] memory o; bool ok;
        assembly { ok := staticcall(gas(), 0x07, inp, 96, o, 64) }
        require(ok, "ecmul"); rx = o[0]; ry = o[1];
    }
    function _add(uint256 x1, uint256 y1, uint256 x2, uint256 y2) internal view returns (uint256 rx, uint256 ry) {
        uint256[4] memory inp; inp[0] = x1; inp[1] = y1; inp[2] = x2; inp[3] = y2;
        uint256[2] memory o; bool ok;
        assembly { ok := staticcall(gas(), 0x06, inp, 128, o, 64) }
        require(ok, "ecadd"); rx = o[0]; ry = o[1];
    }
}
