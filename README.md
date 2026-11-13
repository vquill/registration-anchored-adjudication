# 基于登记锚定的碳排放因子争议裁决方法：实验代码（修改稿版本）

本仓库包含论文全部实验的合约与脚本。`p2u/FinalRevised.sol` 为修改稿所用合约；`p2u/Final.sol`、`p2u/Batch.sol`、`p2u/Accountable.sol` 为原投稿版本，保留以便对照（原版本结果文件未改动）。

## 环境
- Node.js 18 及以上（实测 Node 22）；`npm ci`（锁文件已将 macOS 专用的 fsevents 标为可选依赖，Linux 下可直接安装）
- Solidity 0.8.26，优化器开启、200 轮，EVM Paris；Ganache 7.9.2 由 env.js 在进程内启动
- 零知识电路：circom 2.1.9，`circom zk/ref.circom --r1cs --O1 -o zk`；编译产物 zk/ref.r1cs 与编译记录 zk/compile_log.txt 已附，`node p2u/zk_info.js` 输出约束数（4 693）与证明密钥规模（nVars=4706，domainSize=2^13）

## 运行
```
node p2u/run_revised.js              # 依次运行下列脚本并汇总为 p2u/revised_summary.json（加 --summary-only 只重新汇总）
node p2u/revised_fix_test.js         # 表2（攻击阻断）、表4（受控来源裁决）、各操作 Gas、密钥撤销与锚定、因子表公示/修订/纠错/复核、案件与裁决
node p2u/revised_bind_test.js        # 定理2 绑定消融
node p2u/revised_batch_realcase_test.js   # 图4 批量来源裁决；表3 公开核查案例重放
node p2u/revised_scale_test.js       # 表6 机制对照（本文/基线/直接存储未打包/打包，含批量）；图3、表1 规模开销
node p2u/revised_outcome_test.js     # 4.5、4.6 节：单次来源争议按判定结果分列（判 DO 违约 / 质疑不成立）
node p2u/revised_batchsig_test.js    # 4.5 节：批量来源裁决与逐条验签对照（BatchSigControl.sol）
node p2u/fairdt_test.js              # FairDT 同环境复现（忠实于原文算法3，4 次配对检验）
node p2u/fairdt_batched_test.js      # FairDT 批量 KZG 验证变体（一次 2 组配对检验）
node p2u/chen_test.js                # 文献[13]复现；HF=istanbul node p2u/chen_hardfork_test.js 为旧版计价下的结果
node p2u/zk_test.js                  # 零知识对照（Groth16）
```

## 表图与脚本、结果文件的对应
| 表图 | 脚本 | 结果文件 |
|---|---|---|
| 表1、图3 | revised_scale_test.js | revised_scale_result.json（scaleN） |
| 表2、表4、各操作 Gas | revised_fix_test.js | revised_result.json |
| 表3 | revised_batch_realcase_test.js | revised_batch_realcase_result.json（cases） |
| 图4 | revised_batch_realcase_test.js | revised_batch_realcase_result.json（batch） |
| 表5、图5 | fairdt_test.js、fairdt_batched_test.js、chen_test.js、zk_test.js、revised_fix_test.js | fairdt_result.json、fairdt_batched_result.json、chen_result.json、zk_result.json |
| 表6 | revised_scale_test.js | revised_scale_result.json（table6） |
| 4.5、4.6 节按判定结果分列的来源争议开销 | revised_outcome_test.js | revised_outcome_result.json |
| 4.5 节逐条验签对照 | revised_batchsig_test.js | revised_batchsig_result.json |
| 定理2 消融 | revised_bind_test.js | revised_bind_result.json |

## 结果说明
- 合约以 Ruling 事件的结果码输出判定：0 不予受理，1 判 DO 违约，2 质疑不成立，3 升级第三方，4 待复核。
- 含随机签名与盐的实验，重复运行时开销随调用数据中零字节的个数小幅波动，相对波动在 0.1% 以内（单次争议在数十 Gas 以内）；论文数值取自仓库中的结果文件，`node p2u/run_revised.js --summary-only` 可由这些文件重新生成汇总。
- 实验以单一账户代表 RA；论文 2.1 节的门限多签由 RA 账户的部署方式（多签钱包）提供，不在本仓库合约内实现。
- 修订版合约所有争议均含押金结算（DB 押金 0.01 ETH，判 DO 违约时退还并从 DO 保证金划付 0.01 ETH）；表 6 中直接存储采用同一规则，基线方案（BaselineRevised）只把押金退给胜诉方，不从 DO 保证金划付赔偿。
- 全量重算对照（FullRecompute.sol）只重算树根，不含签名核验与押金结算；零知识对照不含资金结算；FairDT 与文献[13]按其原方案退款或处置押金。
- 单次来源争议开销随判定结果而异（判 DO 违约时含赔偿划付）。表 6 与图 5 取 38 次争议的平均值（其中 10 次判 DO 违约）；revised_summary.json 的 compare.reduction 按相同判定情形计算降幅：判 DO 违约对应 FairDT 卖方作弊、文献[13]数据内容错误与基线方案，质疑不成立对应 FairDT 卖方诚实与零知识对照（DO 能生成证明）。
- respondEvidence 由数据集所有者账户调用，交付的依据摘要须属于登记的依据树；其中的回执随事件交给 DB，不作归因依据，故不按密钥撤销高度拒收。回执用于争议时由 disputeEvidence 按 _doSigned 判定：密钥撤销后只采信撤销前已锚定的签名，未锚定的转待复核。
- chen_test.js 同时打印文献[13]其余事件（requestData、makeDataAvailable 等）与原文表 I 的对照；论文只使用链上仲裁与链下仲裁记录两项，其余函数为流程所需的简化实现。
- zk_test.js 会打印 10 行 “Error in template RefConsistency”，对应 10 条错误引用无法生成证明，属预期结果。

## 修改稿相对原投稿的代码改动
1. 来源争议只验证数值叶子属于 DO 登记的树根，不再逐条验证叶子签名；数值争议只验证 DO 的披露签名。
2. 第三方裁决建立案件：裁决消息覆盖链标识、合约地址、案件编号、数据集、位置、质疑方与胜诉方，待裁决校验，结案后不再执行同一裁决。
3. RA 与 TTP 分离并可轮换；DO 密钥登记、撤销与 DB 锚定；因子表公示期、异议、正式修订（含强制切换）与登记纠错、复核。
4. 押金与保证金结算，同一记录的同一类违约只赔偿一次；结果码区分不予受理与质疑不成立。
5. 所有 DO 签名消息加入链标识与合约地址（签名域分离）。
6. 零知识对照（ZkDispute.sol）：权威因子表的 Poseidon 树根改由 RA 在部署时登记（原由 DO 在登记数据集时提交）；resolve 未改动，相同输入下逐条 Gas 与原合约一致，zk_result.json 沿用。
