// 修订版主实验（表2、表4、各操作 Gas、密钥撤销、因子表版本与复核、案件与裁决）：node p2u/revised_fix_test.js
const {makeEnv}=require('../env.js'), fs=require('fs'), {ethers}=require('ethers');
const L=require('./revised_lib.js'); const {K,HP,rnd,sc,R16,avg,tree,proof,DEP,BOND,NOANCHOR,TTPW,send,run}=L;
const R0=JSON.parse(fs.readFileSync('p2u/ref_result.json'));
const NSECP=0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const highS=sig=>{const b=ethers.getBytes(sig);const s=BigInt(ethers.hexlify(b.slice(32,64)));return ethers.hexlify(ethers.concat([b.slice(0,32),ethers.toBeHex(NSECP-s,32),new Uint8Array([b[64]===27?28:27])]));};
const garbage=()=>ethers.hexlify(ethers.concat([ethers.randomBytes(64),'0x1b']));
const tamper=p=>{const q=p.slice();q[1]=rnd();return q;};
(async()=>{
 const env=await makeEnv('merge'); const DO=env.off.DO, DB=env.off.DB, RA=env.s.TTP; const Y=2022;
 const C=L.compile(['FinalRevised.sol'],'DualMerkleArbitrationRevised'); const abi=C.abi;
 const ctx=await L.deploy(env,C); const c=L.gl(ctx.c), m=ctx.m; const Dc=L.gl(ctx.c.connect(env.s.DB)), Do=L.gl(ctx.c.connect(env.s.DO));
 const out={tally:{},gas:{},checks:{}}; const add=(k,v)=>{out.tally[k]=out.tally[k]||{};out.tally[k][v]=(out.tally[k][v]||0)+1;}; const G=(k,g)=>{(out.gas[k]=out.gas[k]||[]).push(g);};
 const CR=L.controlledRecords(R0); const {recs,reg,staleIdx,table,tableSH,tableC2}=CR; const id=1n;
 const dep={value:DEP};
 // ---------- 登记：密钥、保证金、因子表（公示期）、任务、数据集 ----------
 G('registerKey',(await run(c.registerKey(DO.address,ethers.id('DO identity')),abi)).gas);
 G('depositBond',(await run(c.depositBond(DO.address,{value:BOND}),abi)).gas); await send(c.depositBond(DO.address,{value:ethers.parseEther('10')}));   // 实验中判违约次数多，预存足额保证金
 G('registerTable',(await run(c.registerTable(Y,1,ethers.keccak256(table),ethers.id('公告2024年第33号')),abi)).gas);
 await send(c.registerTable(Y,2,ethers.keccak256(tableSH),ethers.id('沪环气候[2026]5号'))); await send(c.registerTable(Y,3,ethers.keccak256(tableC2),ethers.id('公告2024年第33号-口径二')));
 out.checks.rewriteTable=(await run(c.registerTable(Y,1,ethers.keccak256(table),ethers.id('x')),abi)).out;
 G('registerTask',(await run(c.registerTask(id,Y,DO.address),abi)).gas);
 out.checks.taskWithoutKey=(await run(c.registerTask(99n,Y,DB.address),abi)).out;   // DB 未登记密钥
 const ds=await L.buildDataset(ctx,env,id,Y,recs,{register:false});
 out.checks.wrongYear=(await run(Do.registerDataset(id,Y-1,ds.D,ds.TV[ds.D][0],ds.TE[ds.D][0]),abi)).out;
 out.checks.wrongOwner=(await run(Dc.registerDataset(id,Y,ds.D,ds.TV[ds.D][0],ds.TE[ds.D][0]),abi)).out;
 G('registerDataset',(await run(Do.registerDataset(id,Y,ds.D,ds.TV[ds.D][0],ds.TE[ds.D][0]),abi)).gas);
 out.checks.reRegister=(await run(Do.registerDataset(id,Y,ds.D,rnd(),rnd()),abi)).out;
 out.checks.dupTask=(await run(c.registerTask(id,Y,DO.address),abi)).out;
 const refArgs=i=>[id,{i,region:reg(i),value:recs[i].v,sig:ds.sigs[i],path:proof(ds.TV,i),k:i>=38?0:i},i===38?tableSH:i>=39?tableC2:table,dep];
 // 公示期内：来源争议不予受理；异议→确认；期满生效
 out.checks.disputeDuringNotice=(await run(Dc.disputeReference(...refArgs(staleIdx[0])),abi)).out;
 G('objectTable',(await run(Dc.objectTable(Y,1,ethers.id('值与公告不符')),abi)).gas);
 out.checks.disputeWhileChallenged=(await run(Dc.disputeReference(...refArgs(staleIdx[0])),abi)).out;
 out.checks.confirmBeforeNotice=(await run(c.confirmTable(Y,1),abi)).out;   // 公示期内不能确认被异议的登记
 await L.passNotice(env);   // 公示期满：来源 1 可确认，来源 2、3 生效
 G('confirmTable',(await run(c.confirmTable(Y,1),abi)).gas);
 G('activateTable',(await run(c.activateTable(Y,2),abi)).gas); await send(c.activateTable(Y,3));
 out.checks.objectAfterNotice=(await run(Dc.objectTable(Y,2,ethers.id('late')),abi)).out;
 // ---------- 表2：攻击与诚实情形，各 20 次 ----------
 const dsig=async(i,leaf,p)=>DO.signMessage(ethers.getBytes(m.mD(id,i,leaf,HP(p))));
 const rct=async(signer,me,p)=>signer.signMessage(ethers.getBytes(m.mR(me,HP(p))));
 const NR=recs.length;
 for(let g=0;g<20;g++){const i=(g*13+5)%NR, pv=proof(ds.TV,i), pe=proof(ds.TE,i);
   const disc={i,region:reg(i),value:recs[i].v,sig:ds.sigs[i],dsig:await dsig(i,ds.lv[i],pv),path:pv};
   let x=await run(Dc.disputeValue(id,disc,NOANCHOR,dep),abi); add('V 诚实披露',x.out); G('disputeValue',x.gas);
   x=await run(Dc.disputeValue(id,{...disc,path:tamper(pv)},NOANCHOR,dep),abi); add('V DB 篡改路径构陷',x.out);
   const v2=recs[i].v+1, m2=m.mV(id,i,Y,reg(i),v2), s2=await DO.signMessage(ethers.getBytes(m2)), l2=m.leafV(m2,s2);
   x=await run(Dc.disputeValue(id,{i,region:reg(i),value:v2,sig:s2,dsig:await dsig(i,l2,pv),path:pv},NOANCHOR,dep),abi); add('V DO 披露不在树中的数值',x.out); G('disputeValue_DOfault',x.gas);
   const sg=garbage(), lg=m.leafV(m2,sg);
   x=await run(Dc.disputeValue(id,{i,region:reg(i),value:v2,sig:sg,dsig:await dsig(i,lg,pv),path:pv},NOANCHOR,dep),abi); add('V DO 披露篡改值且叶子签名无效',x.out);
   const sh=highS(s2), lh=m.leafV(m2,sh);
   x=await run(Dc.disputeValue(id,{i,region:reg(i),value:v2,sig:sh,dsig:await dsig(i,lh,pv),path:pv},NOANCHOR,dep),abi); add('V DO 披露篡改值且叶子签名为高 s',x.out);
   x=await run(Dc.disputeDoubleSign(id,i,{region:reg(i),value:recs[i].v,sig:ds.sigs[i]},{region:reg(i),value:v2,sig:s2},NOANCHOR,NOANCHOR,dep),abi); add('V DO 重复签名',x.out); G('disputeDoubleSign',x.gas);
   x=await run(Dc.disputeDoubleSign(id,i,{region:reg(i),value:recs[i].v,sig:ds.sigs[i]},{region:reg(i),value:v2,sig:await DB.signMessage(ethers.getBytes(m2))},NOANCHOR,NOANCHOR,dep),abi); add('V DB 伪造第二签名',x.out);
   x=await run(Dc.disputeValue(id,{...disc,dsig:await DB.signMessage(ethers.getBytes(m.mD(id,i,ds.lv[i],HP(pv))))},NOANCHOR,dep),abi); add('V DB 伪造披露签名',x.out);
   const me=m.mE(id,i,ds.ehs[i],ds.salts[i]), rc=await rct(DO,me,pe);
   x=await run(Dc.disputeEvidence(id,{i,eh:ds.ehs[i],salt:ds.salts[i],rcpt:rc,path:pe},NOANCHOR,dep),abi); add('E 诚实依据待审查',x.out); G('disputeEvidence_toTTP',x.gas);
   if(x.out===3){const cid=await c.caseCount(); const vs=await TTPW.signMessage(ethers.getBytes(await c.verdictDigest(cid,1))); const y=await run(Dc.verdict(cid,1,vs),abi); G('verdict_DOwins',y.gas);} // 结案以便后续用例
   x=await run(Dc.disputeEvidence(id,{i,eh:ds.ehs[i],salt:ds.salts[i],rcpt:rc,path:tamper(pe)},NOANCHOR,dep),abi); add('E DB 篡改路径构陷',x.out);
   const e2=rnd(), me2=m.mE(id,i,e2,ds.salts[i]);
   x=await run(Dc.disputeEvidence(id,{i,eh:e2,salt:ds.salts[i],rcpt:await rct(DO,me2,pe),path:pe},NOANCHOR,dep),abi); add('E DO 替换依据',x.out); G('disputeEvidence_DOfault',x.gas);
   x=await run(Dc.disputeEvidence(id,{i,eh:e2,salt:ds.salts[i],rcpt:await rct(DB,me2,pe),path:pe},NOANCHOR,dep),abi); add('E DB 伪造回执',x.out);
   x=await run(Dc.disputeEvidence(id,{i,eh:ds.ehs[i],salt:ds.salts[i],rcpt:rc,path:pe.slice(1)},NOANCHOR,dep),abi); add('E 截短路径（内部节点冒充）',x.out);
   const ps=pe.slice(1); x=await run(Dc.disputeEvidence(id,{i,eh:ds.ehs[i],salt:ds.salts[i],rcpt:await rct(DO,me,ps),path:ps},NOANCHOR,dep),abi); add('E DO 签署短路径回执',x.out);
 }
 // ---------- 表4：来源裁决（41 条真实记录） ----------
 const ref={};
 // 表4：在新登记的数据集上测量（与表6同口径：首次裁决、首次赔偿记位）
 const dR=await L.buildDataset(ctx,env,10n,Y,recs); const refArgsR=i=>[10n,{i,region:reg(i),value:recs[i].v,sig:dR.sigs[i],path:proof(dR.TV,i),k:i>=38?0:i},i===38?tableSH:i>=39?tableC2:table,dep];
 for(let i=0;i<NR;i++){const x=await run(Dc.disputeReference(...refArgsR(i)),abi); G(i<38?'disputeReference':'disputeReference_single',x.gas);
   const k=i===40?'caliberCompliant':i===39?'caliberMismatch':i===38?'localDeclaredLocal':i===16?'localDeclaredNational':CR.stale.has(i)?'stale':'correct'; ref[k]=ref[k]||{}; ref[k][x.out]=(ref[k][x.out]||0)+1;}
 out.reference=ref;
 // 同一违约只赔偿一次：重复争议仍判 DO 违约但不再划付；批内重复记录只赔偿一次
 { const i=staleIdx[0]; const b0=await c.bond(DO.address); const x=await run(Dc.disputeReference(...refArgsR(i)),abi); const b1=await c.bond(DO.address);
   out.checks.repeatOutcome=x.out; out.checks.repeatBondDelta=ethers.formatEther(b0-b1);
   const d9=await L.buildDataset(ctx,env,9n,Y,recs); const r9={i,region:reg(i),value:recs[i].v,sig:d9.sigs[i],path:proof(d9.TV,i),k:i};
   const b2=await c.bond(DO.address); const y=await send(Dc.disputeReferenceBatch(9n,Array(5).fill(r9),table,{...dep,gasLimit:6000000})); const b3=await c.bond(DO.address);
   const I=new ethers.Interface(abi); let f9=null; for(const l of y.logs){try{const e=I.parseLog(l); if(e&&e.name==='BatchRuling') f9=Number(e.args[1]);}catch(_){}}
   out.checks.batchDupFaults=f9; out.checks.batchDupBondDelta=ethers.formatEther(b2-b3); }
 // 过期记录叶子签名无效/高 s 时的来源争议：另建数据集
 for(const [name,fn] of [['R 过期记录叶子签名无效',()=>garbage()],['R 过期记录叶子签名为高 s',highS]]){
   const id2=name.includes('无效')?2n:3n; const d2=await L.buildDataset(ctx,env,id2,Y,recs,{leafSig:(s,i)=>staleIdx.includes(i)?fn(s):s});
   for(const i of staleIdx){const x=await run(Dc.disputeReference(id2,{i,region:reg(i),value:recs[i].v,sig:d2.sigs[i],path:proof(d2.TV,i),k:i},table,dep),abi); add(name,x.out);}
 }
 // DO 少报深度：披露的路径长度与登记不符 → 数值争议判 DO 违约
 { const id3=4n; const d3=await L.buildDataset(ctx,env,id3,Y,recs,{depth:ds.D-1});
   for(const i of [5,9,17,26,33]){const pv=proof(d3.TV,i); const x=await run(Dc.disputeValue(id3,{i,region:reg(i),value:recs[i].v,sig:d3.sigs[i],dsig:await DO.signMessage(ethers.getBytes(m.mD(id3,i,d3.lv[i],HP(pv)))),path:pv},NOANCHOR,dep),abi); add('V DO 少报深度后披露',x.out);} }
 // ---------- 拒绝出具回执 ----------
 const reqArgs=async(i,signer)=>{const pv=proof(ds.TV,i); const sg=(signer||DO).signMessage(ethers.getBytes(m.mD(id,i,ds.lv[i],HP(pv)))); return [id,i,ds.lv[i],HP(pv),await sg,NOANCHOR,dep];};
 G('requestEvidence',(await run(Dc.requestEvidence(...await reqArgs(30)),abi)).gas);
 const pe30=proof(ds.TE,30); G('respondEvidence',(await run(Do.respondEvidence(id,30,ds.ehs[30],ds.salts[30],await rct(DO,m.mE(id,30,ds.ehs[30],ds.salts[30]),pe30),pe30),abi)).gas);
 out.checks.requestNoDisclosure=(await run(Dc.requestEvidence(...await reqArgs(32,DB)),abi)).out;
 await send(Dc.requestEvidence(...await reqArgs(31))); out.checks.refusalEarly=(await run(Dc.claimNoReceipt(id,31),abi)).out;
 out.checks.claimByOther=(await run(Do.claimNoReceipt(id,31),abi)).out;
 await env.p.send('evm_increaseTime',[86401]); await env.p.send('evm_mine',[]);
 { const b0=BigInt(await env.p.send('eth_getBalance',[DB.address,'latest'])); const x=await run(Dc.claimNoReceipt(id,31),abi); if(x.out==='revert') console.log('claimNoReceipt revert:',x.msg); out.checks.refusalLate=x.out; G('claimNoReceipt',x.gas);
   const b1=BigInt(await env.p.send('eth_getBalance',[DB.address,'latest'])); out.checks.claimPayout=ethers.formatEther(b1-b0+BigInt(x.rc.gasUsed)*x.rc.gasPrice); }
 { const bb=await c.bond(DO.address); await send(Dc.requestEvidence(...await reqArgs(31))); await env.p.send('evm_increaseTime',[86401]); await env.p.send('evm_mine',[]);
   const y=await run(Dc.claimNoReceipt(id,31),abi); out.checks.repeatNoReceiptOutcome=y.out; out.checks.repeatNoReceiptBondDelta=ethers.formatEther(bb-await c.bond(DO.address)); }
 // 逾期未主张的请求可被覆盖
 await send(Dc.requestEvidence(...await reqArgs(33))); out.checks.overwritePending=(await run(Dc.requestEvidence(...await reqArgs(33)),abi)).out;
 await env.p.send('evm_increaseTime',[2*86400+1]); await env.p.send('evm_mine',[]);
 out.checks.overwriteAbandoned=(await run(Dc.requestEvidence(...await reqArgs(33)),abi)).out===null?'成功':'失败';
 // ---------- 案件与第三方裁决 ----------
 { const i=36, pe=proof(ds.TE,i), me=m.mE(id,i,ds.ehs[i],ds.salts[i]), rc=await rct(DO,me,pe);
   const x=await run(Dc.disputeEvidence(id,{i,eh:ds.ehs[i],salt:ds.salts[i],rcpt:rc,path:pe},NOANCHOR,dep),abi); const cid=await c.caseCount();
   out.checks.duplicateEscalation=(await run(Dc.disputeEvidence(id,{i,eh:ds.ehs[i],salt:ds.salts[i],rcpt:rc,path:pe},NOANCHOR,dep),abi)).out;
   const bond0=await c.bond(DO.address); const sig=await TTPW.signMessage(ethers.getBytes(await c.verdictDigest(cid,2)));
   out.checks.verdictWrongWinnerSig=(await run(Dc.verdict(cid,1,sig),abi)).out;
   const y=await run(Dc.verdict(cid,2,sig),abi); G('verdict_DBwins',y.gas); out.checks.verdictOutcome=y.out;
   out.checks.bondAfterVerdict=ethers.formatEther(bond0-await c.bond(DO.address));
   out.checks.verdictReplay=(await run(Dc.verdict(cid,2,sig),abi)).out;
   out.checks.reEscalateAfterClose=(await run(Dc.disputeEvidence(id,{i,eh:ds.ehs[i],salt:ds.salts[i],rcpt:rc,path:pe},NOANCHOR,dep),abi)).out;
   const cid2=await c.caseCount(); const b4=await c.bond(DO.address);
   const z=await run(Dc.verdict(cid2,2,await TTPW.signMessage(ethers.getBytes(await c.verdictDigest(cid2,2)))),abi);
   out.checks.repeatVerdictOutcome=z.out; out.checks.repeatVerdictBondDelta=ethers.formatEther(b4-await c.bond(DO.address)); }
 // ---------- 因子表正式修订与登记纠错 ----------
 { // 修订：来源 1 被来源 4（新版本）取代，强制切换时间为当前；此后登记的数据集若仍声明来源 1 → 版本争议判违约
   const table4=ethers.concat(R0.f2022.map((v,r)=>ethers.solidityPacked(['uint16','uint16','uint32'],[Y,R16(4,r),sc(v+0.0001)])));
   await send(c.registerTable(Y,4,ethers.keccak256(table4),ethers.id('勘误公告'))); await send(c.registerTable(Y,7,ethers.id('t7'),ethers.id('t7'))); await send(c.registerTable(Y,8,ethers.id('t8'),ethers.id('t8'))); await L.passNotice(env);
   const now=BigInt((await env.p.getBlock('latest')).timestamp);
   out.checks.retroactiveCutover=(await run(c.supersedeTable(Y,7,8,now-7n*86400n),abi)).out;   // 强制切换早于修订时刻：拒绝
   G('supersedeTable',(await run(c.supersedeTable(Y,1,4,now+60n),abi)).gas);
   out.checks.reSupersede=(await run(c.supersedeTable(Y,1,4,now+120n),abi)).out;   // 已被取代的版本再次修订：拒绝
   out.checks.refOnSuperseded=(await run(Dc.disputeReference(...refArgs(staleIdx[0])),abi)).out;         // 旧数据集按声明版本照常裁决
   out.checks.versionOldDataset=(await run(Dc.disputeVersion(id,{i:0,region:reg(0),value:recs[0].v,sig:ds.sigs[0],path:proof(ds.TV,0),k:0},dep),abi)).out;
   await env.p.send('evm_increaseTime',[61]); await env.p.send('evm_mine',[]);   // 越过强制切换时刻
   const id5=5n; const d5=await L.buildDataset(ctx,env,id5,Y,recs);   // 强制切换后登记却仍声明来源 1
   const x=await run(Dc.disputeVersion(id5,{i:0,region:reg(0),value:recs[0].v,sig:d5.sigs[0],path:proof(d5.TV,0),k:0},dep),abi); out.checks.versionNewDataset=x.out; G('disputeVersion',x.gas);
   // 纠错：来源 2（上海表）登记错误，撤销并指定纠错版本 5
   const tableSH5=ethers.solidityPacked(['uint16','uint16','uint32'],[Y,R16(2,16),sc(0.4850)]);   // 纠错登记沿用原来源标识 2 的条目编码，仅登记槽位为 5
   await send(c.registerTable(Y,5,ethers.keccak256(tableSH5),ethers.id('沪环气候[2026]5号-纠错'))); await L.passNotice(env);
   G('revokeTable',(await run(c.revokeTable(Y,2,5,ethers.id('登记错误')),abi)).gas);
   // 记录 38 声明来源 2：争议改按纠错版本（DB 提交纠错表）求值；复核输出结论
   const x2=await run(Dc.disputeReference(id,{i:38,region:reg(38),value:recs[38].v,sig:ds.sigs[38],path:proof(ds.TV,38),k:0},tableSH5,dep),abi); out.checks.refWithReplacement=x2.out;
   const x3=await run(c.reviewReference(id,{i:38,region:reg(38),value:recs[38].v,sig:ds.sigs[38],path:proof(ds.TV,38),k:0},tableSH5),abi); G('reviewReference',x3.gas);
   { const IR=new ethers.Interface(abi); let rv=null; for(const l of x3.rc.logs){try{const e=IR.parseLog(l); if(e&&e.name==='Review') rv=Number(e.args[4]);}catch(_){}} out.checks.review=rv; out.checks.reviewNoRuling=(x3.out===null); }
   // 撤销且无纠错版本：转复核，押金退还
   await send(c.revokeTable(Y,3,0,ethers.id('待核')));
   out.checks.refRevokedNoReplacement=(await run(Dc.disputeReference(...refArgs(40)),abi)).out; }
 // ---------- 密钥撤销与锚定 ----------
 { const id6=6n; const d6=await L.buildDataset(ctx,env,id6,Y,recs); const i=staleIdx[0], j=7;
   // DB 在收到披露后把签名摘要锚定上链（一个根覆盖多条）
   const pv=proof(d6.TV,i), pj=proof(d6.TV,j); const dsI=await DO.signMessage(ethers.getBytes(m.mD(id6,i,d6.lv[i],HP(pv)))), dsJ=await DO.signMessage(ethers.getBytes(m.mD(id6,j,d6.lv[j],HP(pj))));
   const v2=recs[j].v+1, m2=m.mV(id6,j,Y,reg(j),v2), s2=await DO.signMessage(ethers.getBytes(m2));
   const leaves=[dsI,dsJ,s2,d6.sigs[j]].map(s=>ethers.keccak256(s)); const AT=tree(leaves); const an=k=>({root:AT[AT.length-1][0],index:k,proof:proof(AT,k)});
   G('anchor',(await run(Dc.anchor(AT[AT.length-1][0]),abi)).gas);
   await send(c.connect(env.s.DO).revokeKey(DO.address,ethers.id('DO 申报失密')));   // 持有人自行申报撤销
   out.checks.refAfterRevocation=(await run(Dc.disputeReference(id6,{i,region:reg(i),value:recs[i].v,sig:d6.sigs[i],path:pv,k:i},table,dep),abi)).out;   // 无需签名 → 照常
   out.checks.valueUnanchoredAfterRevocation=(await run(Dc.disputeValue(id6,{i,region:reg(i),value:recs[i].v,sig:d6.sigs[i],dsig:dsI,path:pv},NOANCHOR,dep),abi)).out;
   const xa=await run(Dc.disputeValue(id6,{i,region:reg(i),value:recs[i].v,sig:d6.sigs[i],dsig:dsI,path:pv},an(0),dep),abi); out.checks.valueAnchoredAfterRevocation=xa.out; G('disputeValue_anchored',xa.gas);
   out.checks.doubleSignAnchoredAfterRevocation=(await run(Dc.disputeDoubleSign(id6,j,{region:reg(j),value:recs[j].v,sig:d6.sigs[j]},{region:reg(j),value:v2,sig:s2},an(3),an(2),dep),abi)).out;
   out.checks.registerWithRevokedKey=(await run(c.registerTask(7n,Y,DO.address),abi)).out;
   const DO2=new ethers.Wallet('0x'+'66'.repeat(32),env.p); await send(env.s.TTP.sendTransaction({to:DO2.address,value:ethers.parseEther('1')}));
   await send(c.registerKey(DO2.address,ethers.id('DO identity'))); out.checks.rotatedKeyTask=(await run(c.registerTask(7n,Y,DO2.address),abi)).out===null?'成功':'失败'; }
 // ---------- 结算核对：判违约时 DB 收回押金并获赔付 ----------
 { const id8=8n; await send(c.registerTask(id8,Y,(await (async()=>{const DO3=new ethers.Wallet('0x'+'77'.repeat(32),env.p); await send(env.s.TTP.sendTransaction({to:DO3.address,value:ethers.parseEther('1')})); await send(c.registerKey(DO3.address,ethers.id('DO3'))); await send(c.depositBond(DO3.address,{value:BOND})); return DO3;})()).address)); }
 const avgAll=a=>Math.round(a.reduce((p,q)=>p+q,0)/a.length); for(const k of Object.keys(out.gas)) out.gas[k]=avgAll(out.gas[k]);
 fs.writeFileSync('p2u/revised_result.json',JSON.stringify(out,null,1));
 const nm={0:'不予受理',1:'判 DO 违约',2:'质疑不成立',3:'升级 TTP',4:'待复核',revert:'交易回退',null:'成功'};
 for(const k of Object.keys(out.tally)) console.log(k.padEnd(22),Object.entries(out.tally[k]).map(([o,n])=>`${nm[o]||o} ${n}`).join('，'));
 console.log('登记约束：',Object.entries(out.checks).filter(([k])=>['rewriteTable','taskWithoutKey','wrongYear','wrongOwner','reRegister','dupTask','registerWithRevokedKey'].includes(k)).map(([k,v])=>`${k}=${nm[v]??v}`).join('；'));
 console.log('因子表：',['disputeDuringNotice','disputeWhileChallenged','confirmBeforeNotice','objectAfterNotice','refOnSuperseded','versionOldDataset','versionNewDataset','refWithReplacement','review','refRevokedNoReplacement'].map(k=>`${k}=${nm[out.checks[k]]??out.checks[k]}`).join('；'));
 console.log('依据请求：',['requestNoDisclosure','refusalEarly','claimByOther','refusalLate','claimPayout','overwritePending','overwriteAbandoned'].map(k=>`${k}=${nm[out.checks[k]]??out.checks[k]}`).join('；'));
 console.log('重复赔偿：',['repeatOutcome','repeatBondDelta','batchDupFaults','batchDupBondDelta','repeatNoReceiptOutcome','repeatNoReceiptBondDelta','repeatVerdictOutcome','repeatVerdictBondDelta','retroactiveCutover','reSupersede','reviewNoRuling'].map(k=>`${k}=${nm[out.checks[k]]??out.checks[k]}`).join('；'));
 console.log('案件：',['duplicateEscalation','verdictWrongWinnerSig','verdictOutcome','bondAfterVerdict','verdictReplay','reEscalateAfterClose'].map(k=>`${k}=${nm[out.checks[k]]??out.checks[k]}`).join('；'));
 console.log('密钥：',['refAfterRevocation','valueUnanchoredAfterRevocation','valueAnchoredAfterRevocation','doubleSignAnchoredAfterRevocation','rotatedKeyTask'].map(k=>`${k}=${nm[out.checks[k]]??out.checks[k]}`).join('；'));
 console.log('来源裁决：',JSON.stringify(ref));
 console.log('Gas：',JSON.stringify(out.gas));
 process.exit(0);
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
