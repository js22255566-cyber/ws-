/* eslint-disable no-console -- CLI integration test output. */
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
let patched = false;
try {
  await wait(
    `!!window.ferdium?.stores?.settings.loaded`,
    'app settings loaded',
  );
  assert.equal(
    await evaluate('window.ferdium.stores.services.all.some(s=>s.isEnabled)'),
    false,
    'Use a local profile without enabled real accounts',
  );
  before = await evaluate(
    '({automaticUpdates:window.ferdium.stores.settings.app.automaticUpdates,beta:window.ferdium.stores.settings.app.beta})',
  );
  await evaluate(
    `window.ferdium.stores.settings._update({type:'app',data:{automaticUpdates:false,beta:false}})`,
  );
  await vm(
    `globalThis.__zlUpdateOriginalFetch=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').net.fetch;globalThis.__zlUpdateOriginalOpen=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').shell.openExternal;globalThis.__zlUpdateFixture={status:200,version:'7.2.6',calls:[],opened:''};process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').net.fetch=async function(url,options){if(String(url).startsWith('https://api.github.com/repos/zhenglin1885-arch/ZL-WA/releases')){globalThis.__zlUpdateFixture.calls.push(String(url));if(globalThis.__zlUpdateFixture.status!==200)return new Response('{}',{status:globalThis.__zlUpdateFixture.status});const v=globalThis.__zlUpdateFixture.version;return new Response(JSON.stringify(String(url).includes('/tags/')?{body:'ZL-WA 本地模拟更新说明'}:[{tag_name:'v'+v,draft:false,prerelease:false,assets:[{name:'ZL-WA-win-AutoSetup-'+v+'-x64.exe',size:100}]}]));}return globalThis.__zlUpdateOriginalFetch.call(this,url,options);};process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').shell.openExternal=async url=>{globalThis.__zlUpdateFixture.opened=url;};true`,
  );
  patched = true;
  await evaluate(
    `require('@electron/remote').getCurrentWindow().setSize(1280,900);window.ferdium.stores.router.push('/settings/app')`,
  );
  await wait('!!document.querySelector("#updates")', 'settings tabs');
  await click('#updates');
  await wait(
    '!!document.querySelector(".zl-updates")',
    'our GitHub update panel',
  );
  const panelText = await evaluate(
    'document.querySelector(".zl-updates").textContent',
  );
  assert(panelText.includes('7.2.5'));
  assert.equal(
    await evaluate('document.querySelector(".zl-updates a").href'),
    'https://github.com/zhenglin1885-arch/ZL-WA/releases',
  );
  await clickText('检查更新');
  await wait(
    `document.querySelector('.zl-updates [role=status]')?.textContent.includes('发现新版本 7.2.6')`,
    'manual check works with automatic updates off',
  );
  await wait(
    `window.ferdium.stores.app.updateStatus==='AVAILABLE'`,
    'new version reaches global app state',
  );
  const bannerText = await evaluate(`document.body.textContent`);
  assert(bannerText.includes('发现 ZL-WA 新版本'));
  await clickText('前往 GitHub 下载 7.2.6');
  assert.equal(
    await vm(`globalThis.__zlUpdateFixture.opened`),
    'https://github.com/zhenglin1885-arch/ZL-WA/releases/tag/v7.2.6',
  );
  await evaluate(
    `document.querySelector('.info-bar__cta').closest('.info-bar').querySelector('.info-bar__close').click()`,
  );
  await wait(
    `!document.body.textContent.includes('发现 ZL-WA 新版本')`,
    'dismiss current version notification',
  );
  await vm("globalThis.__zlUpdateFixture.version='7.2.7';true");
  await clickText('检查更新');
  await wait(
    `document.body.textContent.includes('发现 ZL-WA 新版本 7.2.7')`,
    'a newer version prompts again after dismissal',
  );
  await clickText('查看更新说明');
  await wait(
    `document.body.textContent.includes('ZL-WA 本地模拟更新说明')`,
    'release notes use our main-process authenticated feed',
  );
  const requests = await vm(`globalThis.__zlUpdateFixture.calls`);
  assert(requests.some(url => url.endsWith('/tags/v7.2.7')));
  await evaluate(`window.ferdium.stores.router.push('/settings/app')`);
  await wait('!!document.querySelector("#updates")', 'return to settings');
  await click('#updates');
  await vm('globalThis.__zlUpdateFixture.status=404;true');
  await clickText('检查更新');
  await wait(
    `document.querySelector('.zl-updates [role=status]')?.textContent.includes('无法访问')`,
    'private repository error shown',
  );
  const errorText = await evaluate(
    `document.querySelector('.zl-updates [role=status]').textContent`,
  );
  assert(!errorText.includes('已是当前'));
  assert.equal(
    await evaluate(`window.ferdium.stores.app.updateStatus`),
    'FAILED',
  );
  await vm(
    `globalThis.__zlUpdateFixture.status=200;globalThis.__zlUpdateFixture.version='7.2.5';true`,
  );
  await clickText('检查更新');
  await wait(
    `document.querySelector('.zl-updates [role=status]')?.textContent.includes('已是当前')`,
    'retry recovers from error',
  );
  assert.equal(
    await evaluate(`window.ferdium.stores.app.updateStatus`),
    'NOT_AVAILABLE',
  );
  await click('.zl-updates summary');
  assert.equal(
    await evaluate(`document.querySelector('#github-update-token').type`),
    'password',
  );
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(
    '/workspace/ZL-WA-7.2.5-updates.png',
    Buffer.from(shot.data, 'base64'),
  );
  console.log(
    'PASS version 7.2.5, own GitHub feed, manual checks with auto off, update banner, version download link, private-repo error and successful retry, masked token input',
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (patched)
    try {
      await vm(
        `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').net.fetch=globalThis.__zlUpdateOriginalFetch;process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').shell.openExternal=globalThis.__zlUpdateOriginalOpen;delete globalThis.__zlUpdateOriginalFetch;delete globalThis.__zlUpdateOriginalOpen;delete globalThis.__zlUpdateFixture;true`,
      );
    } catch {
      /* app may have closed */
    }
  if (before)
    try {
      await evaluate(
        `window.ferdium.stores.settings._update({type:'app',data:${JSON.stringify(before)}});window.ferdium.stores.router.push('/')`,
      );
    } catch {
      /* app may have closed */
    }
  socket.close();
}
