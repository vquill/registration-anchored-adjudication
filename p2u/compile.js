const solc=require('solc0826'),fs=require('fs');
const inp={language:'Solidity',sources:{'a.sol':{content:fs.readFileSync('p2u/Accountable.sol','utf8')}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
const o=JSON.parse(solc.compile(JSON.stringify(inp)));const e=(o.errors||[]).filter(x=>x.severity==='error');if(e.length){e.forEach(x=>console.error(x.formattedMessage));process.exit(1)}
const r={};for(const n of ['AccountableArbitration','BaselineArbitration']){const c=o.contracts['a.sol'][n];r[n]={abi:c.abi,bytecode:'0x'+c.evm.bytecode.object}}
fs.writeFileSync('p2u/build.json',JSON.stringify(r));console.log('编译通过，solc',solc.version());
