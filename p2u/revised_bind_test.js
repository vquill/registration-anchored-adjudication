// 绑定消融（定理 2）：在修订版合约上分别去除一项绑定，其余不变：node p2u/revised_bind_test.js
const {makeEnv}=require('../env.js'), fs=require('fs'), {ethers}=require('ethers');
const L=require('./revised_lib.js'); const {K,HP,rnd,sc,R16,tree,proof,DEP,BOND,NOANCHOR,send,run}=L;
const SRC=fs.readFileSync('p2u/FinalRevised.sol','utf8');
const once=(s,a,b,tag)=>{const n=s.split(a).length-1; if(n!==1) throw new Error(`${tag}：匹配 ${n} 次`); return s.replace(a,b);};
const POS_V='keccak256(abi.encodePacked(TAG_V, DOMAIN, id, i, year, region, value)); // POS_V';
const POS_D='keccak256(abi.encodePacked(TAG_D, DOMAIN, id, i, leaf, pathHash)); // POS_D PATH_D';
const PATH_R='keccak256(abi.encodePacked(TAG_R, DOMAIN, me, pathHash)); // PATH_R';
const RCPT='if (out == 2) { // RCPT';
const RCPT_A='out = 1; // RCPT_A';
const VARIANTS={
  full:SRC,
  noPos:once(once(SRC,POS_V,'keccak256(abi.encodePacked(TAG_V, DOMAIN, year, region, value)); // POS_V','位置·数值消息'),POS_D,'keccak256(abi.encodePacked(TAG_D, DOMAIN, leaf, pathHash)); // POS_D PATH_D','位置·披露消息'),
  noPath:once(once(SRC,POS_D,'keccak256(abi.encodePacked(TAG_D, DOMAIN, id, i, leaf)); // POS_D PATH_D','路径·披露消息'),PATH_R,'keccak256(abi.encodePacked(TAG_R, DOMAIN, me)); // PATH_R','路径·回执消息'),
  noRcptA:once(SRC,RCPT,'if (true) { // RCPT','签收·规则甲'),
  noRcptB:once(once(SRC,RCPT,'if (true) { // RCPT','签收·规则乙'),RCPT_A,'out = 2; // RCPT_A','签收·规则乙')};
const NAME={full:'完整绑定（本文）',noPos:'去除位置绑定',noPath:'去除路径绑定',noRcptA:'去除交付签收（不在树中判DO违约）',noRcptB:'去除交付签收（不在树中判不成立）'};
const OUT={0:'不予受理',1:'判DO违约',2:'不成立',3:'升级TTP',4:'待复核',revert:'回退'};
(async()=>{
 const env=await makeEnv('merge'); const DO=env.off.DO, DB=env.off.DB; const Y=2022;
 const R0=JSON.parse(fs.readFileSync('p2u/ref_result.json')); const CR=L.controlledRecords(R0); const recs=CR.recs.slice(0,38), reg=CR.reg, NR=38;
 const result={};
 for(const [vn,src] of Object.entries(VARIANTS)){
  const C=L.compile(['FinalRevised.sol'],'DualMerkleArbitrationRevised',{'FinalRevised.sol':src});
  const ctx=await L.deploy(env,C); const c=L.gl(ctx.c), dom=ctx.dom; const Dc=L.gl(ctx.c.connect(env.s.DB));
  const noPos=vn==='noPos', noPath=vn==='noPath';
  const mV=(id,i,r,v)=>noPos?K(['bytes1','bytes32','uint16','uint16','uint32'],['0x01',dom,Y,r,v]):K(['bytes1','bytes32','uint256','uint32','uint16','uint16','uint32'],['0x01',dom,id,i,Y,r,v]);
  const mD=(id,i,leaf,ph)=>noPos?K(['bytes1','bytes32','bytes32','bytes32'],['0x05',dom,leaf,ph]):noPath?K(['bytes1','bytes32','uint256','uint32','bytes32'],['0x05',dom,id,i,leaf]):K(['bytes1','bytes32','uint256','uint32','bytes32','bytes32'],['0x05',dom,id,i,leaf,ph]);
  const mR=(me,ph)=>noPath?K(['bytes1','bytes32','bytes32'],['0x06',dom,me]):K(['bytes1','bytes32','bytes32','bytes32'],['0x06',dom,me,ph]);
  const id=1n; await send(c.registerKey(DO.address,ethers.id('DO'))); await send(c.depositBond(DO.address,{value:ethers.parseEther('10')}));
  await send(c.registerTable(Y,1,ethers.keccak256(CR.table),ethers.id('a'))); await L.passNotice(env); await send(c.activateTable(Y,1)); await send(c.registerTask(id,Y,DO.address));
  const sigs=[],lv=[],ehs=[],salts=[],le=[];
  for(let i=0;i<NR;i++){const m=mV(id,i,reg(i),recs[i].v);const s=await DO.signMessage(ethers.getBytes(m));sigs.push(s);lv.push(K(['bytes1','bytes32','bytes'],['0x01',m,s]));ehs.push(rnd());salts.push(rnd());le.push(K(['bytes1','bytes32'],['0x02',ctx.m.mE(id,i,ehs[i],salts[i])]));}
  const TV=tree(lv), TE=tree(le), D=TV.length-1;
  await send(L.gl(ctx.c.connect(env.s.DO)).registerDataset(id,Y,D,TV[D][0],TE[D][0]));
  const dsig=async(i,leaf,p)=>DO.signMessage(ethers.getBytes(mD(id,i,leaf,HP(p))));
  const rct=async(signer,me,p)=>signer.signMessage(ethers.getBytes(mR(me,HP(p))));
  const tamper=p=>{const q=p.slice();q[1]=rnd();return q;};
  const T={}; const add=(k,v)=>{T[k]=T[k]||{};T[k][OUT[v]]=(T[k][OUT[v]]||0)+1;};
  const dep={value:DEP};
  for(let g=0;g<20;g++){
   const i=(g*13+5)%NR, j=(i^1)<NR?(i^1):i-1, pv=proof(TV,i), pj=proof(TV,j), pe=proof(TE,i);
   const disc={i,region:reg(i),value:recs[i].v,sig:sigs[i],dsig:await dsig(i,lv[i],pv),path:pv};
   add('诚实披露',(await run(Dc.disputeValue(id,disc,NOANCHOR,dep),C.abi)).out);
   add('DB挪用他处披露构陷',(await run(Dc.disputeValue(id,{i,region:reg(j),value:recs[j].v,sig:sigs[j],dsig:await dsig(j,lv[j],pj),path:pj},NOANCHOR,dep),C.abi)).out);
   add('DB篡改路径构陷',(await run(Dc.disputeValue(id,{...disc,path:tamper(pv)},NOANCHOR,dep),C.abi)).out);
   const k=(j+2)%NR===i?(j+3)%NR:(j+2)%NR;
   add('DB拼接重复签名构陷',(await run(Dc.disputeDoubleSign(id,i,{region:reg(j),value:recs[j].v,sig:sigs[j]},{region:reg(k),value:recs[k].v,sig:sigs[k]},NOANCHOR,NOANCHOR,dep),C.abi)).out);
   const me=ctx.m.mE(id,i,ehs[i],salts[i]);
   const x=await run(Dc.disputeEvidence(id,{i,eh:ehs[i],salt:salts[i],rcpt:await rct(DO,me,pe),path:pe},NOANCHOR,dep),C.abi); add('诚实依据',x.out);
   if(x.out===3){const cid=await c.caseCount(); await send(Dc.verdict(cid,1,await L.TTPW.signMessage(ethers.getBytes(await c.verdictDigest(cid,1)))));}
   add('DB篡改依据路径构陷',(await run(Dc.disputeEvidence(id,{i,eh:ehs[i],salt:salts[i],rcpt:await rct(DO,me,pe),path:tamper(pe)},NOANCHOR,dep),C.abi)).out);
   const eh2=rnd(), s2=rnd(), m2=ctx.m.mE(id,i,eh2,s2);
   add('DB伪造依据',(await run(Dc.disputeEvidence(id,{i,eh:eh2,salt:s2,rcpt:await rct(DB,m2,pe),path:pe},NOANCHOR,dep),C.abi)).out);
   add('DO替换依据',(await run(Dc.disputeEvidence(id,{i,eh:eh2,salt:s2,rcpt:await rct(DO,m2,pe),path:pe},NOANCHOR,dep),C.abi)).out);
  }
  result[vn]=T;
  console.log(NAME[vn]+'：'+Object.entries(T).map(([k,v])=>k+' '+Object.entries(v).map(([o,n])=>`${o} ${n}/20`).join('、')).join('；'));
 }
 fs.writeFileSync('p2u/revised_bind_result.json',JSON.stringify(result,null,1));
 process.exit(0);
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
