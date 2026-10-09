const {makeEnv}=require('../env.js'), fs=require('fs'), {ethers}=require('ethers'), solc=require('solc0826');
const R0=JSON.parse(fs.readFileSync('p2u/ref_result.json')); const {f2021,f2022,SH_LOCAL_2022}=R0; const stale=new Set(R0.stale);
const sc=x=>Math.round(x*10000), M=f2022.length, D=6, id=1n, Y=2022, K=ethers.solidityPackedKeccak256;
const tree=ls=>{const L=[ls.slice()];while(L[L.length-1].length>1){const a=L[L.length-1];if(a.length%2)a.push(a[a.length-1]);const n=[];for(let j=0;j<a.length;j+=2)n.push(K(['bytes32','bytes32'],[a[j],a[j+1]]));L.push(n);}return L;};
const proof=(L,i)=>{const p=[];for(let d=0;d<L.length-1;d++){p.push(L[d][i^1]);i>>=1;}return p;};
(async()=>{
 const src={'Final.sol':{content:fs.readFileSync('p2u/Final.sol','utf8')},'Batch.sol':{content:fs.readFileSync('p2u/Batch.sol','utf8')}};
 const o=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:src,settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
 const er=(o.errors||[]).filter(x=>x.severity==='error'); if(er.length){er.forEach(x=>console.error(x.formattedMessage));process.exit(1)}
 const C=o.contracts['Batch.sol'].DualMerkleBatch; const env=await makeEnv('merge'); const DO=env.off.DO;
 const f=new ethers.ContractFactory(C.abi,'0x'+C.evm.bytecode.object,env.s.TTP); const B=await f.deploy(); await B.waitForDeployment(); const I=new ethers.Interface(C.abi);
 const R16=(s,r)=>(s<<8)|r; const table=ethers.concat(f2022.map((v,r)=>ethers.solidityPacked(['uint16','uint16','uint32'],[Y,R16(1,r),sc(v)])));
 await (await B.registerTable(Y,1,ethers.keccak256(table))).wait();
 const vals=f2022.map((v,r)=>stale.has(r)?f2021[r]:v); vals[16]=SH_LOCAL_2022;
 const mV=(i,r,v)=>K(['bytes1','uint256','uint32','uint16','uint16','uint32'],['0x01',id,i,Y,r,sc(v)]);
 const sigs=[],lv=[]; for(let i=0;i<M;i++){const m=mV(i,R16(1,i),vals[i]);const s=await DO.signMessage(ethers.getBytes(m));sigs.push(s);lv.push(K(['bytes1','bytes32','bytes'],['0x01',m,s]));}
 const TV=tree(lv); await (await B.registerTask(id,Y,DO.address)).wait(); await (await B.connect(env.s.DO).registerDataset(id,Y,D,TV[D][0],ethers.ZeroHash)).wait();
 const rec=i=>({i,region:R16(1,i),value:sc(vals[i]),sig:sigs[i],p:proof(TV,i),k:i});
 const wrong=[...Array(M).keys()].filter(i=>stale.has(i)||i===16);
 const res={};
 const correct=[...Array(M).keys()].filter(i=>!(stale.has(i)||i===16));
 const sets=[['b1',wrong.slice(0,1)],['b2',wrong.slice(0,2)],['b5',wrong.slice(0,5)],['wrong10',wrong],['b20',[...wrong,...correct.slice(0,10)]],['all38',[...Array(M).keys()]]];
 for(const [name,set] of sets){
   const rc=await (await B.connect(env.s.DB).disputeReferenceBatch(id,set.map(rec),table,{gasLimit:6000000})).wait();
   let faults=-1; for(const l of rc.logs){try{const e=I.parseLog(l);if(e&&e.name==='BatchRuling')faults=Number(e.args[1]);}catch(_){}}
   res[name]={records:set.length,faults,gas:Number(rc.gasUsed)};
   console.log(`批量裁决 ${set.length} 条：判 DO 违约 ${faults} 条，${rc.gasUsed} Gas（每条 ${Math.round(Number(rc.gasUsed)/set.length)} Gas）`);
 }
 fs.writeFileSync('p2u/batch_result.json',JSON.stringify(res,null,1));
})().catch(e=>{console.error(e.shortMessage||e.message);process.exit(1)});
