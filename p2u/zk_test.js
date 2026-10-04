const {makeEnv}=require('../env.js'), fs=require('fs'), {ethers}=require('ethers'), solc=require('solc0826');
const snarkjs=require('snarkjs'), {buildPoseidon}=require('circomlibjs');
const R0=JSON.parse(fs.readFileSync('p2u/ref_result.json')); const {names,f2021,f2022,SH_LOCAL_2022}=R0; const stale=new Set(R0.stale);
const sc=x=>Math.round(x*10000), M=names.length, D=6, WASM='zk/ref.wasm', ZKEY='zk/ref.zkey';
(async()=>{
 const P=await buildPoseidon(); const F=P.F; const H=a=>F.toObject(P(a.map(BigInt)));
 // 权威因子表（2022 年真实值）的 Poseidon Merkle 树，补零至 64 叶
 let lvl=[...f2022.map((v,r)=>H([2022,r,sc(v)])),...Array(64-M).fill(0n)]; const L=[lvl];
 while(lvl.length>1){const n=[];for(let j=0;j<lvl.length;j+=2)n.push(H([lvl[j],lvl[j+1]]));lvl=n;L.push(lvl);}
 const libRoot=L[D][0]; const sib=i=>{const s=[];for(let d=0;d<D;d++){s.push(L[d][i^1].toString());i>>=1;}return s;};
 // DO 的 2022 年度核算记录（与本文实验完全相同：9 条沿用 2021 年值、1 条上海地方口径）
 const id=1n, vals=f2022.map((v,r)=>stale.has(r)?f2021[r]:v); vals[16]=SH_LOCAL_2022;
 const salts=[...Array(M)].map(()=>BigInt(ethers.hexlify(ethers.randomBytes(31))));
 const rec=[...Array(M)].map((_,i)=>H([id,i,2022,i,sc(vals[i]),salts[i]]));
 const K=ethers.solidityPackedKeccak256; const leaves=rec.map(x=>K(['uint256'],[x]));
 const tree=ls=>{const T=[ls.slice()];while(T[T.length-1].length>1){const a=T[T.length-1];if(a.length%2)a.push(a[a.length-1]);const n=[];for(let j=0;j<a.length;j+=2)n.push(K(['bytes32','bytes32'],[a[j],a[j+1]]));T.push(n);}return T;};
 const proof=(T,i)=>{const p=[];for(let d=0;d<T.length-1;d++){p.push(T[d][i^1]);i>>=1;}return p;};
 const TV=tree(leaves), dd=Math.ceil(Math.log2(M));
 // 编译并部署验证合约与争议合约
 const src={'Verifier.sol':{content:fs.readFileSync('p2u/Verifier.sol','utf8')},'ZkDispute.sol':{content:fs.readFileSync('p2u/ZkDispute.sol','utf8')}};
 const o=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:src,settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
 const er=(o.errors||[]).filter(x=>x.severity==='error'); if(er.length){er.forEach(x=>console.error(x.formattedMessage));process.exit(1)}
 const env=await makeEnv('merge'); const dep=async(c,args=[])=>{const f=new ethers.ContractFactory(c.abi,'0x'+c.evm.bytecode.object,env.s.TTP);const x=await f.deploy(...args);await x.waitForDeployment();return x;};
 const V=await dep(o.contracts['Verifier.sol'].Groth16Verifier); const Z=await dep(o.contracts['ZkDispute.sol'].ZkReferenceDispute,[await V.getAddress()]);
 const IZ=new ethers.Interface(o.contracts['ZkDispute.sol'].ZkReferenceDispute.abi);
 await (await Z.connect(env.s.DO).registerDataset(id,dd,TV[dd][0],libRoot)).wait();
 const res={proved:0,cannotProve:0,proveMs:[],gas:[],outcomes:{}};
 for(let i=0;i<M;i++){
   const input={root:libRoot.toString(),recCommit:rec[i].toString(),id:id.toString(),i:String(i),year:'2022',region:String(i),value:String(sc(vals[i])),salt:salts[i].toString(),pathIdx:String(i),sib:sib(i)};
   const t0=Date.now(); let pr;
   try{ pr=await snarkjs.groth16.fullProve(input,WASM,ZKEY); }catch(e){ res.cannotProve++; continue; }
   res.proveMs.push(Date.now()-t0); res.proved++;
   const cd=JSON.parse('['+(await snarkjs.groth16.exportSolidityCallData(pr.proof,pr.publicSignals))+']');
   const rc=await (await Z.connect(env.s.DO).resolve(id,i,proof(TV,i),cd[0],cd[1],cd[2],cd[3],{gasLimit:3000000})).wait();
   for(const l of rc.logs){try{const e=IZ.parseLog(l);if(e&&e.name==='Ruling'){const k=Number(e.args[3]);res.outcomes[k]=(res.outcomes[k]||0)+1;}}catch(_){}}
   res.gas.push(Number(rc.gasUsed));
 }
 const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
 res.gasAvg=Math.round(avg(res.gas)); res.proveAvgMs=Math.round(avg(res.proveMs)); res.proveMaxMs=Math.max(...res.proveMs);
 res.calldataBytes=ethers.getBytes(IZ.encodeFunctionData('resolve',[id,0,proof(TV,0),[1,1],[[1,1],[1,1]],[1,1],[1,1,1,1,1,1]])).length;
 console.log(`零知识路线：可生成证明 ${res.proved} 条（链上验证通过 ${res.outcomes[2]||0}），无法生成证明 ${res.cannotProve} 条（应为 10，即错误引用的 DO 无法自证）`);
 console.log(`   单次链上裁决 ${res.gasAvg} Gas（最小 ${Math.min(...res.gas)}，最大 ${Math.max(...res.gas)}）；证明生成平均 ${res.proveAvgMs} ms、最长 ${res.proveMaxMs} ms；交易调用数据 ${res.calldataBytes} 字节`);
 fs.writeFileSync('p2u/zk_result.json',JSON.stringify(res,null,1));
 process.exit(0);
})().catch(e=>{console.error(e.shortMessage||e.message);process.exit(1)});
