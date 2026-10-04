const {makeEnv}=require('../env.js'), fs=require('fs'), {ethers}=require('ethers'), solc=require('solc0826');
const K=ethers.solidityPackedKeccak256;
const comp=(srcs,file,name)=>{const o=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:Object.fromEntries(srcs.map(s=>[s,{content:fs.readFileSync('p2u/'+s,'utf8')}])),settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
  const e=(o.errors||[]).filter(x=>x.severity==='error'); if(e.length){e.forEach(x=>console.error(x.formattedMessage));process.exit(1)} const c=o.contracts[file][name]; return {abi:c.abi,bin:'0x'+c.evm.bytecode.object};};
const tree=ls=>{const L=[ls.slice()];while(L[L.length-1].length>1){const a=L[L.length-1];if(a.length%2)a.push(a[a.length-1]);const n=[];for(let j=0;j<a.length;j+=2)n.push(K(['bytes32','bytes32'],[a[j],a[j+1]]));L.push(n);}return L;};
const proof=(L,i)=>{const p=[];for(let d=0;d<L.length-1;d++){p.push(L[d][i^1]);i>>=1;}return p;};
(async()=>{
 const env=await makeEnv('merge'); const DO=env.off.DO;
 const CD=comp(['Final.sol','Batch.sol'],'Final.sol','DualMerkleArbitration'), CF=comp(['FullRecompute.sol'],'FullRecompute.sol','FullRecompute');
 const dep=async c=>{const f=new ethers.ContractFactory(c.abi,c.bin,env.s.TTP);const x=await f.deploy();await x.waitForDeployment();return x;};
 const D=await dep(CD), FR=await dep(CF); const Y=2022;
 await (await D.registerTable(Y,1,ethers.keccak256('0x01'))).wait();
 let res={register:{},dispute:{},full:{},sizes:{}}; try{res=JSON.parse(fs.readFileSync('p2u/scaleN3_result.json'));}catch(_){}
 const Ns=process.argv[2]?process.argv[2].split(',').map(Number):[10,50,100,200,500,1000,10000];
 for(const N of Ns){
   const id=BigInt(1000+N), t0=Date.now(); const leaves=[]; let sig0,m0;
   for(let i=0;i<N;i++){const v=5000+(i%3000); const m=K(['bytes1','uint256','uint32','uint16','uint16','uint32'],['0x01',id,i,Y,0x100|(i%38),v]);
     const s=i===0?await DO.signMessage(ethers.getBytes(m)):ethers.hexlify(ethers.randomBytes(65)); if(i===0){sig0=s;m0=m;} leaves.push(K(['bytes1','bytes32','bytes'],['0x01',m,s]));}
   const TV=tree(leaves), d=TV.length-1, ev=ethers.hexlify(ethers.randomBytes(32));
   await (await D.registerTask(id,Y,DO.address)).wait();
   const rg=await (await D.connect(env.s.DO).registerDataset(id,Y,d,TV[d][0],ev)).wait(); res.register[N]=Number(rg.gasUsed);
   const v0=5000, p0=proof(TV,0); const ds0=await DO.signMessage(ethers.getBytes(K(['bytes1','uint256','uint32','bytes32','bytes32'],['0x05',id,0,leaves[0],ethers.keccak256(ethers.concat(p0))])));
   const x=await (await D.connect(env.s.DB).disputeValue(id,{i:0,region:0x100,value:v0,sig:sig0,dsig:ds0,p:p0},{gasLimit:3000000})).wait(); res.dispute[N]={gas:Number(x.gasUsed),depth:d};
   if(N<=5000){ const fl=tree(leaves.slice())[0]; await (await FR.registerDataset(id,TV[d][0])).wait();
     try{const y=await (await FR.connect(env.s.DB).disputeFull(id,0,leaves[0],leaves,{gasLimit:6700000})).wait(); res.full[N]=Number(y.gasUsed);}catch(e){res.full[N]='超出区块上限';} }
   const valPre=1+32+4+2+2+4, sig=65; res.sizes[N]={dualTree:valPre+2*sig+32*d, singleTree:valPre+2*sig+32+32+32*d, wholeHash:N*(valPre+sig+32+32)};
   console.log(`N=${N}：登记 ${res.register[N]}；数值争议 ${res.dispute[N].gas}（深度 ${d}）；全量重算 ${res.full[N]??'—'}；用时 ${((Date.now()-t0)/1000).toFixed(1)} s`);
 }
 fs.writeFileSync('p2u/scaleN3_result.json',JSON.stringify(res,null,1));
})().catch(e=>{console.error(e.shortMessage||e.message);process.exit(1)});
