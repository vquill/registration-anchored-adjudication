pragma circom 2.0.0;
include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/mux1.circom";

// 零知识路线（按可验证碳核算的方法实现）：证明核算记录引用的因子值是权威因子表中的条目，且与 DO 的记录承诺一致，不暴露数值
template RefConsistency(D) {
    signal input root;          // 公开：权威因子表的 Poseidon Merkle 根
    signal input recCommit;     // 公开：DO 对该记录的承诺 Poseidon(id, i, year, region, value, salt)
    signal input id; signal input i; signal input year; signal input region;   // 公开
    signal input value; signal input salt; signal input pathIdx; signal input sib[D];  // 私有

    component leaf = Poseidon(3); leaf.inputs[0] <== year; leaf.inputs[1] <== region; leaf.inputs[2] <== value;
    component bits = Num2Bits(D); bits.in <== pathIdx;
    signal cur[D + 1]; cur[0] <== leaf.out;
    component h[D]; component mL[D]; component mR[D];
    for (var k = 0; k < D; k++) {
        mL[k] = Mux1(); mL[k].c[0] <== cur[k]; mL[k].c[1] <== sib[k]; mL[k].s <== bits.out[k];
        mR[k] = Mux1(); mR[k].c[0] <== sib[k]; mR[k].c[1] <== cur[k]; mR[k].s <== bits.out[k];
        h[k] = Poseidon(2); h[k].inputs[0] <== mL[k].out; h[k].inputs[1] <== mR[k].out; cur[k + 1] <== h[k].out;
    }
    root === cur[D];
    component rc = Poseidon(6);
    rc.inputs[0] <== id; rc.inputs[1] <== i; rc.inputs[2] <== year; rc.inputs[3] <== region; rc.inputs[4] <== value; rc.inputs[5] <== salt;
    recCommit === rc.out;
}
component main {public [root, recCommit, id, i, year, region]} = RefConsistency(6);
