// 修订版实验的公共代码（在仓库根目录运行各脚本）
const fs=require('fs'), {ethers}=require('ethers'), solc=require('solc0826');
const K=ethers.solidityPackedKeccak256, HP=p=>ethers.keccak256(ethers.concat(p)), rnd=()=>ethers.hexlify(ethers.randomBytes(32));
const sc=x=>Math.round(x*10000), R16=(s,r)=>(s<<8)|r, avg=a=>Math.round(a.reduce((x,y)=>x+y,0)/a.length);
const tree=ls=>{const L=[ls.slice()];while(L[L.length-1].length>1){const a=L[L.length-1];if(a.length%2)a.push(a[a.length-1]);const n=[];for(let j=0;j<a.length;j+=2)n.push(K(['bytes32','bytes32'],[a[j],a[j+1]]));L.push(n);}return L;};
const proof=(L,i)=>{const p=[];for(let d=0;d<L.length-1;d++){p.push(L[d][i^1]);i>>=1;}return p;};
const DEP=ethers.parseEther('0.01'), BOND=ethers.parseEther('0.1'), NOANCHOR={root:ethers.ZeroHash,index:0,proof:[]};
const TTPW=new ethers.Wallet('0x'+'44'.repeat(32));   // 独立的 TTP 验签私钥（RA 为 env.s.TTP 账户）

function compile(files,name,src){
  const sources=Object.fromEntries(files.map(f=>[f,{content:src&&src[f]?src[f]:fs.readFileSync('p2u/'+f,'utf8')}]));
  const o=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
  const er=(o.errors||[]).filter(x=>x.severity==='error'); if(er.length){er.forEach(x=>console.error(x.formattedMessage));process.exit(1);}
  for(const f of files){const c=o.contracts[f]&&o.contracts[f][name]; if(c) return {abi:c.abi,bin:'0x'+c.evm.bytecode.object};}
  throw new Error('contract not found: '+name);
}
function msgs(dom){ return {
  mV:(id,i,y,r,v)=>K(['bytes1','bytes32','uint256','uint32','uint16','uint16','uint32'],['0x01',dom,id,i,y,r,v]),
  leafV:(m,s)=>K(['bytes1','bytes32','bytes'],['0x01',m,s]),
  mE:(id,i,eh,salt)=>K(['bytes1','uint256','uint32','bytes32','bytes32'],['0x02',id,i,eh,salt]),
  leafE:me=>K(['bytes1','bytes32'],['0x02',me]),
  mD:(id,i,leaf,ph)=>K(['bytes1','bytes32','uint256','uint32','bytes32','bytes32'],['0x05',dom,id,i,leaf,ph]),
  mR:(me,ph)=>K(['bytes1','bytes32','bytes32','bytes32'],['0x06',dom,me,ph]) };}
async function deploy(env,C,args){
  const f=new ethers.ContractFactory(C.abi,C.bin,env.s.TTP); const c=await f.deploy(...(args||[env.off.TTP.address,TTPW.address])); await c.waitForDeployment();
  const dom=K(['uint256','address'],[1337n,await c.getAddress()]);
  return {c,m:msgs(dom),dom};
}
const send=async p=>(await (await p).wait());
const outOf=(rc,abi)=>{const I=new ethers.Interface(abi);let o=null;for(const l of rc.logs){try{const e=I.parseLog(l);if(e&&e.name==='Ruling')o=Number(e.args[3]);}catch(_){}}return o;};
/// 运行一笔交易：返回 {out, gas} 或 {out:'revert'}
const run=async(p,abi)=>{try{const rc=await (await p).wait();return {out:outOf(rc,abi),gas:Number(rc.gasUsed),rc};}catch(e){return {out:'revert',msg:(e.shortMessage||e.message||'').slice(0,60)};}};
/// 构造数据集：recs=[{r,v}]，leafSig 可替换叶子签名；返回签名、叶子、两棵树
async function buildDataset(ctx,env,id,year,recs,{leafSig=(s,i)=>s,depth=null,register=true}={}){
  const c=gl(ctx.c), m=ctx.m, DO=env.off.DO; const sigs=[],lv=[],ehs=[],salts=[],le=[];
  for(let i=0;i<recs.length;i++){const mv=m.mV(id,i,year,recs[i].r,recs[i].v); const s=leafSig(await DO.signMessage(ethers.getBytes(mv)),i);
    sigs.push(s); lv.push(m.leafV(mv,s)); ehs.push(rnd()); salts.push(rnd()); le.push(m.leafE(m.mE(id,i,ehs[i],salts[i])));}
  const TV=tree(lv), TE=tree(le), D=TV.length-1;
  if(register){ await send(c.registerTask(id,year,DO.address)); await send(gl(ctx.c.connect(env.s.DO)).registerDataset(id,year,depth??D,TV[D][0],TE[D][0])); }
  return {sigs,lv,ehs,salts,le,TV,TE,D};
}
/// 41 条受控记录（与原 fix_test.js 相同）：9 条沿用 2021 年值、第 16 条为上海地方值、末 3 条为地方来源/口径二记录
function controlledRecords(R0){
  const {f2021,f2022,SH_LOCAL_2022}=R0, stale=new Set(R0.stale);
  const vals=f2022.map((v,r)=>stale.has(r)?f2021[r]:v); vals[16]=SH_LOCAL_2022; vals.push(SH_LOCAL_2022,f2022[0],0.5856);
  const reg=i=>i===38?R16(2,16):i>=39?R16(3,0):R16(1,i);
  return {recs:vals.map((v,i)=>({r:reg(i),v:sc(v)})),vals,reg,stale,staleIdx:[...stale].filter(i=>i!==16),
    table:ethers.concat(f2022.map((v,r)=>ethers.solidityPacked(['uint16','uint16','uint32'],[2022,R16(1,r),sc(v)]))),
    tableSH:ethers.solidityPacked(['uint16','uint16','uint32'],[2022,R16(2,16),sc(SH_LOCAL_2022)]),
    tableC2:ethers.solidityPacked(['uint16','uint16','uint32'],[2022,R16(3,0),sc(0.5856)])};
}
/// 让公示期过去并生效
async function passNotice(env){ await env.p.send('evm_increaseTime',[7*86400+1]); await env.p.send('evm_mine',[]); }
/// 给合约的每次调用加上显式 gasLimit（Ganache 对含转账的交易估算 Gas 不稳定，与原脚本做法一致）
function gl(contract,gasLimit=3000000){
  return new Proxy(contract,{get(t,p){const v=t[p]; if(typeof v==='function'&&typeof p==='string'&&t.interface&&t.interface.hasFunction(p)){
    return (...args)=>{const n=t.interface.getFunction(p).inputs.length; if(args.length>n) args[n]={gasLimit,...args[n]}; else args.push({gasLimit}); return v.apply(t,args);};}
    return typeof v==='function'?v.bind(t):v;}});
}
module.exports={gl,K,HP,rnd,sc,R16,avg,tree,proof,DEP,BOND,NOANCHOR,TTPW,compile,msgs,deploy,send,outOf,run,buildDataset,controlledRecords,passNotice};
