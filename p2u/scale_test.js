const {makeEnv}=require('../env.js'), fs=require('fs'), {ethers}=require('ethers'), solc=require('solc0826');
const K=ethers.solidityPackedKeccak256; const R0=JSON.parse(fs.readFileSync('p2u/ref_result.json')); const B=JSON.parse(fs.readFileSync('p2u/build.json'));
const {names,f2021,f2022,SH_LOCAL_2022}=R0; const stale=new Set(R0.stale); const sc=x=>Math.round(x*10000); const M=names.length;
const comp=(file,name)=>{const o=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{[file]:{content:fs.readFileSync('p2u/'+file,'utf8')}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
  const e=(o.errors||[]).filter(x=>x.severity==='error'); if(e.length){e.forEach(x=>console.error(x.formattedMessage));process.exit(1)} const c=o.contracts[file][name]; return {abi:c.abi,bin:'0x'+c.evm.bytecode.object};};
const tree=ls=>{const L=[ls.slice()];while(L[L.length-1].length>1){const a=L[L.length-1];if(a.length%2)a.push(a[a.length-1]);const n=[];for(let j=0;j<a.length;j+=2)n.push(K(['bytes32','bytes32'],[a[j],a[j+1]]));L.push(n);}return L;};
const proof=(L,i)=>{const p=[];for(let d=0;d<L.length-1;d++){p.push(L[d][i^1]);i>>=1;}return p;};
(async()=>{
 const env=await makeEnv('merge'); const DO=env.off.DO;
 const CR=comp('RefArbitration.sol','RefArbitration'), CF=comp('FlatHash.sol','FlatHashArbitration'), CT=comp('OnchainTable.sol','OnchainTableArbitration');
 const dep=async(c)=>{const f=new ethers.ContractFactory(c.abi,c.bin,env.s.TTP);const x=await f.deploy();await x.waitForDeployment();return x;};
 const outOf=(rc,I)=>{for(const l of rc.logs){try{const e=I.parseLog(l);if(e&&e.name==='Ruling')return Number(e.args[3]);}catch(_){}}return -1;};
 const id=1n, year=2022; const vals=f2022.map((v,r)=>stale.has(r)?f2021[r]:v); vals[16]=SH_LOCAL_2022;
 const mV=(i,r,v)=>K(['bytes1','uint256','uint32','uint16','uint16','uint32'],['0x01',id,i,year,r,sc(v)]);
 const sigs=[],leaves=[]; for(let i=0;i<M;i++){const m=mV(i,i,vals[i]);const s=await DO.signMessage(ethers.getBytes(m));sigs.push(s);leaves.push(K(['bytes1','bytes32','bytes'],['0x01',m,s]));}
 const TV=tree(leaves), dd=Math.ceil(Math.log2(M));
 const res={};
 for(const scale of [38,76]){
   const entries=scale===38? f2022.map((v,r)=>[2022,r,v]) : [...f2021.map((v,r)=>[2021,r,v]),...f2022.map((v,r)=>[2022,r,v])];
   const off=scale===38?0:M, ld=Math.ceil(Math.log2(entries.length));
   const LT=tree(entries.map(([y,r,v])=>K(['bytes1','uint16','uint16','uint32'],['0x04',y,r,sc(v)])));
   const table=ethers.concat(entries.map(([y,r,v])=>ethers.solidityPacked(['uint16','uint16','uint32'],[y,r,sc(v)])));
   const Rf=await dep(CR), Fh=await dep(CF), Tb=await dep(CT); const I={R:new ethers.Interface(CR.abi),F:new ethers.Interface(CF.abi),T:new ethers.Interface(CT.abi)};
   const reg={};
   reg.R=Number((await (await Rf.registerVersion(2022,LT[ld][0],ld)).wait()).gasUsed);
   reg.F=Number((await (await Fh.registerTable(1,ethers.keccak256(table))).wait()).gasUsed);
   reg.T=0; for(const y of (scale===38?[2022]:[2021,2022])){const f=y===2021?f2021:f2022; reg.T+=Number((await (await Tb.registerTable(y,[...Array(M).keys()],f.map(sc))).wait()).gasUsed);}
   await (await Rf.connect(env.s.DO).registerDataset(id,year,dd,TV[dd][0])).wait();
   await (await Fh.connect(env.s.DO).registerDataset(id,year,1,dd,TV[dd][0])).wait();
   await (await Tb.connect(env.s.DO).registerDataset(id,year,dd,TV[dd][0])).wait();
   const g={R:[],F:[],T:[]}; let agree=0, doFault=0;
   for(let i=0;i<M;i++){
     const a=await (await Rf.connect(env.s.DB).disputeReference(id,i,i,sc(vals[i]),sigs[i],proof(TV,i),off+i,sc(f2022[i]),proof(LT,off+i),{gasLimit:3000000})).wait();
     const b=await (await Fh.connect(env.s.DB).disputeReference(id,i,i,sc(vals[i]),sigs[i],proof(TV,i),table,off+i,{gasLimit:3000000})).wait();
     const c=await (await Tb.connect(env.s.DB).disputeReference(id,i,i,sc(vals[i]),sigs[i],proof(TV,i),{gasLimit:3000000})).wait();
     const oa=outOf(a,I.R),ob=outOf(b,I.F),oc=outOf(c,I.T); if(oa===ob&&ob===oc) agree++; if(oa===1) doFault++;
     g.R.push(Number(a.gasUsed)); g.F.push(Number(b.gasUsed)); g.T.push(Number(c.gasUsed));
   }
   const avg=a=>Math.round(a.reduce((x,y)=>x+y)/a.length);
   res[scale]={reg,disp:{R:avg(g.R),F:avg(g.F),T:avg(g.T)},agree,doFault,libDepth:ld,tableBytes:ethers.getBytes(table).length};
   console.log(`因子库 ${scale} 条（Merkle 深度 ${ld}，全表 ${ethers.getBytes(table).length} 字节）：三种方案裁决一致 ${agree}/${M}，判 DO 违约 ${doFault}`);
   console.log(`   登记：本文 ${reg.R}，哈希+全表 ${reg.F}，链上存储 ${reg.T}；单次裁决：本文 ${res[scale].disp.R}，哈希+全表 ${res[scale].disp.F}，链上存储 ${res[scale].disp.T}`);
 }
 // 拒绝出具回执的超时处置
 const A=await (new ethers.ContractFactory(B.AccountableArbitration.abi,B.AccountableArbitration.bytecode,env.s.TTP)).deploy(); await A.waitForDeployment(); const IA=new ethers.Interface(B.AccountableArbitration.abi);
 await (await A.registerVersion(ethers.ZeroHash.replace(/0$/,'1'),1)).wait();
 const eh=ethers.hexlify(ethers.randomBytes(32)), salt=ethers.hexlify(ethers.randomBytes(32));
 const mE=K(['bytes1','uint256','uint32','uint32','bytes32','bytes32'],['0x02',7n,0,1,eh,salt]);
 await (await A.connect(env.s.DO).registerDataset(7n,1,1,0,ethers.ZeroHash,ethers.ZeroHash)).wait();
 const rcpt=await DO.signMessage(ethers.getBytes(mE));
 const t={}; t.request=Number((await (await A.connect(env.s.DB).requestEvidence(7n,0)).wait()).gasUsed);
 t.respond=Number((await (await A.connect(env.s.DO).respondEvidence(7n,0,eh,salt,rcpt)).wait()).gasUsed);
 await (await A.connect(env.s.DB).requestEvidence(7n,1)).wait();
 let early='未回退'; try{await (await A.connect(env.s.DB).claimNoReceipt(7n,1,{gasLimit:300000})).wait();}catch(e){early='交易回退';}
 await env.p.send('evm_increaseTime',[86401]); await env.p.send('evm_mine',[]);
 const rc=await (await A.connect(env.s.DB).claimNoReceipt(7n,1)).wait(); t.claim=Number(rc.gasUsed); t.claimOutcome=outOf(rc,IA);
 console.log(`拒绝出具回执：请求 ${t.request} Gas；按时响应 ${t.respond} Gas；时限前主张 → ${early}；逾期主张 → ${t.claimOutcome===1?'判 DO 违约':'异常'}（${t.claim} Gas）`);
 res.refusal={...t,early};
 // 由两个实测点拟合增长规律，推算哈希+全表与本文的交叉规模（推算值）
 const fF=(m)=>res[38].disp.F+(res[76].disp.F-res[38].disp.F)*(m-38)/38, fR=(m)=>res[38].disp.R+(res[76].disp.R-res[38].disp.R)*(Math.ceil(Math.log2(m))-6);
 let cross=null; for(let m=38;m<=100000;m++){if(fF(m)>fR(m)){cross=m;break;}}
 res.extrapolation={perEntryFlat:(res[76].disp.F-res[38].disp.F)/38, perLevelMerkle:res[76].disp.R-res[38].disp.R, crossover:cross};
 console.log(`推算：哈希+全表每增加 1 条因子，单次裁决约增 ${res.extrapolation.perEntryFlat.toFixed(0)} Gas；本文每增加一层深度约增 ${res.extrapolation.perLevelMerkle} Gas；因子库超过约 ${cross} 条时本文单次裁决低于哈希+全表`);
 fs.writeFileSync('p2u/scale_result.json',JSON.stringify(res,null,1));
})().catch(e=>{console.error(e.shortMessage||e.message);process.exit(1)});
