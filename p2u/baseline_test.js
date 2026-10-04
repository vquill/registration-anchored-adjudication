// 基线方案（不含签名绑定与来源绑定）的来源争议开销：须升级第三方，计入准入与裁决两笔交易
// 运行：node p2u/baseline_test.js   （在项目根目录下；依赖 env.js 与 p2u/build.json）
const {makeEnv}=require('../env.js'), fs=require('fs'), {ethers}=require('ethers');
const BO=JSON.parse(fs.readFileSync('p2u/build.json'));
const K=ethers.solidityPackedKeccak256;
const tree=ls=>{const L=[ls.slice()];while(L[L.length-1].length>1){const a=L[L.length-1];if(a.length%2)a.push(a[a.length-1]);const n=[];for(let j=0;j<a.length;j+=2)n.push(K(['bytes32','bytes32'],[a[j],a[j+1]]));L.push(n);}return L;};
const proof=(L,i)=>{const p=[];for(let d=0;d<L.length-1;d++){p.push(L[d][i^1]);i>>=1;}return p;};
(async()=>{
 const env=await makeEnv('merge'); const DO=env.off.DO, TTP=env.off.TTP;
 const f=new ethers.ContractFactory(BO.BaselineArbitration.abi,BO.BaselineArbitration.bytecode,env.s.TTP);
 const c=await f.deploy(); await c.waitForDeployment();
 await (await env.s.TTP.sendTransaction({to:await c.getAddress(),value:ethers.parseEther('1')})).wait();
 const I=new ethers.Interface(BO.BaselineArbitration.abi), id=1n, NR=41, Y=2022;   // 与 fix_test 相同：41 条记录，深度 6
 const lv=[]; for(let i=0;i<NR;i++){const m=K(['bytes1','uint256','uint32','uint16','uint16','uint32'],['0x01',id,i,Y,i,7035]); const s=await DO.signMessage(ethers.getBytes(m)); lv.push(K(['bytes1','bytes32','bytes'],['0x01',m,s]));}
 const T=tree(lv), D=T.length-1;
 await (await c.connect(env.s.DO).registerDataset(id,T[D][0])).wait();
 const ga=[],gv=[],tl={};
 for(let g=0;g<20;g++){const i=(g*13+5)%NR;
  const r1=await (await c.connect(env.s.DB).disputeEvidence(id,i,lv[i],proof(T,i),{gasLimit:3000000})).wait();
  let esc=false; for(const l of r1.logs){try{const e=I.parseLog(l); if(e&&e.name==='Ruling'&&Number(e.args[3])===3) esc=true;}catch(_){}}
  tl[esc?'升级TTP':'未升级']=(tl[esc?'升级TTP':'未升级']||0)+1; ga.push(Number(r1.gasUsed));
  const m=K(['bytes1','address','uint256','uint32','uint8'],['0x03',await c.getAddress(),id,i,2]);
  const r2=await (await c.connect(env.s.DB).verdict(id,i,2,await TTP.signMessage(ethers.getBytes(m)),{gasLimit:3000000})).wait(); gv.push(Number(r2.gasUsed));
 }
 const avg=a=>Math.round(a.reduce((p,q)=>p+q,0)/a.length);
 const res={admission:avg(ga),verdict:avg(gv),total:avg(ga)+avg(gv),tally:tl};
 fs.writeFileSync('p2u/baseline_result.json',JSON.stringify(res,null,1));
 console.log(`基线方案来源争议：准入 ${res.admission} Gas，TTP 裁决 ${res.verdict} Gas，合计 ${res.total} Gas（论文值 74 577）；${JSON.stringify(tl)}`);
 process.exit(0);
})().catch(e=>{console.error(e.shortMessage||e.message);process.exit(1)});