// FairDT 链上不当行为判定复现（按原文第 3 轮合约流程与算法 3）：测单次投诉的端到端链上开销
// 运行：node p2u/fairdt_test.js   （在“本地EVM消融实验”目录下）
const {makeEnv}=require('../env.js'), fs=require('fs'), {ethers}=require('ethers'), solc=require('solc0826'), {buildBn128}=require('ffjavascript');
const R=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const mod=a=>((a%R)+R)%R, pw=(b,e)=>{let r=1n;b=mod(b);while(e>0n){if(e&1n)r=r*b%R;b=b*b%R;e>>=1n;}return r;}, inv=a=>pw(a,R-2n);
const rnd=()=>mod(BigInt(ethers.hexlify(ethers.randomBytes(32))));
const K=ethers.solidityPackedKeccak256;
(async()=>{
 const o=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'f.sol':{content:fs.readFileSync('p2u/FairDTJudge.sol','utf8')}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'FairDTJudge':['abi','evm.bytecode.object']}}}})));
 const err=(o.errors||[]).filter(e=>e.severity==='error'); if(err.length){console.error(err[0].formattedMessage);process.exit(1);}
 const C=o.contracts['f.sol'].FairDTJudge;
 const bn=await buildBn128(true); const G1=bn.G1, G2=bn.G2, Fr=bn.Fr;
 const g1=s=>{const p=G1.toObject(G1.toAffine(G1.timesFr(G1.g,Fr.e(mod(s)))));return [p[0],p[1]];};
 const add1=(a,b)=>{const p=G1.toObject(G1.toAffine(G1.add(G1.fromObject([a[0],a[1],1n]),G1.fromObject([b[0],b[1],1n]))));return [p[0],p[1]];};
 const mulP=(a,s)=>{const p=G1.toObject(G1.toAffine(G1.timesFr(G1.fromObject([a[0],a[1],1n]),Fr.e(mod(s)))));return [p[0],p[1]];};
 const tau=rnd(); const t2=G2.toObject(G2.toAffine(G2.timesFr(G2.g,Fr.e(tau))));
 const tG2=[t2[0][1],t2[0][0],t2[1][1],t2[1][0]];   // EIP-197：x 虚部、x 实部、y 虚部、y 实部
 // KZG：f 在 τ 处的值（拉格朗日插值），承诺 f(τ)·G1，在节点 z 处的见证 ((f(τ)−f(z))/(τ−z))·G1
 const fTau=(xs,ys)=>{let s=0n;for(let j=0;j<xs.length;j++){let num=1n,den=1n;for(let k=0;k<xs.length;k++){if(k===j)continue;num=num*mod(tau-BigInt(xs[k]))%R;den=den*mod(BigInt(xs[j])-BigInt(xs[k]))%R;}s=mod(s+ys[j]*num%R*inv(den));}return s;};
 const env=await makeEnv('merge'); const S=env.s.DO, B=env.s.DB;
 const f=new ethers.ContractFactory(C.abi,'0x'+C.evm.bytecode.object,env.s.TTP); const c=await f.deploy(tG2); await c.waitForDeployment(); const I=new ethers.Interface(C.abi);
 const now=async()=>BigInt((await env.s.TTP.provider.getBlock('latest')).timestamp);
 const res={cheat:[],honest:[],out:{cheat:{},honest:{},badWitness:{}}};
 let id=0n;
 const trade=async(cheat,badW)=>{
  id++;
  const sk=rnd(), PK=g1(sk), kap=rnd(), Kp=g1(kap), rho=rnd(), c1=g1(rho), c2=add1(Kp,mulP(PK,rho));
  const k=K(['uint256','uint256'],[Kp[0],Kp[1]]);
  const m=16, z=[0n]; for(let x=1;x<=m;x++) z.push(BigInt(ethers.hexlify(ethers.randomBytes(8))));
  const gates=[]; for(let g=1;g<=8;g++){const a=9+((2*g-2)%8), b=9+((2*g-1)%8); gates.push({op:1n,a,b}); z[g]=z[a]+z[b];}
  const gi=1+Number(id%8n); if(cheat) z[gi]=z[gi]+1n;
  const Z=[0n]; for(let x=1;x<=m;x++) Z.push(z[x]^BigInt(K(['bytes32','uint256'],[k,x])));
  const xz=[...Array(m).keys()].map(i=>i+1), yz=xz.map(x=>mod(BigInt(K(['uint256'],[Z[x]])))), fz=fTau(xz,yz);
  const xp=[1,2,3,4,5,6,7,8], yp=gates.map(g=>mod(BigInt(K(['uint256','uint256','uint256'],[g.op,g.a,g.b])))), fp=fTau(xp,yp);
  const CZ=g1(fz), CP=g1(fp);
  const wit=(fv,y,x)=>g1(mod((fv-y)*inv(mod(tau-BigInt(x)))));
  const G=gates[gi-1];
  const op=(x)=>({z:Z[x],w:wit(fz,yz[x-1],x)});
  const pf={i:gi,op:G.op,in1:G.a,in2:G.b,wphi:wit(fp,yp[gi-1],gi),out:op(gi),a:op(G.a),b:op(G.b)};
  if(badW) pf.a={z:pf.a.z,w:pf.b.w};
  await (await c.connect(B).open(id,await S.getAddress(),[PK[0],PK[1],c1[0],c1[1],c2[0],c2[1],CZ[0],CZ[1],CP[0],CP[1]],(await now())+86400n,{value:ethers.parseEther('0.01')})).wait();
  const rc=await (await c.connect(B).complain(id,sk,pf,{gasLimit:3000000})).wait();
  let outc=0; for(const l of rc.logs){try{const e=I.parseLog(l);if(e&&e.name==='Result')outc=Number(e.args[1]);}catch(_){}}
  return {gas:Number(rc.gasUsed),out:outc};
 };
 const tag={1:'判卖方不当行为并退款',2:'投诉不成立'};
 for(let t=0;t<20;t++){const r=await trade(true,false); res.cheat.push(r.gas); res.out.cheat[tag[r.out]]=(res.out.cheat[tag[r.out]]||0)+1;}
 for(let t=0;t<20;t++){const r=await trade(false,false); res.honest.push(r.gas); res.out.honest[tag[r.out]]=(res.out.honest[tag[r.out]]||0)+1;}
 for(let t=0;t<5;t++){const r=await trade(true,true); res.out.badWitness[tag[r.out]]=(res.out.badWitness[tag[r.out]]||0)+1;}
 const st=a=>({avg:Math.round(a.reduce((s,x)=>s+x,0)/a.length),min:Math.min(...a),max:Math.max(...a)});
 res.cheatGas=st(res.cheat); res.honestGas=st(res.honest);
 console.log(`卖方作弊（20 次）：${JSON.stringify(res.out.cheat)}；单次投诉 平均 ${res.cheatGas.avg} Gas（最小 ${res.cheatGas.min}，最大 ${res.cheatGas.max}）`);
 console.log(`卖方诚实（20 次）：${JSON.stringify(res.out.honest)}；单次投诉 平均 ${res.honestGas.avg} Gas（最小 ${res.honestGas.min}，最大 ${res.honestGas.max}）`);
 console.log(`见证错误（5 次，校验 Judge 拒绝无效证明）：${JSON.stringify(res.out.badWitness)}`);
 fs.writeFileSync('p2u/fairdt_result.json',JSON.stringify(res,null,1));
 process.exit(0);
})().catch(e=>{console.error(e.shortMessage||e.message);process.exit(1);});
