// 真实案例复现：两份公开核查报告中的因子争议，用本文合约（final_build.json，与 fix_test.js 相同）链上裁决
// 运行：node p2u/realcase_test.js   （在“本地EVM消融实验”目录下）
// 案例数据均原样取自公开核查报告：
//  A 宁波柏厨集成厨房有限公司 2020 年度（宁波能信科技有限公司，2021-04-12 签发）：
//    净购入电力 8157 MWh；区域电网平均排放因子 初始报告值 0.7921，核查值 0.7035
//    （数据来源“2011年和2012年中国区域电网平均二氧化碳排放因子（2012年）”）；排放量 初始 6461.16，核查 5738.45 tCO2
//  B 宁波李氏实业有限公司 2021 年度（宁波能信科技有限公司，2022-04-09 签发）：
//    净购入电力 2129.4 MWh；区域电网平均排放因子 初始报告值 0.7035，核查值 0.64
//    （数据来源《宁波市星级绿色工厂评价导则》（2022版））；柴油排放 10.16；排放量 初始 1508.19，核查 1372.98 tCO2
const {makeEnv}=require('../env.js'), fs=require('fs'), {ethers}=require('ethers');
const B=JSON.parse(fs.readFileSync('p2u/final_build.json'));
const K=ethers.solidityPackedKeccak256, rnd=()=>ethers.hexlify(ethers.randomBytes(32));
const tree=ls=>{const L=[ls.slice()];while(L[L.length-1].length>1){const a=L[L.length-1];if(a.length%2)a.push(a[a.length-1]);const n=[];for(let j=0;j<a.length;j+=2)n.push(K(['bytes32','bytes32'],[a[j],a[j+1]]));L.push(n);}return L;};
const proof=(L,i)=>{const p=[];for(let d=0;d<L.length-1;d++){p.push(L[d][i^1]);i>>=1;}return p;};
const sc=x=>Math.round(x*10000), R16=(s,r)=>(s<<8)|r;
const SRC_A=4, SRC_B=5, EAST=3, NINGBO=1;   // 来源标识：4 发改委 2012 年区域电网平均因子；5 宁波市星级绿色工厂评价导则（2022版）
const CASES=[
 {name:'宁波柏厨（2020）初始报告', year:2020, src:SRC_A, reg:EAST,   v:0.7921, mwh:8157,   other:0,     report:6461.16},
 {name:'宁波柏厨（2020）核查后',   year:2020, src:SRC_A, reg:EAST,   v:0.7035, mwh:8157,   other:0,     report:5738.45},
 {name:'宁波李氏（2021）初始报告', year:2021, src:SRC_B, reg:NINGBO, v:0.7035, mwh:2129.4, other:10.16, report:1508.19},
 {name:'宁波李氏（2021）核查后',   year:2021, src:SRC_B, reg:NINGBO, v:0.64,   mwh:2129.4, other:10.16, report:1372.98}];
const AUTH={[`2020-${SRC_A}`]:{reg:EAST,v:0.7035},[`2021-${SRC_B}`]:{reg:NINGBO,v:0.64}};   // 核查报告所依据的权威值
(async()=>{
 const env=await makeEnv('merge'); const DO=env.off.DO;
 const f=new ethers.ContractFactory(B.DualMerkleArbitration.abi,B.DualMerkleArbitration.bytecode,env.s.TTP); const c=await f.deploy(); await c.waitForDeployment();
 const I=new ethers.Interface(B.DualMerkleArbitration.abi);
 const run=async(cc,fn,args)=>{try{const rc=await (await cc[fn](...args,{gasLimit:3000000})).wait();for(const l of rc.logs){try{const e=I.parseLog(l);if(e&&e.name==='Ruling')return{out:Number(e.args[3]),gas:Number(rc.gasUsed)}}catch(_){}}return{out:0,gas:Number(rc.gasUsed)}}catch(e){return{out:-1,gas:0}}};
 // RA 按年度与来源登记权威因子表（整表哈希）
 const tables={};
 for(const [k,a] of Object.entries(AUTH)){const [y,s]=k.split('-').map(Number); tables[k]=ethers.solidityPacked(['uint16','uint16','uint32'],[y,R16(s,a.reg),sc(a.v)]); await (await c.registerTable(y,s,ethers.keccak256(tables[k]))).wait();}
 const NAME={1:'判DO违约',2:'质疑不成立',[-1]:'回退'}; const res=[];
 let id=100n;
 for(const cs of CASES){
  id++; const r=R16(cs.src,cs.reg), v=sc(cs.v);
  const m=K(['bytes1','uint256','uint32','uint16','uint16','uint32'],['0x01',id,0,cs.year,r,v]); const sig=await DO.signMessage(ethers.getBytes(m));
  const lv=[K(['bytes1','bytes32','bytes'],['0x01',m,sig]),rnd()]; const le=[rnd(),rnd()];   // 该数据集含被争议记录及一条其他记录
  const TV=tree(lv), TE=tree(le), D=TV.length-1;
  await (await c.registerTask(id,cs.year,DO.address)).wait();
  await (await c.connect(env.s.DO).registerDataset(id,cs.year,D,TV[D][0],TE[D][0])).wait();
  const tally={}; let gas=0;
  for(let t=0;t<20;t++){const x=await run(c.connect(env.s.DB),'disputeReference',[id,0,r,v,sig,proof(TV,0),tables[`${cs.year}-${cs.src}`],0]); tally[NAME[x.out]]=(tally[NAME[x.out]]||0)+1; gas=x.gas;}
  const em=Math.round((cs.mwh*cs.v+cs.other)*100)/100;
  res.push({...cs,tally,gas,emission:em,match:Math.abs(em-cs.report)<0.005});
  console.log(`${cs.name}：因子 ${cs.v}，链上裁决 ${JSON.stringify(tally)}，单次 ${gas} Gas；复算排放量 ${em.toFixed(2)} t，报告值 ${cs.report.toFixed(2)} t，${Math.abs(em-cs.report)<0.005?'一致':'不一致'}`);
 }
 // C 河南华东工控技术有限公司 2024 年度（河南低碳节能减排技术开发有限公司，2025-01-15 签发，HNDT-THC-25-009，PDF 第 18 页）：
 //   电力 173.502 MWh；列示因子 0.5633，声明来源《关于发布2022年电力二氧化碳排放因子的公告》（公告2024年第33号）；结论“选取正确”；表内排放量 93.1 t
 //   该公告全国、区域与省级平均因子（与受控实验相同的 38 项，ref_result.json）中无 0.5633；全国平均 0.5366
 const R0=JSON.parse(fs.readFileSync('p2u/ref_result.json')); const f22=R0.f2022, nm=R0.names, SRC_C=6, YC=2024;
 const tableC=ethers.concat(f22.map((v,i)=>ethers.solidityPacked(['uint16','uint16','uint32'],[YC,R16(SRC_C,i),sc(v)])));
 await (await c.registerTable(YC,SRC_C,ethers.keccak256(tableC))).wait();
 // 列示值 0.5633 按 38 个条目逐一声明并登记，逐条发起来源争议；对照记录取全国平均 0.5366
 id++; const recs=f22.map((_,i)=>({r:R16(SRC_C,i),v:sc(0.5633)})).concat([{r:R16(SRC_C,0),v:sc(0.5366)}]);
 const ms=recs.map((q,i)=>K(['bytes1','uint256','uint32','uint16','uint16','uint32'],['0x01',id,i,YC,q.r,q.v]));
 const sg=[]; for(const m of ms) sg.push(await DO.signMessage(ethers.getBytes(m)));
 const lvC=ms.map((m,i)=>K(['bytes1','bytes32','bytes'],['0x01',m,sg[i]])), leC=ms.map(()=>rnd());
 const TVC=tree(lvC), TEC=tree(leC), DC=TVC.length-1;
 await (await c.registerTask(id,YC,DO.address)).wait(); await (await c.connect(env.s.DO).registerDataset(id,YC,DC,TVC[DC][0],TEC[DC][0])).wait();
 const tl={}, gs=[];
 for(let i=0;i<f22.length;i++){const x=await run(c.connect(env.s.DB),'disputeReference',[id,i,recs[i].r,recs[i].v,sg[i],proof(TVC,i),tableC,i]); tl[NAME[x.out]]=(tl[NAME[x.out]]||0)+1; gs.push(x.gas);}
 const j=f22.length, tc={}; let gc=0;
 for(let t=0;t<20;t++){const x=await run(c.connect(env.s.DB),'disputeReference',[id,j,recs[j].r,recs[j].v,sg[j],proof(TVC,j),tableC,0]); tc[NAME[x.out]]=(tc[NAME[x.out]]||0)+1; gc=x.gas;}
 const e1=Math.round(173.502*0.5633*100)/100, e2=Math.round(173.502*0.5366*100)/100;
 console.log(`河南华东工控（2024）列示 0.5633：公告中等于该值的条目 ${f22.filter(v=>Math.abs(v-0.5633)<1e-9).length} 个；对 ${f22.length} 个条目逐一争议 ${JSON.stringify(tl)}，单次 ${Math.min(...gs)}~${Math.max(...gs)} Gas；复算 173.502×0.5633=${e1.toFixed(2)} t，与表内 93.1 t ${Math.abs(e1-93.1)<0.05?'一致':'不符'}`);
 console.log(`河南华东工控（2024）对照 0.5366（全国）：${JSON.stringify(tc)}，单次 ${gc} Gas；复算 173.502×0.5366=${e2.toFixed(2)} t，与表内 93.1 t ${Math.abs(e2-93.1)<0.05?'一致':'不符'}`);
 res.push({name:'河南华东工控（2024）',listed:0.5633,entries:f22.length,tally:tl,control:tc,em_listed:e1,em_national:e2,report:93.1});
 fs.writeFileSync('p2u/realcase_result.json',JSON.stringify(res,null,1));
 process.exit(0);
})().catch(e=>{console.error(e.shortMessage||e.message);process.exit(1);});