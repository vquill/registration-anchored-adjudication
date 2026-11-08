// 表 6（机制对照：本文 / 基线 / 直接存储未打包 / 直接存储打包）与图 3、表 1（规模开销）：node p2u/revised_scale_test.js [N列表]
const {makeEnv}=require('../env.js'), fs=require('fs'), {ethers}=require('ethers');
const L=require('./revised_lib.js'); const {K,HP,rnd,sc,R16,avg,tree,proof,DEP,NOANCHOR,send,run,TTPW}=L;
(async()=>{
 const env=await makeEnv('merge'); const DO=env.off.DO; const Y=2022; const R0=JSON.parse(fs.readFileSync('p2u/ref_result.json')); const CR=L.controlledRecords(R0); const {reg}=CR;
 const C=L.compile(['FinalRevised.sol'],'DualMerkleArbitrationRevised');
 const CU=L.compile(['FinalRevised.sol','CompareRevised.sol'],'DirectUnpackedRevised'), CP=L.compile(['FinalRevised.sol','CompareRevised.sol'],'DirectPackedRevised'), CB=L.compile(['FinalRevised.sol','CompareRevised.sol'],'BaselineRevised');
 const res={table6:{},scaleN:{register:{},dispute:{},full:{},sizes:{}}}; const dep={value:DEP};
 const prep=async(ctx)=>{const c=L.gl(ctx.c); await send(c.registerKey(DO.address,ethers.id('DO'))); await send(c.depositBond(DO.address,{value:ethers.parseEther('10')})); return c;};
 // ---------- 本文 ----------
 { const ctx=await L.deploy(env,C); const c=await prep(ctx); const Dc=L.gl(ctx.c.connect(env.s.DB));
   const reg1=(await run(c.registerTable(Y,1,ethers.keccak256(CR.table),ethers.id('a')),C.abi)).gas; await L.passNotice(env); await send(c.activateTable(Y,1));
   const d=await L.buildDataset(ctx,env,1n,Y,CR.recs); const g=[]; let agree=[];
   for(let i=0;i<38;i++){const x=await run(Dc.disputeReference(1n,{i,region:reg(i),value:CR.recs[i].v,sig:d.sigs[i],path:proof(d.TV,i),k:i},CR.table,dep),C.abi); g.push(x.gas); agree.push(x.out);}
   const d2=await L.buildDataset(ctx,env,2n,Y,CR.recs); const rec=i=>({i,region:reg(i),value:CR.recs[i].v,sig:d2.sigs[i],path:proof(d2.TV,i),k:i});   // 批量在新数据集上首次裁决
   const b38=Number((await send(Dc.disputeReferenceBatch(2n,[...Array(38).keys()].map(rec),CR.table,{...dep,gasLimit:6e6}))).gasUsed);
   res.table6.ours={register:reg1,dispute:avg(g),batch38:b38,batchPerRecord:Math.round(b38/38),outcomes:agree}; }
 // ---------- 直接存储：未打包 / 打包 ----------
 for(const [name,CC,regFn,dispFn,batchFn] of [['unpacked',CU,'registerTableStored','disputeReferenceStored',null],['packed',CP,'registerTablePacked','disputeReferencePacked','disputeReferenceBatchPacked']]){
   const ctx=await L.deploy(env,CC); const c=await prep(ctx); const Dc=L.gl(ctx.c.connect(env.s.DB));
   const rg=(await run(c[regFn](Y,1,R0.f2022.map(sc)),CC.abi)).gas;
   const d=await L.buildDataset(ctx,env,1n,Y,CR.recs); const g=[]; const outs=[];
   for(let i=0;i<38;i++){const x=await run(Dc[dispFn](1n,{i,region:reg(i),value:CR.recs[i].v,sig:d.sigs[i],path:proof(d.TV,i),k:i},dep),CC.abi); g.push(x.gas); outs.push(x.out);}
   const r={register:rg,dispute:avg(g),agreeWithOurs:outs.every((o,i)=>o===res.table6.ours.outcomes[i])};
   if(batchFn){const d2=await L.buildDataset(ctx,env,2n,Y,CR.recs); const rec=i=>({i,region:reg(i),value:CR.recs[i].v,sig:d2.sigs[i],path:proof(d2.TV,i),k:i}); const b=Number((await send(Dc[batchFn](2n,[...Array(38).keys()].map(rec),{...dep,gasLimit:6e6}))).gasUsed); r.batch38=b; r.batchPerRecord=Math.round(b/38);}
   res.table6[name]=r; }
 // ---------- 基线（来源争议须升级第三方：准入 + 裁决两笔，含押金） ----------
 { const f=new ethers.ContractFactory(CB.abi,CB.bin,env.s.TTP); const raw=await f.deploy(); await raw.waitForDeployment(); const b=L.gl(raw); const Db=L.gl(raw.connect(env.s.DB));
   const NR=41; const lv=[]; for(let i=0;i<NR;i++){const m=K(['bytes1','uint256','uint32','uint16','uint16','uint32'],['0x01',1n,i,Y,i,7035]); const s=await DO.signMessage(ethers.getBytes(m)); lv.push(K(['bytes1','bytes32','bytes'],['0x01',m,s]));}
   const T=tree(lv), D=T.length-1; await send(L.gl(raw.connect(env.s.DO)).registerDataset(1n,T[D][0]));
   const ga=[],gv=[]; const I=new ethers.Interface(CB.abi);
   for(let g=0;g<20;g++){const i=(g*13+5)%NR; const r1=await send(Db.disputeEvidence(1n,i,lv[i],proof(T,i),dep)); ga.push(Number(r1.gasUsed));
     const cid=await b.caseCount(); const m=K(['bytes1','uint256','address','uint256','uint8'],['0x03',1337n,await b.getAddress(),cid,2]);
     const r2=await send(Db.verdict(cid,2,await env.off.TTP.signMessage(ethers.getBytes(m)))); gv.push(Number(r2.gasUsed));}
   res.table6.baseline={admission:avg(ga),verdict:avg(gv),total:avg(ga)+avg(gv)}; }
 const t6=res.table6; const be=(x)=>((x.register-t6.ours.register)/(t6.ours.dispute-x.dispute)).toFixed(1);
 res.table6.breakEven={unpacked:+be(t6.unpacked),packed:+be(t6.packed),packedBatchPerRecordDiff:t6.ours.batchPerRecord-t6.packed.batchPerRecord};
 console.log(`表6 登记：本文 ${t6.ours.register}，未打包 ${t6.unpacked.register}，打包 ${t6.packed.register}；单次来源争议：本文 ${t6.ours.dispute}，未打包 ${t6.unpacked.dispute}，打包 ${t6.packed.dispute}，基线 ${t6.baseline.total}（准入 ${t6.baseline.admission}+裁决 ${t6.baseline.verdict}）`);
 console.log(`   批量 38 条每条：本文 ${t6.ours.batchPerRecord}，打包 ${t6.packed.batchPerRecord}；盈亏平衡：对未打包 ${res.table6.breakEven.unpacked} 次，对打包 ${res.table6.breakEven.packed} 次；裁决一致：未打包 ${t6.unpacked.agreeWithOurs}，打包 ${t6.packed.agreeWithOurs}`);
 // ---------- 图 3 / 表 1：N 从 10 到 1e5 ----------
 { const CF=L.compile(['FullRecompute.sol'],'FullRecompute'); const ctx=await L.deploy(env,C); const c=await prep(ctx); const Dc=L.gl(ctx.c.connect(env.s.DB)); const m=ctx.m;
   const FR=L.gl(await (async()=>{const f=new ethers.ContractFactory(CF.abi,CF.bin,env.s.TTP);const x=await f.deploy();await x.waitForDeployment();return x;})());
   const Ns=process.argv[2]?process.argv[2].split(',').map(Number):[10,50,100,200,500,1000,2000,4000,5000,10000,100000];
   for(const N of Ns){
     const id=BigInt(1000+N), t0=Date.now(); const leaves=[]; let sig0,m0;
     for(let i=0;i<N;i++){const v=5000+(i%3000); const mv=m.mV(id,i,Y,0x100|(i%38),v); const s=i===0?await DO.signMessage(ethers.getBytes(mv)):ethers.hexlify(ethers.randomBytes(65)); if(i===0){sig0=s;m0=mv;} leaves.push(m.leafV(mv,s));}
     const TV=tree(leaves), d=TV.length-1;
     await send(c.registerTask(id,Y,DO.address)); const rg=await send(L.gl(ctx.c.connect(env.s.DO)).registerDataset(id,Y,d,TV[d][0],rnd())); res.scaleN.register[N]=Number(rg.gasUsed);
     const p0=proof(TV,0); const ds0=await DO.signMessage(ethers.getBytes(m.mD(id,0,leaves[0],HP(p0))));
     const x=await send(Dc.disputeValue(id,{i:0,region:0x100,value:5000,sig:sig0,dsig:ds0,path:p0},NOANCHOR,dep)); res.scaleN.dispute[N]={gas:Number(x.gasUsed),depth:d};
     if(N<=5000){ await send(FR.registerDataset(id,TV[d][0])); try{const y=await send(FR.connect(env.s.DB).disputeFull(id,0,leaves[0],leaves,{gasLimit:6700000})); res.scaleN.full[N]=Number(y.gasUsed);}catch(e){res.scaleN.full[N]='超出区块上限';} }
     const valPre=1+32+4+2+2+4, sig=65; res.scaleN.sizes[N]={dualTree:valPre+2*sig+32*d, singleTree:valPre+2*sig+32+32+32*d, wholeHash:N*(valPre+sig+32+32)};
     console.log(`N=${N}：登记 ${res.scaleN.register[N]}；数值争议 ${res.scaleN.dispute[N].gas}（深度 ${d}）；全量重算 ${res.scaleN.full[N]??'—'}；用时 ${((Date.now()-t0)/1000).toFixed(1)} s`);
   } }
 fs.writeFileSync('p2u/revised_scale_result.json',JSON.stringify(res,null,1));
 process.exit(0);
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
