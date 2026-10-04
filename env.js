const ganache=require('ganache'), { ethers }=require('ethers');
const KEYS={ DO:'0x'+'11'.repeat(32), DB:'0x'+'22'.repeat(32), TTP:'0x'+'33'.repeat(32) };
async function makeEnv(hardfork){
  const provider=ganache.provider({ logging:{quiet:true},
    chain:{hardfork, chainId:1337}, miner:{blockGasLimit:6721975},
    wallet:{accounts:Object.values(KEYS).map(k=>({secretKey:k,balance:'0x'+(10n**24n).toString(16)}))} });
  const p=new ethers.BrowserProvider(provider);
  const s={}, off={};                                   // s：节点托管账户发交易；off：离线钱包签消息
  for(const [r,k] of Object.entries(KEYS)){ off[r]=new ethers.Wallet(k); s[r]=await p.getSigner(off[r].address); }
  return {p,s,off};
}
async function deploy(env, build){
  const f=new ethers.ContractFactory(build.abi, build.bytecode, env.s.DO);
  const c=await f.deploy(env.off.TTP.address); await c.waitForDeployment(); return c;
}
module.exports={makeEnv,deploy,KEYS};
