// 绑定消融：在本文合约 Final.sol 上分别去除一项绑定，检验定理 2（绑定必要性）
// 运行：node p2u/bind_test.js   （在“本地EVM消融实验”目录下）
const {makeEnv}=require('../env.js'), fs=require('fs'), {ethers}=require('ethers'), solc=require('solc0826');
const SRC=fs.readFileSync('p2u/Final.sol','utf8');
const R0=JSON.parse(fs.readFileSync('p2u/ref_result.json'));
const {f2022,SH_LOCAL_2022}=R0; const sc=x=>Math.round(x*10000), D=6, id=1n, Y=2022;
const K=ethers.solidityPackedKeccak256, rnd=()=>ethers.hexlify(ethers.randomBytes(32)), HP=p=>ethers.keccak256(ethers.concat(p));
const tree=ls=>{const L=[ls.slice()];while(L[L.length-1].length>1){const a=L[L.length-1];if(a.length%2)a.push(a[a.length-1]);const n=[];for(let j=0;j<a.length;j+=2)n.push(K(['bytes32','bytes32'],[a[j],a[j+1]]));L.push(n);}return L;};
const proof=(L,i)=>{const p=[];for(let d=0;d<L.length-1;d++){p.push(L[d][i^1]);i>>=1;}return p;};
const tamper=p=>{const q=p.slice();q[1]=rnd();return q;};

// ---------- 变体：每个只改一处，替换须恰好命中一次 ----------
const once=(s,a,b,tag)=>{const n=s.split(a).length-1; if(n!==1) throw new Error(`${tag}：匹配 ${n} 次`); return s.replace(a,b);};
const V_MSG='keccak256(abi.encodePacked(TAG_V, keccak256(abi.encodePacked(TAG_V, id, d.i, s.year, d.region, d.value)), d.sig))';
const D_MSG='keccak256(abi.encodePacked(bytes1(0x05), id, d.i, leaf, keccak256(abi.encodePacked(d.p))))';
const R_CHK='if (_signer(keccak256(abi.encodePacked(bytes1(0x06), m, keccak256(abi.encodePacked(p)))), rcpt) == d.owner) {\n            if (!_rootOk(keccak256(abi.encodePacked(TAG_E, m)), i, p, d.depth, d.rootE)) out = 1;';
const VARIANTS={
  full:SRC,
  noPos:once(once(once(SRC,V_MSG,'keccak256(abi.encodePacked(TAG_V, keccak256(abi.encodePacked(TAG_V, s.year, d.region, d.value)), d.sig))','位置·数值消息'),
             D_MSG,'keccak256(abi.encodePacked(bytes1(0x05), leaf, keccak256(abi.encodePacked(d.p))))','位置·披露消息'),
             'return keccak256(abi.encodePacked(TAG_V, id, i, ds[id].year, r, v));','return keccak256(abi.encodePacked(TAG_V, ds[id].year, r, v));','位置·重复签名消息'),
  noPath:once(once(SRC,D_MSG,'keccak256(abi.encodePacked(bytes1(0x05), id, d.i, leaf))','路径·披露消息'),
              R_CHK,R_CHK.replace(', m, keccak256(abi.encodePacked(p)))), rcpt)',', m)), rcpt)'),'路径·回执消息'),
  noRcptA:once(SRC,R_CHK,'if (true) {\n            if (!_rootOk(keccak256(abi.encodePacked(TAG_E, m)), i, p, d.depth, d.rootE)) out = 1;','签收·规则甲'),
  noRcptB:once(SRC,R_CHK,'if (true) {\n            if (!_rootOk(keccak256(abi.encodePacked(TAG_E, m)), i, p, d.depth, d.rootE)) out = 2;','签收·规则乙')};
const NAME={full:'完整绑定（本文）',noPos:'去除位置绑定',noPath:'去除路径绑定',noRcptA:'去除交付签收（不在树中判DO违约）',noRcptB:'去除交付签收（不在树中判不成立）'};
const OUT={1:'判DO违约',2:'不成立',3:'升级TTP',[-1]:'回退'};
const compile=src=>{const o=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'F.sol':{content:src}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'DualMerkleArbitration':['abi','evm.bytecode.object']}}}})));
  const err=(o.errors||[]).filter(e=>e.severity==='error'); if(err.length) throw new Error(err[0].formattedMessage);
  const c=o.contracts['F.sol'].DualMerkleArbitration; return {abi:c.abi,bytecode:'0x'+c.evm.bytecode.object};};

(async()=>{
 const env=await makeEnv('merge'); const DO=env.off.DO, DB=env.off.DB;
 const vals=f2022.slice(); vals[16]=SH_LOCAL_2022; const NR=vals.length; const reg=i=>(1<<8)|i;
 const result={};
 for(const [vn,src] of Object.entries(VARIANTS)){
  const C=compile(src); const f=new ethers.ContractFactory(C.abi,C.bytecode,env.s.TTP); const c=await f.deploy(); await c.waitForDeployment();
  const I=new ethers.Interface(C.abi);
  const run=async(cc,fn,args)=>{try{const rc=await (await cc[fn](...args,{gasLimit:3000000})).wait();for(const l of rc.logs){try{const e=I.parseLog(l);if(e&&e.name==='Ruling')return Number(e.args[3])}catch(_){}}return 0}catch(e){return -1}};
  const noPos=vn==='noPos', noPath=vn==='noPath';
  const mV=(i,r,v)=>noPos?K(['bytes1','uint16','uint16','uint32'],['0x01',Y,r,v]):K(['bytes1','uint256','uint32','uint16','uint16','uint32'],['0x01',id,i,Y,r,v]);
  const mE=(i,eh,s)=>K(['bytes1','uint256','uint32','bytes32','bytes32'],['0x02',id,i,eh,s]);
  const sigs=[],lv=[],ehs=[],salts=[],le=[];
  for(let i=0;i<NR;i++){const m=mV(i,reg(i),sc(vals[i]));const s=await DO.signMessage(ethers.getBytes(m));sigs.push(s);lv.push(K(['bytes1','bytes32','bytes'],['0x01',m,s]));ehs.push(rnd());salts.push(rnd());le.push(K(['bytes1','bytes32'],['0x02',mE(i,ehs[i],salts[i])]));}
  const TV=tree(lv), TE=tree(le);
  await (await c.registerTask(id,Y,DO.address)).wait(); await (await c.connect(env.s.DO).registerDataset(id,Y,D,TV[D][0],TE[D][0])).wait();
  const dsig=async(i,leaf,p)=>DO.signMessage(ethers.getBytes(noPos?K(['bytes1','bytes32','bytes32'],['0x05',leaf,HP(p)]):noPath?K(['bytes1','uint256','uint32','bytes32'],['0x05',id,i,leaf]):K(['bytes1','uint256','uint32','bytes32','bytes32'],['0x05',id,i,leaf,HP(p)])));
  const rct=async(signer,m,p)=>signer.signMessage(ethers.getBytes(noPath?K(['bytes1','bytes32'],['0x06',m]):K(['bytes1','bytes32','bytes32'],['0x06',m,HP(p)])));
  const T={}; const add=(k,v)=>{T[k]=T[k]||{};T[k][OUT[v]]=(T[k][OUT[v]]||0)+1;};
  const Dc=c.connect(env.s.DB);
  for(let g=0;g<20;g++){
   const i=(g*13+5)%NR, j=(i^1)<NR?(i^1):i-1, pv=proof(TV,i), pj=proof(TV,j), pe=proof(TE,i);
   const disc={i,region:reg(i),value:sc(vals[i]),sig:sigs[i],dsig:await dsig(i,lv[i],pv),p:pv};
   add('诚实披露',await run(Dc,'disputeValue',[id,disc]));
   add('DB挪用他处披露构陷',await run(Dc,'disputeValue',[id,{i,region:reg(j),value:sc(vals[j]),sig:sigs[j],dsig:await dsig(j,lv[j],pj),p:pj}]));
   add('DB篡改路径构陷',await run(Dc,'disputeValue',[id,{...disc,p:tamper(pv)}]));
   const k=(j+2)%NR===i?(j+3)%NR:(j+2)%NR;
   add('DB拼接重复签名构陷',await run(Dc,'disputeDoubleSign',[id,i,reg(j),sc(vals[j]),sigs[j],reg(k),sc(vals[k]),sigs[k]]));
   add('诚实依据',await run(Dc,'disputeEvidence',[id,i,ehs[i],salts[i],await rct(DO,mE(i,ehs[i],salts[i]),pe),pe]));
   add('DB篡改依据路径构陷',await run(Dc,'disputeEvidence',[id,i,ehs[i],salts[i],await rct(DO,mE(i,ehs[i],salts[i]),pe),tamper(pe)]));
   const eh2=rnd(), s2=rnd(), m2=mE(i,eh2,s2);
   add('DB伪造依据',await run(Dc,'disputeEvidence',[id,i,eh2,s2,await rct(DB,m2,pe),pe]));
   add('DO替换依据',await run(Dc,'disputeEvidence',[id,i,eh2,s2,await rct(DO,m2,pe),pe]));
  }
  result[vn]=T;
  console.log(NAME[vn]+'：'+Object.entries(T).map(([k,v])=>k+' '+Object.entries(v).map(([o,n])=>`${o} ${n}/20`).join('、')).join('；'));
 }
 fs.writeFileSync('p2u/bind_result.json',JSON.stringify(result,null,1));
 process.exit(0);
})();
