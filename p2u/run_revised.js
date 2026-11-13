// 运行修订版全部实验并汇总论文所用数字：node p2u/run_revised.js
// 只由现有结果文件重新生成汇总（不重跑实验）：node p2u/run_revised.js --summary-only
// 同类方案（FairDT、文献[13]、零知识对照）的合约未改动，其结果文件沿用原投稿版本；如需重测，单独运行 fairdt_test.js、chen_test.js、zk_test.js
const {spawnSync}=require('child_process'), fs=require('fs');
const scripts=['p2u/revised_fix_test.js','p2u/revised_bind_test.js','p2u/revised_batch_realcase_test.js','p2u/revised_scale_test.js','p2u/revised_outcome_test.js','p2u/revised_batchsig_test.js','p2u/fairdt_batched_test.js'];
const SUMMARY_ONLY=process.argv.includes('--summary-only');
for(const s of (SUMMARY_ONLY?[]:scripts)){ console.log('=== '+s+' ==='); const r=spawnSync('node',[s],{stdio:'inherit'}); if(r.status!==0){console.error('failed: '+s);process.exit(1);} }
const J=f=>JSON.parse(fs.readFileSync(f));
const fix=J('p2u/revised_result.json'), sc=J('p2u/revised_scale_result.json'), br=J('p2u/revised_batch_realcase_result.json'), bind=J('p2u/revised_bind_result.json');
const fd=J('p2u/fairdt_result.json'), fb=J('p2u/fairdt_batched_result.json'), ch=J('p2u/chen_result.json'), zk=J('p2u/zk_result.json');
const oc=J('p2u/revised_outcome_result.json'), bs=J('p2u/revised_batchsig_result.json'); const oF=oc.doFault.avg, oN=oc.notEstablished.avg;   // 单次来源争议按判定结果分列；批量逐条验签对照
const ours=sc.table6.ours.dispute, red=(a,b)=>+(100*(1-a/b)).toFixed(1);   // 本文单次来源争议开销（38 次争议的平均值，表6、图5）
const fit=(xs,ys)=>{const n=xs.length,mx=xs.reduce((a,b)=>a+b)/n,my=ys.reduce((a,b)=>a+b)/n;let sxy=0,sxx=0,syy=0;for(let i=0;i<n;i++){sxy+=(xs[i]-mx)*(ys[i]-my);sxx+=(xs[i]-mx)**2;syy+=(ys[i]-my)**2;}
  const k=sxy/sxx,b=my-k*mx,r2=1-xs.reduce((s,x,i)=>s+(ys[i]-(k*x+b))**2,0)/syy,maxRes=Math.max(...xs.map((x,i)=>Math.abs(ys[i]-(k*x+b))));return {slope:k,intercept:b,r2,maxRes};};
const Ns=Object.keys(sc.scaleN.dispute).map(Number).sort((a,b)=>a-b);
const fitD=fit(Ns.map(n=>sc.scaleN.dispute[n].depth),Ns.map(n=>sc.scaleN.dispute[n].gas));
const NF=Object.keys(sc.scaleN.full).map(Number).filter(n=>typeof sc.scaleN.full[n]==='number').sort((a,b)=>a-b);
const fitF=fit(NF,NF.map(n=>sc.scaleN.full[n]));
const t6=sc.table6; const chenRepro=ch.repro.onChainArbitrate+ch.repro.offChainArbitrate, chenPaper=ch.paper.onChainArbitrate+ch.paper.offChainArbitrate;
const summary={gas:fix.gas,checks:fix.checks,tally:fix.tally,reference:fix.reference,bind,table6:t6,batch:br.batch,cases:br.cases,
  scaleN:{Ns,dispute:sc.scaleN.dispute,register:sc.scaleN.register,full:sc.scaleN.full,sizes:sc.scaleN.sizes,fitDispute:fitD,fitFull:fitF,
    vsFull4000:red(sc.scaleN.dispute[4000].gas,sc.scaleN.full[4000])},
  compare:{ours,fairdtFaithful:fd.cheatGas.avg,fairdtFaithfulHonest:fd.honestGas.avg,fairdtBatched:fb.cheatGas.avg,fairdtBatchedHonest:fb.honestGas.avg,
    chenRepro,chenPaper,chenReproOn:ch.repro.onChainArbitrate,chenReproOff:ch.repro.offChainArbitrate,chenPaperOn:ch.paper.onChainArbitrate,chenPaperOff:ch.paper.offChainArbitrate,
    zk:zk.gasAvg,zkProveMs:zk.proveAvgMs,groth16LowerBound:202000,baseline:t6.baseline.total,
    oursDoFault:oF,oursNotEstablished:oN,
    // 降幅按相同判定情形计算（论文 4.6、4.7 节）：判 DO 违约对应 FairDT 卖方作弊、文献[13]数据内容错误与基线方案；质疑不成立对应 FairDT 卖方诚实与零知识对照（DO 能生成证明）
    reduction:{doFault:{vsFairdtFaithful:red(oF,fd.cheatGas.avg),vsFairdtBatched:red(oF,fb.cheatGas.avg),vsFairdtPaper700k:red(oF,700000),vsBaseline:red(oF,t6.baseline.total),vsChenRepro:red(oF,chenRepro),vsChenPaper:red(oF,chenPaper)},
      notEstablished:{vsFairdtFaithful:red(oN,fd.honestGas.avg),vsFairdtBatched:red(oN,fb.honestGas.avg),vsZk:red(oN,zk.gasAvg),vsGroth16LB:red(oN,202000)}}},
  outcome:oc,batchSig:{perRecordSig:bs.perRecordSig.perRecord,rootOnly:br.batch.all38.perRecord,reductionPct:red(br.batch.all38.perRecord,bs.perRecordSig.perRecord),sameRulings:bs.sameRulings}};
fs.writeFileSync('p2u/revised_summary.json',JSON.stringify(summary,null,1));
console.log('=== 汇总 ==='); console.log(JSON.stringify({gas:summary.gas,table6:t6,fitDispute:fitD,fitFull:fitF,vsFull4000:summary.scaleN.vsFull4000,compare:summary.compare,batchSig:summary.batchSig},null,1));
