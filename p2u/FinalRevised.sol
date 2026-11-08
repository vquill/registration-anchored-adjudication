// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// 修订版合约（对应修改稿）。与原 Final.sol 相比：
///  1. 来源争议与批量来源争议只验证数值叶子属于 DO 登记的树根（登记交易即 DO 对全部叶子的批签名），不再逐条 ecrecover；
///     数值争议只验证 DO 的披露签名，DO 签署了与自身登记不一致的披露即判 DO 违约。
///  2. 权威因子表带状态机：待生效（公示期）→ 生效 / 异议 → 确认；正式修订以新来源编号登记并把旧版标记为“已被取代”；
///     登记错误可撤销并指定纠错版本，受影响记录按纠错版本重新求值（复核）。
///  3. DO 密钥登记与撤销：登记前已锚定（登记树根、链上请求、DB 锚定根）的签名在撤销后仍可归因；未锚定的不予受理。
///  4. 第三层争议建立唯一案件：裁决消息覆盖链标识、合约地址、案件编号、数据集、位置、质疑方与胜诉方，待裁决校验，结案后不可重放。
///  5. 押金与保证金：DB 随争议缴纳押金，判 DO 违约时退还并从 DO 保证金中赔付（同一记录的同一类违约只赔付一次）；质疑不成立或不予受理时押金归 DO。
///  6. 结果码：0 不予受理，1 判 DO 违约，2 质疑不成立，3 升级第三方，4 待复核。
contract DualMerkleArbitrationRevised {
    bytes1 constant TAG_V = 0x01;   // 数值叶子消息
    bytes1 constant TAG_E = 0x02;   // 依据叶子消息
    bytes1 constant TAG_D = 0x05;   // 披露签名
    bytes1 constant TAG_R = 0x06;   // 交付回执
    bytes1 constant TAG_T = 0x09;   // 第三方裁决
    uint64 public constant DELTA = 1 days;          // 依据请求响应时限
    uint64 public constant NOTICE = 7 days;         // 因子表登记公示期
    uint256 public constant DEPOSIT = 0.01 ether;   // DB 押金
    uint256 public constant BOND = 0.1 ether;       // DO 保证金下限
    uint256 public constant PENALTY = 0.01 ether;   // 每次判 DO 违约从保证金划付给 DB 的金额
    bytes32 public immutable DOMAIN;                // keccak256(chainid ‖ address(this))：签名域分离

    address public ra;    // 登记方（可为多签账户）
    address public ttp;   // 当前第三方核查机构验签地址

    struct Key { bytes32 identity; uint64 registeredAt; uint64 revokedAt; }   // 区块高度
    mapping(address => Key) public keys;
    mapping(address => uint256) public bond;

    uint8 constant ABSENT = 0; uint8 constant PENDING = 1; uint8 constant CHALLENGED = 2;
    uint8 constant ACTIVE = 3; uint8 constant SUPERSEDED = 4; uint8 constant REVOKED = 5;
    struct TableRec { bytes32 hash; uint64 registeredAt; uint64 effectiveFrom; uint64 mandatoryFrom; uint8 state; uint8 successor; uint8 replacement; }
    mapping(uint16 => mapping(uint8 => TableRec)) public tables;   // 年度 => 来源编号

    struct Task { address owner; uint16 year; }
    mapping(uint256 => Task) public task;
    struct Dataset { address owner; uint16 year; uint8 depth; uint64 registeredAt; bytes32 rootV; bytes32 rootE; }
    mapping(uint256 => Dataset) public ds;

    mapping(bytes32 => uint64) public anchoredAt;        // DB 锚定的签名摘要树根 => 区块高度
    mapping(uint256 => mapping(uint256 => uint256)) public paid;   // 已赔偿的违约：数据集 => 位图（第 i 条记录第 kind 类违约对应第 i*8+kind 位）
    uint8 constant K_VALUE = 1; uint8 constant K_DOUBLE = 2; uint8 constant K_EVIDENCE = 3; uint8 constant K_SOURCE = 4; uint8 constant K_VERSION = 5; uint8 constant K_NO_RECEIPT = 6; uint8 constant K_TTP = 7;
    struct Req { address db; uint64 at; }
    mapping(bytes32 => Req) public req;                  // 依据请求
    struct Case { uint256 id; uint32 i; address db; uint8 state; }   // state：1 待裁决，2 已终结
    mapping(uint256 => Case) public cases;
    uint256 public caseCount;
    mapping(bytes32 => uint256) public openCase;         // (id,i) => 待裁决案件编号

    struct ValueDispute { uint32 i; uint16 region; uint32 value; bytes sig; bytes dsig; bytes32[] path; }
    struct RefDispute { uint32 i; uint16 region; uint32 value; bytes sig; bytes32[] path; uint256 k; }
    struct EvidenceDispute { uint32 i; bytes32 eh; bytes32 salt; bytes rcpt; bytes32[] path; }
    struct Signed { uint16 region; uint32 value; bytes sig; }
    struct Anchor { bytes32 root; uint32 index; bytes32[] proof; }

    /// outcome：0 不予受理，1 DO 违约，2 质疑不成立，3 升级第三方，4 待复核；ref：第二层为所用因子表哈希，第三层为案件编号
    event Ruling(uint256 indexed id, uint32 i, uint8 layer, uint8 outcome, bytes32 ref);
    event BatchRuling(uint256 indexed id, uint32 doFaults, uint32 total);
    event TableRegistered(uint16 indexed year, uint8 indexed src, bytes32 tableHash, bytes32 announcementHash, uint64 effectiveFrom);
    event TableStateChanged(uint16 indexed year, uint8 indexed src, uint8 state, uint8 related, bytes32 reason);
    event KeyRegistered(address indexed signer, bytes32 identity);
    event KeyRevoked(address indexed signer, bytes32 reason);
    event EvidenceRequested(uint256 indexed id, uint32 i, address db);
    event EvidenceDelivered(uint256 indexed id, uint32 i, bytes32 eh, bytes32 salt, bytes rcpt);
    event CaseOpened(uint256 indexed caseId, uint256 indexed id, uint32 i, address db);
    event CaseClosed(uint256 indexed caseId, uint8 winner);
    event Review(uint256 indexed id, uint32 i, uint8 src, uint8 replacement, uint8 outcome, bytes32 ref);

    modifier onlyRA() { require(msg.sender == ra, "RA only"); _; }
    constructor(address ra_, address ttp_) {
        require(ra_ != address(0) && ttp_ != address(0) && ra_ != ttp_, "roles");
        ra = ra_; ttp = ttp_; DOMAIN = keccak256(abi.encodePacked(block.chainid, address(this)));
    }
    receive() external payable {}
    function setRA(address a) external onlyRA { require(a != address(0)); ra = a; }
    function setTTP(address a) external onlyRA { require(a != address(0)); ttp = a; }

    // ---------------- 密钥与保证金 ----------------
    function registerKey(address signer, bytes32 identity) external onlyRA {
        require(signer != address(0) && keys[signer].registeredAt == 0, "key exists");
        keys[signer] = Key(identity, uint64(block.number), 0);
        emit KeyRegistered(signer, identity);
    }
    /// 撤销由 RA 执行，或由密钥持有人自行申报失密；撤销不可逆，轮换须登记新地址
    function revokeKey(address signer, bytes32 reason) external {
        Key storage k = keys[signer];
        require(msg.sender == ra || msg.sender == signer, "RA or holder");
        require(k.registeredAt != 0 && k.revokedAt == 0, "not active");
        k.revokedAt = uint64(block.number);
        emit KeyRevoked(signer, reason);
    }
    function _keyActive(address a) internal view returns (bool) { Key storage k = keys[a]; return k.registeredAt != 0 && k.revokedAt == 0; }
    function depositBond(address do_) external payable { bond[do_] += msg.value; }
    function releaseBond(address do_, uint256 amount, address to) external onlyRA { bond[do_] -= amount; _pay(to, amount); }

    // ---------------- 权威因子表 ----------------
    function registerTable(uint16 year, uint8 src, bytes32 h, bytes32 announcementHash) external onlyRA {
        require(src != 0 && h != bytes32(0) && tables[year][src].state == ABSENT, "table exists");
        uint64 eff = uint64(block.timestamp) + NOTICE;
        tables[year][src] = TableRec(h, uint64(block.timestamp), eff, 0, PENDING, 0, 0);
        emit TableRegistered(year, src, h, announcementHash, eff);
    }
    /// 公示期内任何人可依公告原文重算并提出异议；异议后须经 RA 确认方可生效
    function objectTable(uint16 year, uint8 src, bytes32 reason) external {
        TableRec storage t = tables[year][src];
        require(t.state == PENDING && block.timestamp < t.effectiveFrom, "not in notice period");
        t.state = CHALLENGED;
        emit TableStateChanged(year, src, CHALLENGED, 0, reason);
    }
    /// RA 在公示期满后对被异议的登记作出确认；公示期内无异议的登记不需要确认
    function confirmTable(uint16 year, uint8 src) external onlyRA {
        TableRec storage t = tables[year][src];
        require(t.state == CHALLENGED, "not challenged");
        require(block.timestamp >= t.effectiveFrom, "notice period");
        t.state = ACTIVE;
        emit TableStateChanged(year, src, ACTIVE, 0, bytes32(0));
    }
    /// 公示期满且无异议：任何人可将登记置为生效（也可不调用，争议时按时间判定）
    function activateTable(uint16 year, uint8 src) external {
        TableRec storage t = tables[year][src];
        require(t.state == PENDING && block.timestamp >= t.effectiveFrom, "notice period");
        t.state = ACTIVE;
        emit TableStateChanged(year, src, ACTIVE, 0, bytes32(0));
    }
    /// 正式修订：旧版本标记为“已被取代”并保留；mandatoryFrom 非零表示此后登记的数据集必须采用新版本，且不得早于修订时刻（不追溯）
    function supersedeTable(uint16 year, uint8 oldSrc, uint8 newSrc, uint64 mandatoryFrom) external onlyRA {
        TableRec storage o = tables[year][oldSrc];
        require(oldSrc != newSrc && _effective(o) && _effective(tables[year][newSrc]), "not effective");
        require(o.state != SUPERSEDED, "already superseded");
        require(mandatoryFrom == 0 || mandatoryFrom >= block.timestamp, "retroactive cutover");
        o.state = SUPERSEDED; o.successor = newSrc; o.mandatoryFrom = mandatoryFrom;
        emit TableStateChanged(year, oldSrc, SUPERSEDED, newSrc, bytes32(0));
    }
    /// 登记错误：撤销并指定纠错版本（replacement 为 0 表示暂无纠错版本，相关争议转复核）
    function revokeTable(uint16 year, uint8 src, uint8 replacement, bytes32 reason) external onlyRA {
        TableRec storage t = tables[year][src];
        require(t.state != ABSENT && t.state != REVOKED, "not registered");
        require(replacement == 0 || (replacement != src && _effective(tables[year][replacement])), "bad replacement");
        t.state = REVOKED; t.replacement = replacement;
        emit TableStateChanged(year, src, REVOKED, replacement, reason);
    }
    function _effective(TableRec storage t) internal view returns (bool) {
        return t.state == ACTIVE || t.state == SUPERSEDED || (t.state == PENDING && block.timestamp >= t.effectiveFrom);
    }
    /// 返回 (状态码, 所用因子表哈希)：3 可用；4 已撤销且无纠错版本（复核）；0 不可用
    function _tableFor(uint16 year, uint8 src) internal view returns (uint8, bytes32) {
        TableRec storage t = tables[year][src];
        if (t.state == REVOKED) { if (t.replacement == 0) return (4, bytes32(0)); t = tables[year][t.replacement]; }
        if (_effective(t)) return (3, t.hash);
        return (0, bytes32(0));
    }

    // ---------------- 登记 ----------------
    function registerTask(uint256 id, uint16 year, address owner) external onlyRA {
        require(task[id].owner == address(0) && _keyActive(owner), "task exists or key inactive");
        task[id] = Task(owner, year);
    }
    function registerDataset(uint256 id, uint16 year, uint8 depth, bytes32 rootV, bytes32 rootE) external {
        Task storage t = task[id];
        require(t.owner == msg.sender && t.year == year, "task mismatch");
        require(ds[id].owner == address(0), "already registered");
        require(_keyActive(msg.sender) && bond[msg.sender] >= BOND, "key inactive or bond");
        ds[id] = Dataset(msg.sender, year, depth, uint64(block.timestamp), rootV, rootE);
    }
    function anchor(bytes32 root) external { if (anchoredAt[root] == 0) anchoredAt[root] = uint64(block.number); }

    // ---------------- 消息与验证 ----------------
    function _mv(uint256 id, uint32 i, uint16 year, uint16 region, uint32 value) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(TAG_V, DOMAIN, id, i, year, region, value)); // POS_V
    }
    function _me(uint256 id, uint32 i, bytes32 eh, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(TAG_E, id, i, eh, salt));
    }
    function _discloseMsg(uint256 id, uint32 i, bytes32 leaf, bytes32 pathHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(TAG_D, DOMAIN, id, i, leaf, pathHash)); // POS_D PATH_D
    }
    function _receiptMsg(bytes32 me, bytes32 pathHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(TAG_R, DOMAIN, me, pathHash)); // PATH_R
    }
    function _signer(bytes32 m, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 d = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", m));
        return ecrecover(d, uint8(sig[64]), bytes32(sig[0:32]), bytes32(sig[32:64]));
    }
    /// DO 签名的可采性：2 可采（签名有效且密钥未撤销，或该签名已在撤销前按区块高度被 DB 锚定）；0 签名无效；4 密钥已撤销且签名未锚定（转复核）
    function _doSigned(address owner, bytes32 m, bytes calldata sig, Anchor calldata a) internal view returns (uint8) {
        if (_signer(m, sig) != owner) return 0;
        uint64 rv = keys[owner].revokedAt;
        if (rv == 0) return 2;
        uint64 at = anchoredAt[a.root];
        return (at != 0 && at < rv && _merkle(keccak256(sig), a.index, a.proof) == a.root) ? 2 : 4;
    }
    function _merkle(bytes32 leaf, uint32 i, bytes32[] calldata p) internal pure returns (bytes32 h) {
        h = leaf;
        for (uint256 k = 0; k < p.length; k++) h = ((i >> k) & 1) == 0 ? keccak256(abi.encodePacked(h, p[k])) : keccak256(abi.encodePacked(p[k], h));
    }
    function _rootOk(bytes32 leaf, uint32 i, bytes32[] calldata p, uint8 depth, bytes32 root) internal pure returns (bool) {
        if (p.length != depth) return false;
        return _merkle(leaf, i, p) == root;
    }
    /// 包含性：数值叶子属于 DO 登记的数值树根（不验证叶子内的签名）
    function _inTree(Dataset storage s, uint256 id, RefDispute calldata d) internal view returns (bool) {
        bytes32 leaf = keccak256(abi.encodePacked(TAG_V, _mv(id, d.i, s.year, d.region, d.value), d.sig));
        return _rootOk(leaf, d.i, d.path, s.depth, s.rootV);
    }
    /// 读取因子表第 k 条：(条目有效, 权威值)
    function _entry(bytes calldata table, uint256 k, uint16 year, uint16 region) internal pure returns (bool, uint32) {
        if (table.length % 8 != 0 || (k + 1) * 8 > table.length) return (false, 0);
        uint256 o = k * 8;
        if (uint16(bytes2(table[o:o + 2])) != year || uint16(bytes2(table[o + 2:o + 4])) != region) return (false, 0);
        return (true, uint32(bytes4(table[o + 4:o + 8])));
    }

    // ---------------- 结算 ----------------
    function _takeDeposit() internal { require(msg.value == DEPOSIT, "deposit"); }
    function _penalty(address do_, uint256 n) internal returns (uint256 p) {
        p = PENALTY * n; uint256 b = bond[do_]; if (p > b) p = b; bond[do_] = b - p;
    }
    /// 同一记录的同一类违约只赔偿一次：首次返回 true 并记位，此后返回 false
    function _firstClaim(uint256 id, uint32 i, uint8 kind) internal returns (bool) {
        uint256 idx = uint256(i) * 8 + kind; uint256 w = idx >> 8; uint256 m = uint256(1) << (idx & 255);
        uint256 v = paid[id][w];
        if (v & m != 0) return false;
        paid[id][w] = v | m; return true;
    }
    function _pay(address to, uint256 amt) internal { (bool ok, ) = payable(to).call{value: amt}(""); require(ok, "pay"); }
    function _settle(uint256 id, uint32 i, uint8 layer, uint8 kind, uint8 out, bytes32 ref) internal {
        emit Ruling(id, i, layer, out, ref);
        address owner = ds[id].owner;
        if (out == 1) _pay(msg.sender, DEPOSIT + (_firstClaim(id, i, kind) ? _penalty(owner, 1) : 0));
        else if (out == 4 || owner == address(0)) _pay(msg.sender, DEPOSIT);
        else _pay(owner, DEPOSIT);
    }

    // ---------------- 第一层 ----------------
    function disputeValue(uint256 id, ValueDispute calldata d, Anchor calldata a) external payable {
        _takeDeposit();
        _settle(id, d.i, 1, K_VALUE, _valueOutcome(id, d, a), bytes32(0));
    }
    function _valueOutcome(uint256 id, ValueDispute calldata d, Anchor calldata a) internal view returns (uint8) {
        Dataset storage s = ds[id];
        if (s.owner == address(0)) return 0;
        bytes32 leaf = keccak256(abi.encodePacked(TAG_V, _mv(id, d.i, s.year, d.region, d.value), d.sig));
        uint8 ok = _doSigned(s.owner, _discloseMsg(id, d.i, leaf, keccak256(abi.encodePacked(d.path))), d.dsig, a);
        if (ok != 2) return ok;
        return _rootOk(leaf, d.i, d.path, s.depth, s.rootV) ? 2 : 1;
    }
    function disputeDoubleSign(uint256 id, uint32 i, Signed calldata x, Signed calldata y, Anchor calldata ax, Anchor calldata ay) external payable {
        _takeDeposit();
        _settle(id, i, 1, K_DOUBLE, _doubleOutcome(id, i, x, y, ax, ay), bytes32(0));
    }
    function _doubleOutcome(uint256 id, uint32 i, Signed calldata x, Signed calldata y, Anchor calldata ax, Anchor calldata ay) internal view returns (uint8) {
        Dataset storage s = ds[id];
        if (s.owner == address(0)) return 0;
        bytes32 m1 = _mv(id, i, s.year, x.region, x.value);
        bytes32 m2 = _mv(id, i, s.year, y.region, y.value);
        uint8 ok = _doSigned(s.owner, m1, x.sig, ax);
        if (ok == 2) ok = _doSigned(s.owner, m2, y.sig, ay);
        if (ok != 2) return ok;
        return m1 != m2 ? 1 : 2;
    }
    function disputeEvidence(uint256 id, EvidenceDispute calldata d, Anchor calldata a) external payable {
        _takeDeposit();
        Dataset storage s = ds[id];
        uint8 out = 0;
        if (s.owner != address(0)) {
            bytes32 me = _me(id, d.i, d.eh, d.salt);
            out = _doSigned(s.owner, _receiptMsg(me, keccak256(abi.encodePacked(d.path))), d.rcpt, a);
            if (out == 2) { // RCPT
                if (!_rootOk(keccak256(abi.encodePacked(TAG_E, me)), d.i, d.path, s.depth, s.rootE)) out = 1; // RCPT_A
                else out = 3;
            }
        }
        if (out == 3) emit Ruling(id, d.i, 3, 3, bytes32(_openCase(id, d.i)));
        else _settle(id, d.i, 1, K_EVIDENCE, out, bytes32(0));
    }
    function _openCase(uint256 id, uint32 i) internal returns (uint256 cid) {
        bytes32 key = keccak256(abi.encodePacked(id, i));
        require(openCase[key] == 0, "case pending");
        cid = ++caseCount;
        cases[cid] = Case(id, i, msg.sender, 1);
        openCase[key] = cid;
        emit CaseOpened(cid, id, i, msg.sender);
    }

    // ---------------- 第二层 ----------------
    function disputeReference(uint256 id, RefDispute calldata d, bytes calldata table) external payable {
        _takeDeposit();
        (uint8 out, bytes32 h) = _refOutcome(id, d, table);
        _settle(id, d.i, 2, K_SOURCE, out, h);
    }
    function _refOutcome(uint256 id, RefDispute calldata d, bytes calldata table) internal view returns (uint8, bytes32) {
        Dataset storage s = ds[id];
        if (s.owner == address(0)) return (0, bytes32(0));
        (uint8 st, bytes32 h) = _tableFor(s.year, uint8(d.region >> 8));
        if (st != 3) return (st, bytes32(0));
        if (keccak256(table) != h || !_inTree(s, id, d)) return (0, bytes32(0));
        (bool ok, uint32 v) = _entry(table, d.k, s.year, d.region);
        if (!ok) return (0, bytes32(0));
        return (v != d.value ? 1 : 2, h);
    }
    /// 批量来源争议：整表哈希只核对一次，逐条只验包含性
    function disputeReferenceBatch(uint256 id, RefDispute[] calldata recs, bytes calldata table) external payable {
        require(recs.length > 0, "empty batch");
        _takeDeposit();
        Dataset storage s = ds[id];
        (uint8 st, bytes32 h) = _tableFor(s.year, uint8(recs[0].region >> 8));
        require(st == 3 && keccak256(table) == h, "table");
        uint32 faults; uint32 fresh;
        for (uint256 t = 0; t < recs.length; t++) {
            RefDispute calldata r = recs[t];
            if (_inTree(s, id, r)) {
                (bool ok, uint32 v) = _entry(table, r.k, s.year, r.region);
                if (ok && v != r.value) { faults++; if (_firstClaim(id, r.i, K_SOURCE)) fresh++; emit Ruling(id, r.i, 2, 1, h); }
            }
        }
        emit BatchRuling(id, faults, uint32(recs.length));
        if (faults > 0) _pay(msg.sender, DEPOSIT + _penalty(s.owner, fresh)); else _pay(s.owner, DEPOSIT);
    }
    /// 版本争议：所声明版本已被正式修订取代且强制切换生效后登记的数据集仍沿用旧版本 → DO 违约
    function disputeVersion(uint256 id, RefDispute calldata d) external payable {
        _takeDeposit();
        Dataset storage s = ds[id];
        uint8 out = 0;
        if (s.owner != address(0) && _inTree(s, id, d)) {
            TableRec storage t = tables[s.year][uint8(d.region >> 8)];
            out = (t.state == SUPERSEDED && t.mandatoryFrom != 0 && s.registeredAt >= t.mandatoryFrom) ? 1 : 2;
        }
        _settle(id, d.i, 2, K_VERSION, out, bytes32(0));
    }
    /// 复核：所声明版本因登记错误被撤销并指定了纠错版本时，按纠错版本重新求值；不收押金、不结算，只发出 Review 事件
    function reviewReference(uint256 id, RefDispute calldata d, bytes calldata table) external {
        Dataset storage s = ds[id];
        uint8 src = uint8(d.region >> 8);
        TableRec storage t = tables[s.year][src];
        require(s.owner != address(0) && t.state == REVOKED && t.replacement != 0, "no replacement");
        (uint8 out, bytes32 h) = _refOutcome(id, d, table);
        emit Review(id, d.i, src, t.replacement, out, h);
    }

    // ---------------- 依据请求与第三层 ----------------
    function requestEvidence(uint256 id, uint32 i, bytes32 leaf, bytes32 pathHash, bytes calldata dsig, Anchor calldata a) external payable {
        _takeDeposit();
        Dataset storage s = ds[id];
        require(s.owner != address(0), "dataset");
        bytes32 key = keccak256(abi.encodePacked(id, i));
        Req memory old = req[key];
        require(old.at == 0 || block.timestamp > old.at + 2 * DELTA, "request pending");
        require(_doSigned(s.owner, _discloseMsg(id, i, leaf, pathHash), dsig, a) == 2, "disclosure");
        req[key] = Req(msg.sender, uint64(block.timestamp));
        emit EvidenceRequested(id, i, msg.sender);
        if (old.at != 0) _pay(s.owner, DEPOSIT);   // 前一请求人逾期未主张，其押金归 DO
    }
    function respondEvidence(uint256 id, uint32 i, bytes32 eh, bytes32 salt, bytes calldata rcpt, bytes32[] calldata path) external {
        Dataset storage s = ds[id];
        require(msg.sender == s.owner, "DO only");
        bytes32 key = keccak256(abi.encodePacked(id, i));
        Req memory r = req[key];
        require(r.at != 0 && block.timestamp <= r.at + DELTA, "no request or expired");
        bytes32 me = _me(id, i, eh, salt);
        require(_signer(_receiptMsg(me, keccak256(abi.encodePacked(path))), rcpt) == s.owner, "receipt");
        require(_rootOk(keccak256(abi.encodePacked(TAG_E, me)), i, path, s.depth, s.rootE), "not registered");
        delete req[key];
        emit EvidenceDelivered(id, i, eh, salt, rcpt);
        _pay(r.db, DEPOSIT);
    }
    function claimNoReceipt(uint256 id, uint32 i) external {
        bytes32 key = keccak256(abi.encodePacked(id, i));
        Req memory r = req[key];
        require(r.at != 0 && r.db == msg.sender, "requester only");
        require(block.timestamp > r.at + DELTA, "not expired");
        delete req[key];
        emit Ruling(id, i, 1, 1, bytes32(0));
        _pay(msg.sender, DEPOSIT + (_firstClaim(id, i, K_NO_RECEIPT) ? _penalty(ds[id].owner, 1) : 0));
    }
    function verdictDigest(uint256 cid, uint8 winner) public view returns (bytes32) {
        Case storage c = cases[cid];
        return keccak256(abi.encodePacked(TAG_T, DOMAIN, cid, c.id, c.i, c.db, winner));
    }
    /// winner：1 DO 胜诉，2 DB 胜诉
    function verdict(uint256 cid, uint8 winner, bytes calldata sig) external {
        Case storage c = cases[cid];
        require(c.state == 1, "case not pending");
        require(winner == 1 || winner == 2, "winner");
        require(_signer(verdictDigest(cid, winner), sig) == ttp, "ttp sig");
        c.state = 2;
        delete openCase[keccak256(abi.encodePacked(c.id, c.i))];
        emit CaseClosed(cid, winner);
        address owner = ds[c.id].owner;
        if (winner == 2) { emit Ruling(c.id, c.i, 3, 1, bytes32(cid)); _pay(c.db, DEPOSIT + (_firstClaim(c.id, c.i, K_TTP) ? _penalty(owner, 1) : 0)); }
        else { emit Ruling(c.id, c.i, 3, 2, bytes32(cid)); _pay(owner, DEPOSIT); }
    }
}
