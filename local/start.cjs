'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {createBridge}=require('./bridge.cjs');
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<12)){console.error('需要能在本机运行的 Node.js 22.12 或更高版本。');process.exit(1)}
const home=process.env.AGENTBOARD_HOME||path.join(os.homedir(),'agentboard-local');
fs.mkdirSync(home,{recursive:true});const lock=path.join(home,'launcher.lock');let owns=false,bridge,stopping=false;
async function stop(code=0){if(stopping)return;stopping=true;try{if(bridge)await bridge.close()}catch(e){console.error('停止失败：'+e.message);code=1}finally{if(owns)fs.rmSync(lock,{recursive:true,force:true});process.exitCode=code}}
(async()=>{try{
 const portFile=path.join(__dirname,'..','PORT.txt');
 const configured=process.env.AGENTBOARD_PORT||(fs.existsSync(portFile)?fs.readFileSync(portFile,'utf8').trim():'8766');
 if(!/^\d+$/.test(configured)||Number(configured)<1024||Number(configured)>65535)throw Error('端口无效，请将 PORT.txt 设置为1024到65535之间的整数。');
 const port=Number(configured),url='http://127.0.0.1:'+port;
 try{fs.mkdirSync(lock);owns=true}catch(e){if(e.code==='EEXIST')throw Error('检测到已有启动器或异常退出遗留锁。请先使用/关闭已有窗口；确认本程序全部停止后，才删除 '+lock+' 再启动。');throw e}
 fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
 bridge=createBridge({home,port});await bridge.listen();
 console.log('项目接入版已启动：'+url+'\n数据目录：'+home+'\n本次不会自动启动任何 AI。关联项目并点击“确认并开始只读分析”后才运行。\n停止：请在此窗口按 Ctrl+C。');
 if(process.platform==='win32'){const browser=cp.spawn('cmd.exe',['/d','/c','start','',url],{windowsHide:true,stdio:'ignore'});browser.on('error',()=>console.log('请手动打开上面的本地地址。'))}
 }catch(e){console.error('启动失败：'+(e.code==='EADDRINUSE'?'端口已被其他程序占用。请保留该程序，修改本看板 PORT.txt 后重试。':e.message));await stop(1)}})();
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
