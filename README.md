# 基于登记锚定的碳排放因子争议裁决方法：实验代码

本仓库包含论文《基于登记锚定的碳排放因子争议裁决方法》全部实验的合约、脚本与结果。

## 环境
- Node.js 18 及以上
- Solidity 0.8.26（优化器开启，200 轮，EVM Paris）
- Ganache ：由 env.js 在进程内启动，无需单独安装

## 安装
```
npm install
```
## 运行（在仓库根目录下）
```
node p2u/scale_N.js            # 4.2 规模开销：N=10~10^4 的登记与数值争议开销
node p2u/scale_N.js 100000     # 4.2 N=10^5 一点（单独运行，约需 6 s）
node p2u/fix_test.js           # 4.4 攻击阻断（表3）、4.5 受控来源裁决（表5）及各操作 Gas
node p2u/bind_test.js          # 定理2 绑定必要性：去除任一绑定后的构陷实验
node p2u/realcase_test.js      # 4.5 公开核查案例重放（表4）
node p2u/fairdt_test.js        # 4.6 FairDT 同环境复现（表6、图6）
node p2u/chen_test.js          # 4.6 文献[12]复现
node p2u/zk_test.js            # 4.6 零知识对照
node p2u/scale_test.js         # 4.7 直接存储对照（表7 中直接存储一列）
node p2u/baseline_test.js      # 4.7 基线方案（表7 中基线一列）
```

## 文件说明
- p2u/Final.sol：本文合约；final_build.json 为其编译产物。
- p2u/Accountable.sol：对照合约（AccountableArbitration、BaselineArbitration），由 compile.js 编译为 build.json。
- p2u/FairDTJudge.sol、Chen2022.sol、ZkDispute.sol 与 Verifier.sol：同类方案的同环境复现。
- p2u/ref_result.json：生态环境部、国家统计局发布的 2021、2022 年电力二氧化碳排放因子。
- zk/：零知识对照的电路、证明密钥与验证密钥。
- p2u/*_result.json：各实验的运行结果。

## 说明
- zk_test.js 会打印 10 行 “Error in template RefConsistency”，对应 10 条错误引用无法生成证明，属预期结果。
- 含随机输入的实验，重复运行时 Gas 相差不超过数十。
- scale_test.js 中本文一列来自早期合约，论文仅引用其直接存储一列；本文开销以 fix_test.js 为准。
- 公开核查报告的网址见论文参考文献。
