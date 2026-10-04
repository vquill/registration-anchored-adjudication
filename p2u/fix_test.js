const {makeEnv}=require('../env.js'), fs=require('fs'), {ethers}=require('ethers');
const B=JSON.parse(fs.readFileSync('p2u/final_build.json')), BO=JSON.parse(fs.readFileSync('p2u/build.json')), R0=JSON.parse(fs.readFileSync('p2u/ref_result.json'));
const {names,f2021,f2022,SH_LOCAL_2022}=R0; const stale=new Set(R0.stale); const sc=x=>Math.round(x*10000), M=names.length, D=6, id=1n, Y=2022;
const K=ethers.solidityPackedKeccak256, rnd=()=>ethers.hexlify(ethers.randomBytes(32)), HP=p=>ethers.keccak256(ethers.concat(p));
const tree=ls=>{const L=[ls.slice()];while(L[L.length-1].length>1){const a=L[L.length-1];if(a.length%2)a.push(a[a.length-1]);const n=[];for(let j=0;j<a.length;j+=2)n.push(K(['bytes32','bytes32'],[a[j],a[j+1]]));L.push(n);}return L;};
const proof=(L,i)=>{const p=[];for(let d=0;d<L.length-1;d++){p.push(L[d][i^1]);i>>=1;}return p;};
const tamper=p=>{const q=p.slice();q[1]=rnd();return q;};
(async()=>{
 const env=await makeEnv('merge'); const DO=env.off.DO, DB=env.off.DB, TTP=env.off.TTP;
 const dep=async(c,bin)=>{const f=new ethers.ContractFactory(c.abi,bin||c.bytecode,env.s.TTP);const x=await f.deploy();await x.waitForDeployment();await (await env.s.TTP.sendTransaction({to:await x.getAddress(),value:ethers.parseEther('1')})).wait();return x;};
 const Dm=await dep(B.DualMerkleArbitration); const I=new ethers.Interface(B.DualMerkleArbitration.abi);
 const run=async(c,Ii,fn,args)=>{try{const rc=await (await c[fn](...args,{gasLimit:3000000})).wait();for(const l of rc.logs){try{const e=Ii.parseLog(l);if(e&&e.name==='Ruling')return{out:Number(e.args[3]),gas:Number(rc.gasUsed)}}catch(_){}}return{out:-1,gas:Number(rc.gasUsed)}}catch(e){return{out:'revert'}}};
 const out={tally:{},gas:{}}; const add=(k,v)=>{out.tally[k]=out.tally[k]||{};out.tally[k][v]=(out.tally[k][v]||0)+1;}; const G=(k,g)=>{(out.gas[k]=out.gas[k]||[]).push(g);};
 const R16=(s,r)=>(s<<8)|r;
 const table=ethers.concat(f2022.map((v,r)=>ethers.solidityPacked(['uint16','uint16','uint32'],[Y,R16(1,r),sc(v)]))); const tableSH=ethers.solidityPacked(['uint16','uint16','uint32'],[Y,R16(2,16),sc(SH_LOCAL_2022)]);
 const C2_2022=0.5856, NAT_2022=f2022[0];   // 口径二：全国电力平均（不含市场化交易的非化石能源电量），文献[4]
 const tableC2=ethers.solidityPacked(['uint16','uint16','uint32'],[Y,R16(3,0),sc(C2_2022)]);
 G('registerTable',Number((await (await Dm.registerTable(Y,1,ethers.keccak256(table))).wait()).gasUsed)); await (await Dm.registerTable(Y,2,ethers.keccak256(tableSH))).wait(); await (await Dm.registerTable(Y,3,ethers.keccak256(tableC2))).wait();
 out.rewrite=(await run(Dm,I,'registerTable',[Y,1,ethers.keccak256(table)])).out;
 const vals=f2022.map((v,r)=>stale.has(r)?f2021[r]:v); vals[16]=SH_LOCAL_2022; vals.push(SH_LOCAL_2022,NAT_2022,C2_2022); const reg=i=>i===38?R16(2,16):i>=39?R16(3,0):R16(1,i), NR=M+3;
 const mV=(i,r,v)=>K(['bytes1','uint256','uint32','uint16','uint16','uint32'],['0x01',id,i,Y,r,v]);
 const mE=(i,eh,s)=>K(['bytes1','uint256','uint32','bytes32','bytes32'],['0x02',id,i,eh,s]);
 const sigs=[],lv=[],ehs=[],salts=[],le=[];
 for(let i=0;i<NR;i++){const m=mV(i,reg(i),sc(vals[i]));const s=await DO.signMessage(ethers.getBytes(m));sigs.push(s);lv.push(K(['bytes1','bytes32','bytes'],['0x01',m,s]));ehs.push(rnd());salts.push(rnd());le.push(K(['bytes1','bytes32'],['0x02',mE(i,ehs[i],salts[i])]));}
 const TV=tree(lv), TE=tree(le);
 G('registerTask',Number((await (await Dm.registerTask(id,Y,env.off.DO.address)).wait()).gasUsed));
 out.wrongYear=(await run(Dm.connect(env.s.DO),I,'registerDataset',[id,Y-1,D,TV[D][0],TE[D][0]])).out;
 out.wrongOwner=(await run(Dm.connect(env.s.DB),I,'registerDataset',[id,Y,D,TV[D][0],TE[D][0]])).out;
 G('registerDataset',Number((await (await Dm.connect(env.s.DO).registerDataset(id,Y,D,TV[D][0],TE[D][0])).wait()).gasUsed));
 out.reRegister=(await run(Dm.connect(env.s.DO),I,'registerDataset',[id,Y,D,rnd(),rnd()])).out;
 out.dupTask=(await run(Dm,I,'registerTask',[id,Y,env.off.DO.address])).out;
 const dsig=async(i,leaf,p)=>DO.signMessage(ethers.getBytes(K(['bytes1','uint256','uint32','bytes32','bytes32'],['0x05',id,i,leaf,HP(p)])));
 const rct=async(signer,m,p)=>signer.signMessage(ethers.getBytes(K(['bytes1','bytes32','bytes32'],['0x06',m,HP(p)])));
 for(let g=0;g<20;g++){const i=(g*13+5)%NR, pv=proof(TV,i), pe=proof(TE,i);
   const disc={i,region:reg(i),value:sc(vals[i]),sig:sigs[i],dsig:await dsig(i,lv[i],pv),p:pv};
   let x=await run(Dm.connect(env.s.DB),I,'disputeValue',[id,disc]); add('V 诚实披露',x.out); G('disputeValue',x.gas);
   x=await run(Dm.connect(env.s.DB),I,'disputeValue',[id,{...disc,p:tamper(pv)}]); add('V DB 篡改路径构陷',x.out);
   const v2=sc(vals[i])+1, m2=mV(i,reg(i),v2), s2=await DO.signMessage(ethers.getBytes(m2)), l2=K(['bytes1','bytes32','bytes'],['0x01',m2,s2]);
   x=await run(Dm.connect(env.s.DB),I,'disputeValue',[id,{i,region:reg(i),value:v2,sig:s2,dsig:await dsig(i,l2,pv),p:pv}]); add('V DO 披露不在树中的数值',x.out); G('disputeValue_DOfault',x.gas);
   x=await run(Dm.connect(env.s.DB),I,'disputeDoubleSign',[id,i,reg(i),sc(vals[i]),sigs[i],reg(i),v2,s2]); add('V DO 重复签名',x.out); G('disputeDoubleSign',x.gas);
   x=await run(Dm.connect(env.s.DB),I,'disputeDoubleSign',[id,i,reg(i),sc(vals[i]),sigs[i],reg(i),v2,await DB.signMessage(ethers.getBytes(m2))]); add('V DB 伪造第二签名',x.out);
   x=await run(Dm.connect(env.s.DB),I,'disputeValue',[id,{...disc,dsig:await DB.signMessage(ethers.getBytes(K(['bytes1','uint256','uint32','bytes32','bytes32'],['0x05',id,i,lv[i],HP(pv)])))}]); add('V DB 伪造披露签名',x.out);
   const me=mE(i,ehs[i],salts[i]), rc=await rct(DO,me,pe);
   x=await run(Dm.connect(env.s.DB),I,'disputeEvidence',[id,i,ehs[i],salts[i],rc,pe]); add('E 诚实依据待审查',x.out); G('disputeEvidence_toTTP',x.gas);
   x=await run(Dm.connect(env.s.DB),I,'disputeEvidence',[id,i,ehs[i],salts[i],rc,tamper(pe)]); add('E DB 篡改路径构陷',x.out);
   const e2=rnd(), me2=mE(i,e2,salts[i]);
   x=await run(Dm.connect(env.s.DB),I,'disputeEvidence',[id,i,e2,salts[i],await rct(DO,me2,pe),pe]); add('E DO 替换依据',x.out); G('disputeEvidence_DOfault',x.gas);
   x=await run(Dm.connect(env.s.DB),I,'disputeEvidence',[id,i,e2,salts[i],await rct(DB,me2,pe),pe]); add('E DB 伪造回执',x.out);
   x=await run(Dm.connect(env.s.DB),I,'disputeEvidence',[id,i,ehs[i],salts[i],rc,pe.slice(1)]); add('E 截短路径（内部节点冒充）',x.out);
 }
 // 来源裁决（39 条真实记录）
 const ref={}; for(let i=0;i<NR;i++){const tb=i===38?tableSH:i>=39?tableC2:table; const x=await run(Dm.connect(env.s.DB),I,'disputeReference',[id,i,reg(i),sc(vals[i]),sigs[i],proof(TV,i),tb,i>=38?0:i]); G(i<38?'disputeReference':'disputeReference_single',x.gas);
   const k=i===40?'caliberCompliant':i===39?'caliberMismatch':i===38?'localDeclaredLocal':i===16?'localDeclaredNational':stale.has(i)?'stale':'correct'; ref[k]=ref[k]||{}; ref[k][x.out]=(ref[k][x.out]||0)+1;} out.reference=ref;
 // 拒绝出具回执与 TTP 裁决
 G('requestEvidence',Number((await (await Dm.connect(env.s.DB).requestEvidence(id,30)).wait()).gasUsed));
 const pe30=proof(TE,30); G('respondEvidence',Number((await (await Dm.connect(env.s.DO).respondEvidence(id,30,ehs[30],salts[30],await rct(DO,mE(30,ehs[30],salts[30]),pe30),pe30)).wait()).gasUsed));
 await (await Dm.connect(env.s.DB).requestEvidence(id,31)).wait(); out.refusalEarly=(await run(Dm.connect(env.s.DB),I,'claimNoReceipt',[id,31])).out;
 await env.p.send('evm_increaseTime',[86401]); await env.p.send('evm_mine',[]); const cl=await run(Dm.connect(env.s.DB),I,'claimNoReceipt',[id,31]); out.refusalLate=cl.out; G('claimNoReceipt',cl.gas);
 const vm=K(['bytes1','address','uint256','uint32','uint8'],['0x09',await Dm.getAddress(),id,3,2]); G('verdict',(await run(Dm.connect(env.s.DB),I,'verdict',[id,3,2,await TTP.signMessage(ethers.getBytes(vm))])).gas);
 // 原设计（数值争议不绑定路径）在同样的构陷下
 const A=await dep(BO.AccountableArbitration); const IA=new ethers.Interface(BO.AccountableArbitration.abi);
 await (await A.registerVersion(rnd(),1)).wait(); const N0=64; const mO=(i,v)=>K(['bytes1','uint256','uint32','uint32','int256'],['0x01',7n,i,1,v]);
 const so=[],lo=[]; for(let i=0;i<N0;i++){const m=mO(i,BigInt(1000+i)); const s=await DO.signMessage(ethers.getBytes(m)); so.push(s); lo.push(K(['bytes1','bytes32','bytes'],['0x01',m,s]));}
 const TO=tree(lo); await (await A.connect(env.s.DO).registerDataset(7n,1,1,6,TO[6][0],ethers.ZeroHash)).wait();
 for(let g=0;g<20;g++){const i=(g*7+3)%N0; const x=await run(A.connect(env.s.DB),IA,'disputeValue',[7n,i,BigInt(1000+i),so[i],tamper(proof(TO,i))]); add('原设计 DB 篡改路径构陷',x.out);}
 const avg=a=>Math.round(a.reduce((p,q)=>p+q,0)/a.length); for(const k of Object.keys(out.gas)) out.gas[k]=avg(out.gas[k]);
 fs.writeFileSync('p2u/fix_result.json',JSON.stringify(out,null,1));
 const nm={1:'判 DO 违约',2:'质疑不成立',3:'升级 TTP',revert:'交易回退'};
 for(const k of Object.keys(out.tally)) console.log(k.padEnd(20),Object.entries(out.tally[k]).map(([o,c])=>`${nm[o]||o} ${c}/20`).join('，'));
 console.log('登记约束：年度不符',nm[out.wrongYear]||out.wrongYear,'；非任务主体',nm[out.wrongOwner]||out.wrongOwner,'；重复登记',nm[out.reRegister]||out.reRegister,'；重复任务',nm[out.dupTask]||out.dupTask);
 console.log('来源裁决：',JSON.stringify(ref),'；改写因子表 →',nm[out.rewrite]||out.rewrite,'；拒绝回执：时限前',nm[out.refusalEarly]||out.refusalEarly,'，逾期',nm[out.refusalLate]);
 console.log('Gas：',JSON.stringify(out.gas));
})().catch(e=>{console.error(e.shortMessage||e.message);process.exit(1)});
