// 4.5、4.6 节：按判定结果分别统计单次来源争议开销（38 条国家因子表记录，各发起一次争议）：node p2u/revised_outcome_test.js
const {makeEnv}=require('../env.js'), fs=require('fs'), {ethers}=require('ethers');
const L=require('./revised_lib.js'); const {avg,proof,DEP,send,run}=L;
(async()=>{
 const env=await makeEnv('merge'); const DO=env.off.DO; const Y=2022;
 const R0=JSON.parse(fs.readFileSync('p2u/ref_result.json')); const CR=L.controlledRecords(R0); const {reg}=CR;
 const C=L.compile(['FinalRevised.sol'],'DualMerkleArbitrationRevised');
 const ctx=await L.deploy(env,C); const c=L.gl(ctx.c); const Dc=L.gl(ctx.c.connect(env.s.DB));
 await send(c.registerKey(DO.address,ethers.id('DO'))); await send(c.depositBond(DO.address,{value:ethers.parseEther('10')}));
 await send(c.registerTable(Y,1,ethers.keccak256(CR.table),ethers.id('a'))); await L.passNotice(env); await send(c.activateTable(Y,1));
 const d=await L.buildDataset(ctx,env,1n,Y,CR.recs); const fault=[],notEst=[],all=[];
 for(let i=0;i<38;i++){const x=await run(Dc.disputeReference(1n,{i,region:reg(i),value:CR.recs[i].v,sig:d.sigs[i],path:proof(d.TV,i),k:i},CR.table,{value:DEP}),C.abi);
   all.push(x.gas); (x.out===1?fault:notEst).push(x.gas);}
 const res={disputes:38,doFault:{n:fault.length,avg:avg(fault),min:Math.min(...fault),max:Math.max(...fault)},
   notEstablished:{n:notEst.length,avg:avg(notEst),min:Math.min(...notEst),max:Math.max(...notEst)},avgAll:avg(all)};
 fs.writeFileSync('p2u/revised_outcome_result.json',JSON.stringify(res,null,1));
 console.log(`单次来源争议（38 条）：判 DO 违约 ${res.doFault.n} 次，平均 ${res.doFault.avg}（${res.doFault.min}～${res.doFault.max}）；质疑不成立 ${res.notEstablished.n} 次，平均 ${res.notEstablished.avg}（${res.notEstablished.min}～${res.notEstablished.max}）；全部平均 ${res.avgAll}`);
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
