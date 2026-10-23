/* eslint-disable no-console -- Standalone Electron UI regression. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import {
  evaluate,
  wait,
  click,
  clickText,
  call,
  socket,
} from './account-tools-cdp.mjs';

const vm = code =>
  evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(code)})`,
  );
let before;
let installed = false;
try {
  await wait('!!window.ferdium?.stores?.settings.loaded', 'settings loaded');
  assert.equal(
    await evaluate('window.ferdium.stores.services.all.some(s=>s.isEnabled)'),
    false,
  );
  assert.equal(
    await evaluate('window.ferdium.stores.settings.app.sentry'),
    false,
    'telemetry defaults off after upgrade',
  );
  before = await evaluate(
    '({automaticUpdates:window.ferdium.stores.settings.app.automaticUpdates,beta:window.ferdium.stores.settings.app.beta})',
  );
  await evaluate(
    `window.ferdium.stores.settings._update({type:'app',data:{automaticUpdates:false,beta:false}})`,
  );
  const windowId = await evaluate(
    `require('@electron/remote').getCurrentWindow().id`,
  );
  await vm(`(()=>{
    const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');
    const {ipcMain,BrowserWindow}=require('electron');
    const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'zl-update-ui-'));
    const channels=['state','check','download','install','notes'].map(c=>'zl-updates-'+c);
    const handlers=new Map(channels.map(c=>[c,ipcMain._invokeHandlers.get(c)]));
    const target=BrowserWindow.fromId(${windowId});
    const bytes=Buffer.from('MZ local synthetic installer');
    const digest='sha256:'+require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    const fixture={version:'99.0.1',status:200,corrupt:true,calls:[],launched:'',root,channels,handlers};
    const GitHubUpdates=require('./build/electron/GitHubUpdates').default;
    const updater=new GitHubUpdates({version:require('./package.json').version,directory:root,supported:true,
      launch:async file=>{fixture.launched=file;},
      notify:state=>target.webContents.send('autoUpdate',state),
      fetch:async(url,options)=>{
        fixture.calls.push({url,headers:options.headers});
        if(url.startsWith('https://api.github.com/')){
          if(fixture.status!==200)return new Response('{}',{status:fixture.status});
          return new Response(JSON.stringify(url.includes('/tags/')?{body:'ZL-WA 在线更新说明'}:[{tag_name:'v'+fixture.version,draft:false,prerelease:false,assets:[{name:'ZL-WA-win-AutoSetup-'+fixture.version+'-x64.exe',size:bytes.length,digest}]}]));
        }
        if(!url.startsWith('https://github.com/zhenglin1885-arch/ZL-WA/releases/download/'))throw Error('Unexpected download');
        return new Response(fixture.corrupt?Buffer.alloc(bytes.length):bytes);
      }});
    fixture.updater=updater;
    for(const channel of channels){
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel,(event,arg)=>{
        if(event.sender!==target.webContents||event.senderFrame!==target.webContents.mainFrame)throw Error('Forbidden');
        if(channel.endsWith('-state'))return updater.state;
        if(channel.endsWith('-check'))return updater.check(false);
        if(channel.endsWith('-download'))return updater.download();
        if(channel.endsWith('-install'))return updater.install();
        return updater.notes(arg);
      });
    }
    globalThis.__zlUpdatesUI=fixture;
    return true;
  })()`);
  installed = true;
  await evaluate(`window.ferdium.stores.router.push('/settings/app')`);
  await wait('!!document.querySelector("#updates")', 'settings tabs');
  await click('#updates');
  await wait('!!document.querySelector(".zl-updates")', 'online updates panel');
  assert.equal(
    await evaluate(
      `document.querySelector('.zl-updates').textContent.includes('Token')`,
    ),
    false,
  );
  assert.equal(
    await evaluate(
      `!!document.querySelector('#github-update-token,.zl-updates details')`,
    ),
    false,
  );
  await clickText('检查在线更新');
  await wait(
    `document.querySelector('.zl-updates [role=status]').textContent.includes('发现新版本 99.0.1')`,
    'public installer detected',
  );
  await clickText('下载安装更新 99.0.1');
  await wait(
    `document.querySelector('.zl-updates [role=status]').textContent.includes('校验失败')`,
    'corrupt update rejected',
  );
  assert.equal(await vm('globalThis.__zlUpdatesUI.launched'), '');
  await vm('globalThis.__zlUpdatesUI.corrupt=false;true');
  await clickText('下载安装更新 99.0.1');
  await wait(
    `document.querySelector('.zl-updates [role=status]').textContent.includes('下载并校验完成')`,
    'verified installer ready',
  );
  assert.equal(await vm('globalThis.__zlUpdatesUI.launched'), '');
  assert.equal(
    await evaluate('window.ferdium.stores.app.updateStatus'),
    'DOWNLOADED',
  );
  await evaluate(
    `[...document.querySelectorAll('.zl-updates button')].find(b=>b.textContent==='退出并安装').click()`,
  );
  await wait(
    `(async()=>!!require('@electron/remote').require('node:vm').runInThisContext('globalThis.__zlUpdatesUI.launched'))()`,
    'explicit install launches verified package',
  );
  const launched = await vm('globalThis.__zlUpdatesUI.launched');
  assert(launched.endsWith('ZL-WA-win-AutoSetup-99.0.1-x64.exe'));
  const requests = await vm('globalThis.__zlUpdatesUI.calls');
  assert(
    requests.every(r => !r.headers?.Authorization),
    'public updates never send credentials',
  );
  await vm('globalThis.__zlUpdatesUI.status=404;true');
  await clickText('检查在线更新');
  await wait(
    `document.querySelector('.zl-updates [role=status]').textContent.includes('未找到发布包')`,
    'server error not reported as latest',
  );
  await vm(
    `globalThis.__zlUpdatesUI.status=200;globalThis.__zlUpdatesUI.version='1.0.0';true`,
  );
  await clickText('检查在线更新');
  await wait(
    `document.querySelector('.zl-updates [role=status]').textContent.includes('已是当前')`,
    'retry recovers',
  );
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(
    '/workspace/ZL-WA-online-updates.png',
    Buffer.from(shot.data, 'base64'),
  );
  console.log(
    'PASS public online update UI: token section removed, telemetry off, real installer download/hash verification, corrupt rejection, retry, explicit install and global ready status; synthetic installer only',
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (installed)
    await vm(
      `(()=>{const f=globalThis.__zlUpdatesUI;const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');const {ipcMain}=require('electron');for(const c of f.channels){ipcMain.removeHandler(c);const h=f.handlers.get(c);if(h)ipcMain.handle(c,h);}require('node:fs').rmSync(f.root,{recursive:true,force:true});delete globalThis.__zlUpdatesUI;return true;})()`,
    ).catch(() => {});
  if (before)
    await evaluate(
      `window.ferdium.stores.settings._update({type:'app',data:${JSON.stringify(before)}});window.ferdium.stores.app._resetUpdateStatus();window.ferdium.stores.router.push('/')`,
    ).catch(() => {});
  socket.close();
}
