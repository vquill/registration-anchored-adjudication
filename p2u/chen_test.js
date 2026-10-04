const {makeEnv}=require('../env.js'), fs=require('fs'), {ethers}=require('ethers'), solc=require('solc0826');
(async()=>{
 const o=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'c.sol':{content:fs.readFileSync('p2u/Chen2022.sol','utf8')}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
 const e=(o.errors||[]).filter(x=>x.severity==='error'); if(e.length){e.forEach(x=>console.error(x.formattedMessage));process.exit(1)}
 const C=o.contracts['c.sol'].Chen2022Trading; const env=await makeEnv('merge');
 const R=JSON.parse(fs.readFileSync('p2u/ref_result.json')); const sc=x=>Math.round(x*10000);
 // 交易数据 S：DO 的 39 条 2022 年度核算记录（与本文实验相同），S1 为其 AES 密文的摘要所指代的链下数据，S2 为 256 位密钥
 const key=ethers.hexlify(ethers.randomBytes(32));
 const S1=ethers.concat(R.f2022.map((v,r)=>ethers.solidityPacked(['uint16','uint32'],[r,sc(v)])));   // 链下交付的大部分（此处以明文编码代表密文，仅其哈希上链）
 const H1=ethers.keccak256(S1), H2=ethers.keccak256(key), TAG=ethers.toBeHex(BigInt(H1)^BigInt(H2),32);
 const res={};
 for(const round of [1,2,3]){
   const f=new ethers.ContractFactory(C.abi,'0x'+C.evm.bytecode.object,env.s.TTP); const c=await f.deploy(env.off.DB.address,env.off.DO.address); await c.waitForDeployment();
   const g={}; const t=async(k,p)=>{const rc=await (await p).wait(); g[k]=Number(rc.gasUsed);};
   await t('requestData',c.connect(env.s.DB).requestData());
   await t('publishSenderProof',c.connect(env.s.DO).publishSenderProof(TAG,H1,{value:ethers.parseEther('0.01')}));
   await t('publishReceiverProof',c.connect(env.s.DB).publishReceiverProof(ethers.parseEther('0.01'),{value:ethers.parseEther('0.02')}));
   await t('makeDataAvailable',c.connect(env.s.DO).makeDataAvailable(key));
   await t('onChainArbitrate',c.connect(env.s.DB).onChainArbitrate());      // Tag 一致 → 暂判 DB 恶意（数据内容错误时的实际情形）
   await t('offChainArbitrate',c.connect(env.s.TTP).offChainArbitrate(1));  // 仲裁方线下审查后记录 DO 恶意
   res[round]=g;
 }
 const paper={requestData:66613,publishSenderProof:99085,publishReceiverProof:59629,makeDataAvailable:154756,onChainArbitrate:32602,offChainArbitrate:35035};
 console.log('事件'.padEnd(22),'原文表 I','本文复现','差异');
 for(const k of Object.keys(paper)) console.log(k.padEnd(22),String(paper[k]).padStart(8),String(res[1][k]).padStart(8),`${(100*(res[1][k]-paper[k])/paper[k]).toFixed(1)}%`.padStart(8));
 fs.writeFileSync('p2u/chen_result.json',JSON.stringify({paper,repro:res[1],rounds:res},null,1));
})().catch(e=>{console.error(e.shortMessage||e.message);process.exit(1)});
