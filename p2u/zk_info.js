// 读取 zk/ref.r1cs 与 zk/ref.zkey 的规模信息：node p2u/zk_info.js
const snarkjs=require('snarkjs');
(async()=>{
 const logger={info:(...a)=>console.log(...a),warn:()=>{},error:console.error,debug:()=>{}};
 await snarkjs.r1cs.info('zk/ref.r1cs',logger);
 const z=await snarkjs.zKey.exportJson('zk/ref.zkey');
 console.log(`# zkey: protocol ${z.protocol}, nVars ${z.nVars}, nPublic ${z.nPublic}, domainSize ${z.domainSize}`);
 process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
