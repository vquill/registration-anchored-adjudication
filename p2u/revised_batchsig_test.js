// 4.5 节逐条验签对照：同一批 38 条记录（含 10 条违约），比较修订版批量来源裁决与加回逐条叶子验签的对照：node p2u/revised_batchsig_test.js
const {makeEnv}=require('../env.js'), fs=require('fs'), {ethers}=require('ethers');
const L=require('./revised_lib.js'); const {proof,DEP,send}=L;
(async()=>{
 const env=await makeEnv('merge'); const DO=env.off.DO; const Y=2022;
 const R0=JSON.parse(fs.readFileSync('p2u/ref_result.json')); const CR=L.controlledRecords(R0); const {reg}=CR;
 const C=L.compile(['FinalRevised.sol','BatchSigControl.sol'],'BatchSigControl'); const I=new ethers.Interface(C.abi);
 const ctx=await L.deploy(env,C); const c=L.gl(ctx.c); const Dc=L.gl(ctx.c.connect(env.s.DB));
 await send(c.registerKey(DO.address,ethers.id('DO'))); await send(c.depositBond(DO.address,{value:ethers.parseEther('10')}));
 await send(c.registerTable(Y,1,ethers.keccak256(CR.table),ethers.id('a'))); await L.passNotice(env); await send(c.activateTable(Y,1));
 const faultsOf=rc=>{for(const l of rc.logs){try{const e=I.parseLog(l); if(e&&e.name==='BatchRuling') return Number(e.args[1]);}catch(_){}} return null;};
 const res={records:38};
 for(const [name,fn,id] of [['rootOnly','disputeReferenceBatch',1n],['perRecordSig','disputeReferenceBatchSig',2n]]){   // 各在新数据集上首次裁决
   const d=await L.buildDataset(ctx,env,id,Y,CR.recs);
   const recs=[...Array(38).keys()].map(i=>({i,region:reg(i),value:CR.recs[i].v,sig:d.sigs[i],path:proof(d.TV,i),k:i}));
   const rc=await send(Dc[fn](id,recs,CR.table,{value:DEP,gasLimit:6e6})); const g=Number(rc.gasUsed);
   res[name]={gas:g,perRecord:Math.round(g/38),faults:faultsOf(rc)}; }
 res.sameRulings=res.rootOnly.faults===res.perRecordSig.faults;
 res.reductionPct=+(100*(1-res.rootOnly.perRecord/res.perRecordSig.perRecord)).toFixed(1);
 fs.writeFileSync('p2u/revised_batchsig_result.json',JSON.stringify(res,null,1));
 console.log(`批量 38 条（违约 ${res.rootOnly.faults} 条）：只验包含性 ${res.rootOnly.gas}（每条 ${res.rootOnly.perRecord}）；逐条验签对照 ${res.perRecordSig.gas}（每条 ${res.perRecordSig.perRecord}）；降低 ${res.reductionPct}%；判定一致：${res.sameRulings}`);
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
