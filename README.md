# 基于登记锚定的碳排放因子争议裁决方法：实验代码

本仓库包含论文《基于登记锚定的碳排放因子争议裁决方法》全部实验的合约与脚本。实验结果由脚本运行生成，写入 p2u 目录下对应的 *_result.json 文件。

## 环境
- Node.js 18 及以上
- Solidity 0.8.26（优化器开启，200 轮，EVM Paris）
- Ganache ：由 env.js 在进程内启动

## 安装
```
npm install
```

## 运行（在仓库根目录下）
```
node p2u/scale_N.js 10,50,100,200,500,1000,2000,4000,5000,10000   # 4.2 规模开销（图3）与单条争议提交量（表1）
node p2u/scale_N.js 100000     # 4.2 N=10^5 一点（单独运行，约需 6 s），结果并入同一文件
node p2u/fix_test.js           # 4.4 攻击阻断（表2）、4.5 受控来源裁决（表4）及各操作 Gas
node p2u/bind_test.js          # 定理2 绑定必要性：去除任一绑定后的构陷实验
node p2u/realcase_test.js      # 4.5 公开核查案例重放（表3）
node p2u/batch_test.js         # 4.5 批量来源裁决（图4）
node p2u/fairdt_test.js        # 4.6 FairDT 同环境复现（表5、图5）
node p2u/chen_test.js          # 4.6 文献[13]复现（图5）
node p2u/zk_test.js            # 4.6 零知识对照（图5）
node p2u/scale_test.js         # 4.7 直接存储对照（表6 中直接存储一列）
node p2u/baseline_test.js      # 4.7 基线方案（表6 中基线一列、图5）
```

## 文件说明
- p2u/Final.sol：本文合约；p2u/final_build.json 为其编译产物，供 fix_test.js 与 realcase_test.js 读取。
- p2u/Batch.sol：批量来源裁决合约（DualMerkleBatch），由 batch_test.js 与 Final.sol 一并编译。
- p2u/Accountable.sol：对照合约（AccountableArbitration、BaselineArbitration），由 `node p2u/compile.js` 编译为 p2u/build.json。
- p2u/FullRecompute.sol：全量重算对照合约，由 scale_N.js 编译。
- p2u/FairDTJudge.sol、Chen2022.sol、ZkDispute.sol 与 Verifier.sol：同类方案的同环境复现。
- p2u/ref_result.json：输入数据，即生态环境部、国家统计局发布的 2021、2022 年电力二氧化碳排放因子，由各脚本读取。
- zk/：零知识对照的电路、证明密钥与验证密钥。

## 结果说明
- 合约以 Ruling 事件的结果码输出判定：1 为判 DO 违约，2 为未判 DO 违约，3 为升级 TTP。论文表2依据各测试情形的提交材料与协议准入规则，将结果码 2 区分为“不予受理”与“质疑不成立”。
- 多次运行的实验取均值。含随机输入的实验，Gas 随调用数据中零字节的个数变化：单次争议重复运行相差数十，全量重算在 N=4 000 时可相差数百。

## 运行提示
- zk_test.js 会打印 10 行 “Error in template RefConsistency”，对应 10 条错误引用无法生成证明，属预期结果。
- scale_test.js 中本文一列来自早期合约，论文仅引用其直接存储一列；本文开销以 fix_test.js 为准。
- 公开核查报告的网址见论文参考文献。