const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),cp=require('node:child_process');
function spawn(home,port='8766'){const p=cp.spawn(process.execPath,[path.join(__dirname,'start.cjs')],{env:{...process.env,AGENTBOARD_HOME:home,AGENTBOARD_PORT:port},stdio:['ignore','pipe','pipe']});p.log='';p.stdout.on('data',b=>p.log+=b);p.stderr.on('data',b=>p.log+=b);return p}
function ended(p){return new Promise((resolve,reject)=>{const t=setTimeout(()=>{p.kill();reject(Error('child exit timed out '+p.log))},10000);p.once('exit',c=>{clearTimeout(t);resolve(c)})})}
async function ready(p){for(let i=0;i<100;i++){if(p.exitCode!==null)throw Error(p.log);if(p.log.includes('已启动'))return;await new Promise(r=>setTimeout(r,50))}throw Error('launcher readiness timeout')}
test('launcher loopback HTML token, duplicate rejection, owned cleanup, occupied port preserved',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'board start 中文 '));let p,foreign,otherProject;
 try{otherProject=http.createServer((_,res)=>res.end('other project'));await new Promise(r=>otherProject.listen(8765,'127.0.0.1',r));p=spawn(home);await ready(p);const health=await(await fetch('http://127.0.0.1:8766/api/health')).json();assert.equal(await(await fetch('http://127.0.0.1:8765/')).text(),'other project');assert.equal(health.mode,'read-only');assert.equal(health.activeRunId,null);const html=await(await fetch('http://127.0.0.1:8766/')).text();assert.match(html,/meta name="agentboard-token"/);const duplicate=spawn(home);assert.equal(await ended(duplicate),1);assert.match(duplicate.log,/已有启动器/);assert.ok(fs.existsSync(path.join(home,'launcher.lock')));const done=ended(p);p.kill('SIGTERM');await done;p=null;assert.equal(fs.existsSync(path.join(home,'launcher.lock')),false);
 foreign=http.createServer((_,res)=>res.end('foreign'));await new Promise(r=>foreign.listen(8766,'127.0.0.1',r));const collision=spawn(home);assert.equal(await ended(collision),1);assert.ok(foreign.listening);assert.equal(await(await fetch('http://127.0.0.1:8766/')).text(),'foreign');assert.equal(fs.existsSync(path.join(home,'launcher.lock')),false);
 }finally{if(p&&p.exitCode===null){const done=ended(p);p.kill('SIGTERM');await done}if(foreign)await new Promise(r=>foreign.close(r));if(otherProject)await new Promise(r=>otherProject.close(r));fs.rmSync(home,{recursive:true,force:true})}
});

test('custom port and invalid port configuration',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'board custom port '));let p;
 try{p=spawn(home,'8877');await ready(p);assert.match(p.log,/127\.0\.0\.1:8877/);assert.equal((await(await fetch('http://127.0.0.1:8877/api/health')).json()).mode,'read-only');const done=ended(p);p.kill('SIGTERM');await done;p=null;const invalid=spawn(home,'0');assert.equal(await ended(invalid),1);assert.match(invalid.log,/端口无效/);assert.equal(fs.existsSync(path.join(home,'launcher.lock')),false);
 }finally{if(p&&p.exitCode===null){const done=ended(p);p.kill('SIGTERM');await done}fs.rmSync(home,{recursive:true,force:true})}
});
