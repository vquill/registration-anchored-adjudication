// 批量来源裁决（图 4）与公开核查案例重放（表 3）：node p2u/revised_batch_realcase_test.js
const {makeEnv}=require('../env.js'), fs=require('fs'), {ethers}=require('ethers');
const L=require('./revised_lib.js'); const {K,rnd,sc,R16,tree,proof,DEP,send,run}=L;
(async()=>{
 const env=await makeEnv('merge'); const DO=env.off.DO; const Y=2022; const R0=JSON.parse(fs.readFileSync('p2u/ref_result.json'));
 const C=L.compile(['FinalRevised.sol'],'DualMerkleArbitrationRevised'); const abi=C.abi;
 const ctx=await L.deploy(env,C); const c=L.gl(ctx.c), m=ctx.m; const Dc=L.gl(ctx.c.connect(env.s.DB)); const dep={value:DEP};
 await send(c.registerKey(DO.address,ethers.id('DO'))); await send(c.depositBond(DO.address,{value:ethers.parseEther('10')}));
 const CR=L.controlledRecords(R0); const {reg}=CR; const M=38;
 await send(c.registerTable(Y,1,ethers.keccak256(CR.table),ethers.id('公告2024年第33号'))); await L.passNotice(env); await send(c.activateTable(Y,1));
 // ---- 批量：与原 batch_test.js 相同的 38 条记录与 6 组 ----
 const id=1n; const d=await L.buildDataset(ctx,env,id,Y,CR.recs.slice(0,M));
 const rec=i=>({i,region:reg(i),value:CR.recs[i].v,sig:d.sigs[i],path:proof(d.TV,i),k:i});
 const wrong=[...Array(M).keys()].filter(i=>CR.stale.has(i)||i===16), correct=[...Array(M).keys()].filter(i=>!(CR.stale.has(i)||i===16));
 const sets=[['b1',wrong.slice(0,1)],['b2',wrong.slice(0,2)],['b5',wrong.slice(0,5)],['wrong10',wrong],['b20',[...wrong,...correct.slice(0,10)]],['all38',[...Array(M).keys()]]];
 const batch={}; const I=new ethers.Interface(abi);
 let sid=20n;
 for(const [name,set] of sets){   // 每组用新的数据集，测量首次裁决（含首次赔偿记位）的开销
   sid++; const dS=await L.buildDataset(ctx,env,sid,Y,CR.recs.slice(0,M)); const recS=i=>({i,region:reg(i),value:CR.recs[i].v,sig:dS.sigs[i],path:proof(dS.TV,i),k:i});
   const rc=await send(Dc.disputeReferenceBatch(sid,set.map(recS),CR.table,{...dep,gasLimit:6000000}));
   let faults=-1; for(const l of rc.logs){try{const e=I.parseLog(l);if(e&&e.name==='BatchRuling')faults=Number(e.args[1]);}catch(_){}}
   batch[name]={records:set.length,faults,gas:Number(rc.gasUsed),perRecord:Math.round(Number(rc.gasUsed)/set.length)};
   console.log(`批量裁决 ${set.length} 条：判 DO 违约 ${faults} 条，${rc.gasUsed} Gas（每条 ${batch[name].perRecord} Gas）`);
 }
 // ---- 案例重放：A 宁波柏厨 2020、B 宁波李氏 2021（与原 realcase_test.js 相同的数据） ----
 const SRC_A=4, SRC_B=5, EAST=3, NINGBO=1;
 const CASES=[
  {name:'宁波柏厨（2020）初始报告', year:2020, src:SRC_A, reg:EAST,   v:0.7921, mwh:8157,   other:0,     report:6461.16},
  {name:'宁波柏厨（2020）核查后',   year:2020, src:SRC_A, reg:EAST,   v:0.7035, mwh:8157,   other:0,     report:5738.45},
  {name:'宁波李氏（2021）初始报告', year:2021, src:SRC_B, reg:NINGBO, v:0.7035, mwh:2129.4, other:10.16, report:1508.19},
  {name:'宁波李氏（2021）核查后',   year:2021, src:SRC_B, reg:NINGBO, v:0.64,   mwh:2129.4, other:10.16, report:1372.98}];
 const AUTH={[`2020-${SRC_A}`]:{reg:EAST,v:0.7035},[`2021-${SRC_B}`]:{reg:NINGBO,v:0.64}};
 const tables={};
 for(const [k,a] of Object.entries(AUTH)){const [y,s]=k.split('-').map(Number); tables[k]=ethers.solidityPacked(['uint16','uint16','uint32'],[y,R16(s,a.reg),sc(a.v)]); await send(c.registerTable(y,s,ethers.keccak256(tables[k]),ethers.id(k)));}
 await L.passNotice(env); for(const k of Object.keys(AUTH)){const [y,s]=k.split('-').map(Number); await send(c.activateTable(y,s));}
 const NAME={0:'不予受理',1:'判DO违约',2:'质疑不成立',revert:'回退'}; const cases=[]; let cid=100n;
 for(const cs of CASES){
  cid++; const r=R16(cs.src,cs.reg), v=sc(cs.v);
  const dd=await L.buildDataset(ctx,env,cid,cs.year,[{r,v},{r:R16(cs.src,cs.reg),v:1}]);   // 被争议记录及一条其他记录
  const tally={}; let gas=0;
  for(let t=0;t<20;t++){const x=await run(Dc.disputeReference(cid,{i:0,region:r,value:v,sig:dd.sigs[0],path:proof(dd.TV,0),k:0},tables[`${cs.year}-${cs.src}`],dep),abi); tally[NAME[x.out]]=(tally[NAME[x.out]]||0)+1; gas=x.gas;}
  const em=Math.round((cs.mwh*cs.v+cs.other)*100)/100;
  cases.push({...cs,tally,gas,emission:em,match:Math.abs(em-cs.report)<0.005});
  console.log(`${cs.name}：因子 ${cs.v}，链上裁决 ${JSON.stringify(tally)}，单次 ${gas} Gas；复算排放量 ${em.toFixed(2)} t，报告值 ${cs.report.toFixed(2)} t，${Math.abs(em-cs.report)<0.005?'一致':'不一致'}`);
 }
 // C 河南华东工控 2024：列示 0.5633 声明公告2024年第33号；对 38 个条目逐一声明并争议
 const SRC_C=6, YC=2024, f22=R0.f2022;
 const tableC=ethers.concat(f22.map((v,i)=>ethers.solidityPacked(['uint16','uint16','uint32'],[YC,R16(SRC_C,i),sc(v)])));
 await send(c.registerTable(YC,SRC_C,ethers.keccak256(tableC),ethers.id('公告2024年第33号'))); await L.passNotice(env); await send(c.activateTable(YC,SRC_C));
 cid++; const recsC=f22.map((_,i)=>({r:R16(SRC_C,i),v:sc(0.5633)})).concat([{r:R16(SRC_C,0),v:sc(0.5366)}]);
 const dC=await L.buildDataset(ctx,env,cid,YC,recsC); const tl={}, gs=[];
 for(let i=0;i<f22.length;i++){const x=await run(Dc.disputeReference(cid,{i,region:recsC[i].r,value:recsC[i].v,sig:dC.sigs[i],path:proof(dC.TV,i),k:i},tableC,dep),abi); tl[NAME[x.out]]=(tl[NAME[x.out]]||0)+1; gs.push(x.gas);}
 const j=f22.length, tc={}; let gc=0;
 for(let t=0;t<20;t++){const x=await run(Dc.disputeReference(cid,{i:j,region:recsC[j].r,value:recsC[j].v,sig:dC.sigs[j],path:proof(dC.TV,j),k:0},tableC,dep),abi); tc[NAME[x.out]]=(tc[NAME[x.out]]||0)+1; gc=x.gas;}
 const e1=Math.round(173.502*0.5633*100)/100, e2=Math.round(173.502*0.5366*100)/100;
 console.log(`河南华东工控（2024）列示 0.5633：公告中等于该值的条目 ${f22.filter(v=>Math.abs(v-0.5633)<1e-9).length} 个；对 ${f22.length} 个条目逐一争议 ${JSON.stringify(tl)}，单次 ${Math.min(...gs)}~${Math.max(...gs)} Gas；复算 ${e1.toFixed(2)} t（表内 93.1 t）；对照 0.5366：${JSON.stringify(tc)}，复算 ${e2.toFixed(2)} t`);
 cases.push({name:'河南华东工控（2024）',listed:0.5633,entries:f22.length,tally:tl,control:tc,em_listed:e1,em_national:e2,report:93.1});
 const emptyBatch=(await L.run(Dc.disputeReferenceBatch(id,[],CR.table,dep),abi)).out; console.log('空批量：',emptyBatch);
 fs.writeFileSync('p2u/revised_batch_realcase_result.json',JSON.stringify({batch,cases,emptyBatch},null,1));
 process.exit(0);
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
