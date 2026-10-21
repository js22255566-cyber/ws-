/* eslint-disable no-await-in-loop -- Sequential UI actions and assertions depend on each other. */
/* eslint-disable no-console -- Command-line GUI regression output. */
// Linux cloud GUI integration test. Use a local profile without enabled real accounts.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import {
  evaluate,
  wait,
  click,
  clickText,
  call,
  socket,
} from './account-tools-cdp.mjs';

const fixture = readFileSync(
  new URL('fixtures/whatsapp-tools.html', import.meta.url),
  'utf8',
);
const tlsDirectory = mkdtempSync('/tmp/zl-tools-tls-');
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    `${tlsDirectory}/key.pem`,
    '-out',
    `${tlsDirectory}/cert.pem`,
    '-days',
    '1',
    '-subj',
    '/CN=web.whatsapp.com',
  ],
  { stdio: 'ignore' },
);
const ids = [];
let mainPatched = false;
let sidebarBefore;
let bulkPreferencesBefore;
const vm = async code =>
  evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(code)})`,
  );
const service = id =>
  `window.ferdium.stores.services.one(${JSON.stringify(id)})`;
const guest = (id, code) =>
  evaluate(`${service(id)}.webview.executeJavaScript(${JSON.stringify(code)})`);
const shot = async path => {
  await new Promise(r => {
    setTimeout(r, 350);
  });
  const r = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(r.data, 'base64'));
};
try {
  await wait(
    `!!window.ferdium?.stores?.services && !!document.querySelector('.account-tools')`,
    'app ready',
  );
  await evaluate(
    `require('@electron/remote').getCurrentWindow().webContents.closeDevTools();require('@electron/remote').getCurrentWindow().setSize(1280,800);window.ferdium.stores.router.push('/')`,
  );
  await wait(
    `window.ferdium.stores.services.allServicesRequest.wasExecuted && !window.ferdium.stores.services.allServicesRequest.isWaitingForResponse && window.ferdium.stores.settings.loaded`,
    'initial service list fully loaded',
  );
  assert.equal(
    await evaluate('window.ferdium.stores.services.all.some(s=>s.isEnabled)'),
    false,
    'Use an isolated test profile with no enabled real accounts',
  );
  sidebarBefore = await evaluate(
    'JSON.parse(JSON.stringify(window.ferdium.stores.settings.app.accountSidebar || {}))',
  );
  if (await evaluate('!!document.querySelector(".account-dialog")'))
    await clickText('取消');
  bulkPreferencesBefore = await evaluate(
    `require('electron').ipcRenderer.invoke('account-tools-bulk-preferences')`,
  );
  await evaluate(
    `require('electron').ipcRenderer.invoke('account-tools-bulk-preferences',{})`,
  );
  const before = await evaluate(
    'window.ferdium.stores.services.all.map(s=>s.id)',
  );
  await vm(
    `globalThis.__zlSessionPrototype = Object.getPrototypeOf(process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').session.defaultSession);globalThis.__zlToolsFetch=globalThis.__zlSessionPrototype.fetch;globalThis.__zlSessionPrototype.fetch=async function(url,options){if(String(url).startsWith('https://translate.googleapis.com/')){globalThis.__zlTranslationCalls=(globalThis.__zlTranslationCalls||0)+1;if(globalThis.__zlTranslateFail) throw Error('synthetic translation failure');await new Promise(r=>setTimeout(r,350));return new Response(JSON.stringify([[[new URLSearchParams(options.body).get('tl')==='zh-CN'?'你好，这是本地测试消息。':new URLSearchParams(options.body).get('q')==='你好🐭'?'Hello 🐭':'Hello translated']]]),{status:200,headers:{'Content-Type':'application/json'}})}return globalThis.__zlToolsFetch.call(this,url,options)};true`,
  );
  mainPatched = true;
  for (let i = 0; i < 2; i += 1) {
    const old = [...before, ...ids];
    await click('[data-group-id="default"] .account-group__add');
    await wait(
      `window.ferdium.stores.services.createServiceRequest.wasExecuted && !window.ferdium.stores.services.createServiceRequest.isWaitingForResponse && !!window.ferdium.stores.services.createServiceRequest.result?.data?.id && !${JSON.stringify(old)}.includes(window.ferdium.stores.services.createServiceRequest.result.data.id)`,
      'new service creation request completed',
    );
    const id = await evaluate(
      'window.ferdium.stores.services.createServiceRequest.result.data.id',
    );
    assert(
      !old.includes(id),
      'Cleanup may only target the service ID returned by this creation request',
    );
    ids.push(id);
    await wait(
      `window.ferdium.stores.services.all.some(s=>s.id===${JSON.stringify(id)})`,
      'new service model inserted',
    );
    await vm(
      `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').session.fromPartition('persist:service-${id}').protocol.handle('https',request=>new Response(${JSON.stringify(fixture)},{headers:{'Content-Type':'text/html; charset=utf-8'}}));true`,
    );
    await wait(`!!${service(id)}.webview`, 'test account mounted');
    await evaluate(`${service(id)}.webview.reload()`);
    await wait(
      `!${service(id)}.isLoading && ${service(id)}.accountSnapshot.status==='online'`,
      'fixture online',
    );
  }
  const [first, second] = ids;
  await click(`[data-service-id="${first}"] .account-card__select`);
  // Use native mouse/keyboard input and screen coordinates: DOM-only clicks
  // cannot catch a focus sentinel pushing the whole dialog off-screen.
  const typeInVisibleDialog = async text => {
    await wait(
      '!!document.querySelector(".account-dialog input")',
      'dialog input',
    );
    await wait(
      `getComputedStyle(document.querySelector('.account-dialog .MuiDialog-container')).opacity === '1'`,
      'dialog opening transition completed',
    );
    const rect = await evaluate(
      `(()=>{const n=document.querySelector('.account-dialog input');const r=n.getBoundingClientRect();if(r.top<0||r.bottom>innerHeight||r.width<50||r.height<15)throw Error('Dialog input is offscreen');const at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(at!==n)throw Error('Dialog input is covered');return r.toJSON()})()`,
    );
    await call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      button: 'left',
      clickCount: 1,
    });
    await call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      button: 'left',
      clickCount: 1,
    });
    await wait(
      `document.activeElement === document.querySelector('.account-dialog input')`,
      'native click focused dialog input',
    );
    await call('Input.insertText', { text });
    assert.equal(await evaluate('document.activeElement.value'), text);
  };
  await click('.account-sidebar__new-group');
  await typeInVisibleDialog('GUI测试分组');
  await clickText('保存');
  await wait(
    '!document.querySelector(".account-dialog") && [...document.querySelectorAll(".account-group")].some(n=>n.textContent.includes("GUI测试分组"))',
    'new group saved',
  );
  await click(`[data-service-id="${first}"] .account-card__remark`);
  await typeInVisibleDialog('GUI测试备注');
  await clickText('保存');
  await wait(
    `!document.querySelector('.account-dialog') && document.querySelector('[data-service-id="${first}"] .account-card__remark').textContent.includes('GUI测试备注')`,
    'remark saved',
  );
  await shot('/workspace/ZL-WA-dialog-regression.png');
  console.log(
    'PASS visible group/remark dialogs accept native mouse and text input and persist changes',
  );
  await clickText('译翻译');
  await wait(
    `!!document.querySelector('.account-tools-panel fieldset')`,
    'translation panel',
  );
  for (const engine of ['OpenAI', 'Gemini']) {
    await evaluate(
      `(()=>{const select=document.querySelector('#zl-AccountTools-10');select.value=${JSON.stringify(engine)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`,
    );
    await wait(
      `document.querySelector('#provider-key-${engine}')?.closest('details')?.open`,
      'provider configuration expands when selected',
    );
    assert.equal(
      await evaluate(`document.querySelector('#provider-key-${engine}').type`),
      'password',
    );
    assert(
      await evaluate(`!!document.querySelector('#provider-model-${engine}')`),
      'provider model is configurable',
    );
    await clickText('应用并测试发送翻译');
    await wait(
      `document.querySelector('.tools-notice')?.textContent.includes(${JSON.stringify(`${engine} 需要填写 API Key`)})`,
      'provider requires user key',
    );
  }
  await evaluate(
    `(()=>{const select=document.querySelector('#zl-AccountTools-10');select.value='Google';select.dispatchEvent(new Event('change',{bubbles:true}))})()`,
  );
  await clickText('应用');
  await wait(
    `document.querySelector('.tools-notice')?.textContent.includes('已应用')`,
    'restore Google mock',
  );
  console.log(
    'PASS OpenAI/Gemini expose password and model fields and require the user API Key',
  );
  const switchTranslation = async label => {
    await evaluate(
      `(()=>{const label=[...document.querySelectorAll('.account-tools-panel label')].find(n=>n.textContent.includes(${JSON.stringify(label)}));label.querySelector('input[role="switch"]').click()})()`,
    );
    await wait(
      `!document.querySelector('.account-tools-panel fieldset').disabled && document.querySelector('.tools-notice')?.textContent.includes('已应用')`,
      'translation switch applied',
    );
  };
  await switchTranslation('接收翻译（收发消息）');
  await wait(
    `${service(first)}.webview.executeJavaScript('document.querySelectorAll("[data-zl-translate]").length').then(n=>n===2)`,
    'manual buttons on incoming and sent bubbles',
  );
  assert.equal(
    await vm('globalThis.__zlTranslationCalls || 0'),
    0,
    'manual mode must not translate automatically',
  );
  for (const bubble of ['.message-in', '.message-out']) {
    await guest(
      first,
      `document.querySelector('${bubble} [data-zl-translate]').click();true`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('document.querySelector("${bubble} [data-zl-translation-text]").textContent').then(t=>t.includes('你好'))`,
      'manual bubble translation',
    );
  }
  assert.equal(
    await guest(first, 'fixture.sent.length'),
    0,
    'translating sent bubbles never resends them',
  );
  await vm('globalThis.__zlTranslateFail=true;true');
  await guest(
    first,
    `document.querySelector('#messages').insertAdjacentHTML('beforeend','<div class="message-in" id="manual-retry"><div class="copyable-text"><span class="selectable-text">A unique retry test ${Date.now()}.</span></div></div>');true`,
  );
  await wait(
    `${service(first)}.webview.executeJavaScript('!!document.querySelector("#manual-retry [data-zl-translate]")')`,
    'retry bubble button',
  );
  await guest(
    first,
    `document.querySelector('#manual-retry [data-zl-translate]').click();true`,
  );
  await wait(
    `${service(first)}.webview.executeJavaScript('document.querySelector("#manual-retry [data-zl-translation-text]").textContent').then(t=>t.includes('重试'))`,
    'manual failure',
  );
  await vm('globalThis.__zlTranslateFail=false;true');
  await guest(
    first,
    `document.querySelector('#manual-retry [data-zl-translate]').click();true`,
  );
  await wait(
    `${service(first)}.webview.executeJavaScript('document.querySelector("#manual-retry [data-zl-translation-text]").textContent').then(t=>t.includes('你好'))`,
    'manual retry succeeds',
  );
  console.log(
    'PASS receive toggle adds manual translate to incoming and sent messages, no automatic requests, retry works without resending',
  );
  await vm('globalThis.__zlTranslateFail=true;true');
  await guest(
    first,
    `document.querySelector('#messages').insertAdjacentHTML('beforeend','<div class="message-in" id="preview-fresh"><div class="copyable-text"><span class="selectable-text">Deferred preview ${Date.now()}.</span></div></div>');true`,
  );
  const beforePreview = await vm('globalThis.__zlTranslationCalls');
  await switchTranslation('翻译预览');
  await new Promise(resolve => {
    setTimeout(resolve, 1000);
  });
  assert.equal(
    await vm('globalThis.__zlTranslationCalls'),
    beforePreview,
    'enabling preview does not bulk translate the current chat',
  );
  await guest(
    first,
    `document.querySelector('header span').dataset.id='preview-next-chat';true`,
  );
  await wait(
    `${service(first)}.webview.executeJavaScript('document.querySelector("#preview-fresh [data-zl-translation-text]")?.textContent.includes("重试")')`,
    'newly opened chat preview failure',
  );
  const failedCalls = await vm('globalThis.__zlTranslationCalls');
  await new Promise(resolve => {
    setTimeout(resolve, 900);
  });
  assert.equal(
    await vm('globalThis.__zlTranslationCalls'),
    failedCalls,
    'failed preview must not hammer provider',
  );
  await vm('globalThis.__zlTranslateFail=false;true');
  await guest(
    first,
    `document.querySelector('#preview-fresh [data-zl-translate]').click();true`,
  );
  await wait(
    `${service(first)}.webview.executeJavaScript('document.querySelector("#preview-fresh [data-zl-translation-text]").textContent.includes("你好")')`,
    'preview fallback manual retry',
  );
  await guest(first, `document.querySelector('#preview-fresh').remove();true`);
  await switchTranslation('翻译预览');
  await switchTranslation('翻译预览');
  await guest(
    first,
    `document.querySelector('header span').dataset.id='preview-next-again';true`,
  );
  await wait(
    `${service(first)}.webview.executeJavaScript('[...document.querySelectorAll("[data-zl-translation-text]")].every(n=>n.textContent.includes("你好"))')`,
    'cached previews restore both directions',
  );
  await shot('/workspace/ZL-WA-message-preview.png');
  await switchTranslation('接收翻译（收发消息）');
  await wait(
    `${service(first)}.webview.executeJavaScript('document.querySelectorAll("[data-zl-translation]").length').then(n=>n===0)`,
    'disable removes message controls',
  );
  console.log(
    'PASS preview auto translates incoming/sent messages, errors retain manual controls, disabled feature removes all controls',
  );
  for (const label of ['发送自动翻译', '接收翻译（收发消息）', '翻译预览']) {
    const checked = await evaluate(
      `(()=>{const n=[...document.querySelectorAll('.account-tools-panel label')].find(n=>n.textContent.includes(${JSON.stringify(label)}));return n.querySelector('input[role="switch"]').checked})()`,
    );
    if (!checked) await switchTranslation(label);
  }
  await clickText('应用');
  await wait(
    `document.querySelector('.tools-notice')?.textContent.includes('已应用')`,
    'translation saved',
  );
  await wait(`!!${service(first)}.webview`, 'webview after save');
  await wait(`!${service(first)}.isLoading`, 'loaded');
  await new Promise(r => {
    setTimeout(r, 900);
  });
  assert(
    await guest(first, `!!document.querySelector('[data-zl-translation]')`),
    'incoming translation appears below bubble',
  );
  assert.equal(
    await guest(second, `!!document.querySelector('[data-zl-translation]')`),
    false,
    'other account incoming translation is off',
  );
  await guest(
    first,
    `(()=>{const state=window.__zlTranslation;const text=document.querySelector('.selectable-text');const record=state.incoming.get(text);record.status='pending';record.button.disabled=true;state.pending.set(999999,{direction:'incoming',record});window.__zlPendingRecord=record;return true})()`,
  );
  await switchTranslation('发送自动翻译');
  await wait(
    `${service(first)}.webview.executeJavaScript('!window.__zlPendingRecord.button.disabled && window.__zlTranslation.pending.size===0')`,
    'configuration changes release canceled preview buttons',
  );
  await switchTranslation('发送自动翻译');
  // Large history: only the viewport is decorated/translated, and plugin reflow
  // preserves WhatsApp's bottom or the user's history anchor.
  const originalMessages = await guest(
    first,
    `(()=>{const c=document.querySelector('#messages').cloneNode(true);c.querySelectorAll('[data-zl-translation]').forEach(n=>n.remove());return c.innerHTML})()`,
  );
  const originalMessagesStyle = await guest(
    first,
    `document.querySelector('#messages').style.cssText`,
  );
  const previewCallsBefore = await vm('globalThis.__zlTranslationCalls');
  await guest(
    first,
    `(()=>{const list=document.querySelector('#messages');list.style.cssText='height:260px;flex:none;overflow-y:auto';list.innerHTML=Array.from({length:90},(_,i)=>'<div class="message-in" data-id="perf-'+i+'" style="min-height:32px"><div class="copyable-text"><span class="selectable-text">Viewport preview ${Date.now()} '+i+'</span></div></div>').join('');list.scrollTop=list.scrollHeight;document.querySelector('header span').dataset.id='performance-chat';return true})()`,
  );
  await wait(
    `${service(first)}.webview.executeJavaScript('document.querySelectorAll("#messages [data-zl-translation-text]").length>=2')`,
    'visible history preview',
  );
  await new Promise(resolve => {
    setTimeout(resolve, 1800);
  });
  assert(
    (await vm('globalThis.__zlTranslationCalls')) - previewCallsBefore < 20,
    '90 loaded history messages must not cause 90 translations',
  );
  assert(
    await guest(
      first,
      `(()=>{const list=document.querySelector('#messages');return list.scrollHeight-list.clientHeight-list.scrollTop<3})()`,
    ),
    'translation insertion keeps an already pinned chat at its native bottom',
  );
  const anchor = await guest(
    first,
    `(()=>{const list=document.querySelector('#messages');list.scrollTop=300;const top=list.getBoundingClientRect().top;const row=[...list.children].find(n=>n.getBoundingClientRect().bottom>top+1);return {id:row.dataset.id,top:row.getBoundingClientRect().top}})()`,
  );
  await new Promise(resolve => {
    setTimeout(resolve, 1800);
  });
  const anchorAfter = await guest(
    first,
    `document.querySelector('[data-id="${anchor.id}"]').getBoundingClientRect().top`,
  );
  assert(
    Math.abs(anchorAfter - anchor.top) < 3,
    'translating history never jumps the user to the bottom',
  );
  await wait(
    `${service(first)}.webview.executeJavaScript('window.__zlTranslation.pending.size===0')`,
    'visible preview queue drained',
  );
  const cachedCalls = await vm('globalThis.__zlTranslationCalls');
  await guest(
    first,
    `(()=>{const list=document.querySelector('#messages');list.innerHTML='<div class="message-in"><div class="copyable-text"><span class="selectable-text">Hello, this is a local test message.</span></div></div>';document.querySelector('header span').dataset.id='cached-return-chat';return true})()`,
  );
  await wait(
    `${service(first)}.webview.executeJavaScript('document.querySelector("#messages [data-zl-translation-text]")?.textContent.includes("你好")')`,
    'cached translation restores after DOM remount',
  );
  assert.equal(
    await vm('globalThis.__zlTranslationCalls'),
    cachedCalls,
    'returning to translated text must not invoke the provider again',
  );
  await guest(
    first,
    `document.querySelector('#messages').innerHTML=${JSON.stringify(originalMessages)};document.querySelector('#messages').style.cssText=${JSON.stringify(originalMessagesStyle)};document.querySelector('header span').dataset.id='test-chat';true`,
  );
  console.log(
    'PASS deferred preview, visible-only work, cached DOM remount, pinned-bottom reflow and history-anchor preservation',
  );
  await guest(
    first,
    `(()=>{let i=0;for(const row of document.querySelector('#messages').children){const original=row.querySelector('.selectable-text')?.textContent;if(!original)continue;row.className='';row.dataset.id='opaque-message-'+(++i);row.replaceChildren();const body=document.createElement('div');body.dataset.prePlainText='synthetic';const text=document.createElement('span');text.dir='auto';text.textContent=original;body.append(text);row.append(body)}return true})()`,
  );
  await wait(
    `${service(first)}.webview.executeJavaScript('document.querySelectorAll("[data-zl-translate]").length').then(n=>n===3)`,
    'semantic message markers without old classes',
  );
  await wait(
    `${service(first)}.webview.executeJavaScript('[...document.querySelectorAll("[data-zl-translation-text]")].every(n=>n.textContent.includes("你好"))')`,
    'semantic preview text',
  );
  assert.equal(
    await guest(
      first,
      'document.querySelectorAll("#messages .message-in, #messages .message-out, #messages .selectable-text, #messages .copyable-text").length',
    ),
    0,
  );
  console.log(
    'PASS message recognition works without message-in/out, copyable/selectable classes or true_/false_ IDs',
  );
  await clickText('检查页面识别');
  await wait(
    `document.querySelector('.tools-notice')?.textContent.includes('已识别 3 条')`,
    'visible page recognition status',
  );
  await clickText('复制页面诊断');
  const report = await evaluate(`require('electron').clipboard.readText()`);
  assert.equal(JSON.parse(report).version, 7);
  assert.equal(JSON.parse(report).counts['[data-zl-translate]'], 3);
  assert(
    !report.includes('8613800000001') &&
      !report.includes('你好') &&
      !report.includes('test-chat'),
    'diagnostics must omit content and attribute values',
  );
  const callsBeforeEmoji = await vm('globalThis.__zlTranslationCalls');
  for (const value of [
    '🐭',
    '👩🏽‍💻',
    '🇨🇳',
    '1️⃣',
    '123',
    '?!',
    'https://example.test/path',
  ]) {
    await guest(
      first,
      `document.querySelector('[contenteditable]').textContent=${JSON.stringify(value)};document.querySelector('footer button').click();true`,
    );
    assert.equal(
      await guest(first, 'fixture.sent.at(-1)'),
      value,
      'non-translatable content sends on first click unchanged',
    );
  }
  await guest(
    first,
    `document.querySelector('[contenteditable]').innerHTML='<p><span contenteditable="false"><img alt="🐭"></span></p>';document.querySelector('footer button').click();true`,
  );
  assert.equal(
    await guest(first, 'fixture.sent.at(-1)'),
    '🐭',
    'decorator image emoji sends once without duplication',
  );
  await new Promise(resolve => {
    setTimeout(resolve, 600);
  });
  assert.equal(
    await vm('globalThis.__zlTranslationCalls'),
    callsBeforeEmoji,
    'emoji/numeric/link sends never call translation',
  );
  await guest(first, 'fixture.sent=[];true');
  console.log(
    'PASS Unicode emoji, ZWJ/flags/keycaps, decorator IMG emoji, numbers and URLs bypass translation unchanged',
  );
  await guest(
    first,
    `document.querySelector('[contenteditable]').innerHTML='<p>你好<span contenteditable="false"><img alt="🐭"></span></p>';document.querySelector('footer button').click();true`,
  );
  await wait(
    `${service(first)}.webview.executeJavaScript('fixture.editorText()').then(t=>t==='Hello 🐭')`,
    'mixed emoji native replacement',
  );
  assert.equal(await guest(first, 'fixture.sent.length'), 0);
  await guest(first, `document.querySelector('footer button').click();true`);
  assert.deepEqual(await guest(first, 'fixture.sent'), ['Hello 🐭']);
  await guest(first, 'fixture.sent=[];true');
  console.log(
    'PASS native select-all replaces text plus noneditable emoji decorator exactly once before confirmed send',
  );
  await guest(
    first,
    `document.querySelector('[contenteditable]').innerText='你好';document.querySelector('footer button').click();true`,
  );
  assert.equal(
    await guest(first, 'fixture.sent.length'),
    0,
    'first click must never send original',
  );
  await new Promise(r => {
    setTimeout(r, 1000);
  });
  assert.equal(
    await guest(first, `document.querySelector('[contenteditable]').innerText`),
    'Hello translated',
  );
  assert.equal(
    await guest(first, 'fixture.sent.length'),
    0,
    'translated preview must remain unsent',
  );
  assert(
    (await guest(first, 'fixture.nativeInputs')) > 0,
    'replacement must use trusted native editor input when execCommand fails',
  );
  await shot('/workspace/ZL-WA-translation.png');
  await guest(
    first,
    `document.querySelector('[contenteditable]').innerText='Hello corrected';document.querySelector('footer button').click();true`,
  );
  assert.deepEqual(await guest(first, 'fixture.sent'), ['Hello corrected']);
  console.log(
    'PASS received translation, per-account isolation, first-click preview and second-click corrected send',
  );
  await vm(`globalThis.__zlTranslateFail=true;true`);
  await guest(
    first,
    `document.querySelector('[contenteditable]').innerText='失败测试';document.querySelector('footer button').click();true`,
  );
  await new Promise(r => {
    setTimeout(r, 1000);
  });
  assert.equal(
    await guest(first, `document.querySelector('[contenteditable]').innerText`),
    '失败测试',
  );
  assert.equal(await guest(first, 'fixture.sent.length'), 1);
  assert.match(
    await guest(
      first,
      `document.querySelector('#zl-translation-status').textContent`,
    ),
    /失败/,
  );
  await vm(`globalThis.__zlTranslateFail=false;true`);
  // Edit while translation is pending: stale result must never replace it.
  await guest(
    first,
    `document.querySelector('[contenteditable]').innerText='等待翻译';document.querySelector('footer button').click();document.querySelector('[contenteditable]').innerText='已修改内容';true`,
  );
  await new Promise(r => {
    setTimeout(r, 1000);
  });
  assert.equal(
    await guest(first, `document.querySelector('[contenteditable]').innerText`),
    '已修改内容',
  );
  assert.equal(await guest(first, 'fixture.sent.length'), 1);
  console.log(
    'PASS translation failure and stale-draft protection leave the original unsent',
  );
  // Test Enter, including repeat protection, through a real contenteditable event.
  await guest(
    first,
    `(()=>{const i=document.querySelector('[contenteditable]');i.innerText='键盘测试';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));return true})()`,
  );
  await new Promise(r => {
    setTimeout(r, 1000);
  });
  assert.equal(
    await guest(first, `document.querySelector('[contenteditable]').innerText`),
    'Hello translated',
  );
  await guest(
    first,
    `document.querySelector('[contenteditable]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true,cancelable:true}));true`,
  );
  assert.equal(await guest(first, 'fixture.sent.length'), 1);
  await guest(
    first,
    `document.querySelector('[contenteditable]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));true`,
  );
  assert.equal(await guest(first, 'fixture.sent.length'), 2);
  console.log('PASS Enter first/second send and held-key protection');
  await guest(
    first,
    `document.querySelector('[contenteditable]').innerText='切换聊天测试';document.querySelector('footer button').click();document.querySelector('header span').dataset.id='other-chat';true`,
  );
  await new Promise(r => {
    setTimeout(r, 1000);
  });
  assert.equal(
    await guest(first, `document.querySelector('[contenteditable]').innerText`),
    '切换聊天测试',
  );
  assert.equal(await guest(first, 'fixture.sent.length'), 2);
  console.log('PASS switching chats invalidates pending outgoing translation');

  await clickText('▤代理');
  await wait(
    `!!document.querySelector('.account-tools-panel fieldset')`,
    'proxy panel',
  );
  await shot('/workspace/ZL-WA-proxy.png');
  // Confirm underlying Electron Session proxy routing, without sending traffic to a real proxy.
  await evaluate(
    `(async()=>{const e=require('electron').ipcRenderer;const c=await e.invoke('account-tools-get',${JSON.stringify(first)});c.proxy={...c.proxy,enabled:true,host:'127.0.0.1',port:'47891'};await e.invoke('account-tools-save',${JSON.stringify(first)},c)})()`,
  );
  assert.match(
    await evaluate(
      `require('@electron/remote').session.fromPartition('persist:service-${first}').resolveProxy('https://web.whatsapp.com')`,
    ),
    /PROXY 127\.0\.0\.1:47891/,
  );
  await vm(
    `(async()=>{const req=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');const fs=req('node:fs');globalThis.__zlProxyConnects=0;globalThis.__zlProxyTLS=req('node:https').createServer({key:fs.readFileSync('${tlsDirectory}/key.pem'),cert:fs.readFileSync('${tlsDirectory}/cert.pem')},(_r,s)=>{s.writeHead(200);s.end()});globalThis.__zlProxyServer=req('node:http').createServer();globalThis.__zlProxyServer.on('connect',(_r,c,h)=>{globalThis.__zlProxyConnects++;const u=req('node:net').connect(47892,'127.0.0.1',()=>{c.write('HTTP/1.1 200 Connection Established\\r\\n\\r\\n');if(h.length)u.write(h);c.pipe(u);u.pipe(c)});u.on('error',()=>c.destroy());c.on('error',()=>u.destroy())});await new Promise(r=>globalThis.__zlProxyTLS.listen(47892,'127.0.0.1',r));await new Promise(r=>globalThis.__zlProxyServer.listen(47891,'127.0.0.1',r));req('electron').session.fromPartition('persist:service-${first}').setCertificateVerifyProc((_r,cb)=>cb(0));return true})()`,
  );
  const connection = await evaluate(
    `require('electron').ipcRenderer.invoke('account-tools-test-proxy',${JSON.stringify(first)})`,
  );
  assert.match(connection.route, /PROXY/);
  assert(
    (await vm(`globalThis.__zlProxyConnects`)) > 0,
    'native proxy test must really establish an HTTP CONNECT tunnel',
  );
  await vm(
    `globalThis.__zlProxyTLS.closeAllConnections();globalThis.__zlProxyTLS.close();globalThis.__zlProxyServer.closeAllConnections();globalThis.__zlProxyServer.close();true`,
  );
  console.log(
    'PASS native connection-test IPC traverses a local HTTP CONNECT proxy and TLS destination',
  );

  assert.equal(
    await evaluate(
      `require('@electron/remote').session.fromPartition('persist:service-${second}').resolveProxy('https://web.whatsapp.com')`,
    ),
    'DIRECT',
  );
  await evaluate(
    `(async()=>{const e=require('electron').ipcRenderer;const c=await e.invoke('account-tools-get',${JSON.stringify(first)});c.proxy.enabled=false;await e.invoke('account-tools-save',${JSON.stringify(first)},c)})()`,
  );
  assert.equal(
    await evaluate(
      `require('@electron/remote').session.fromPartition('persist:service-${first}').resolveProxy('https://web.whatsapp.com')`,
    ),
    'DIRECT',
  );
  console.log(
    'PASS actual Electron account Session proxy routing and disable-to-DIRECT isolation',
  );
  await clickText('☷群发');
  const checkBulkLayout = async () => {
    for (const [width, height] of [
      [1920, 1080],
      [1366, 768],
      [900, 650],
      [640, 480],
    ]) {
      await evaluate(
        `require('@electron/remote').getCurrentWindow().setSize(${width},${height})`,
      );
      await new Promise(resolve => {
        setTimeout(resolve, 150);
      });
      const layout = await evaluate(`(()=>{
        const paper=document.querySelector('.bulk-dialog > .MuiDialog-container > .MuiPaper-root');
        const content=paper.querySelector(':scope > .MuiDialogContent-root');
        const actions=paper.querySelector(':scope > .MuiDialogActions-root');
        const r=paper.getBoundingClientRect();const footer=actions.getBoundingClientRect();
        const fixture=document.createElement('div');fixture.style.height='2000px';content.append(fixture);content.scrollTop=content.scrollHeight;
        const button=actions.querySelector('button');const b=button.getBoundingClientRect();
        const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
        const result={width:innerWidth,height:innerHeight,paper:r.toJSON(),footer:footer.toJSON(),scrolls:content.scrollHeight>content.clientHeight,footerClickable:button.contains(hit),noHorizontalOverflow:content.scrollWidth<=content.clientWidth+1};
        fixture.remove();content.scrollTop=0;return result;
      })()`);
      assert(
        layout.paper.top >= 0 && layout.paper.bottom <= layout.height,
        'forwarding dialog fits vertically',
      );
      assert(
        layout.paper.left >= 0 && layout.paper.right <= layout.width,
        'forwarding dialog fits horizontally',
      );
      assert(
        layout.paper.height >= layout.height - 40,
        'forwarding dialog uses the WhatsApp page height',
      );
      assert(
        layout.paper.width >= layout.width - 40,
        'forwarding dialog covers the WhatsApp page width',
      );
      assert(
        layout.footer.bottom <= layout.height && layout.footerClickable,
        'footer stays visible and clickable above the guest',
      );
      assert(
        layout.scrolls && layout.noHorizontalOverflow,
        'body scrolls without hiding footer or overflowing horizontally',
      );
    }
    await evaluate(
      `require('@electron/remote').getCurrentWindow().setSize(1280,800)`,
    );
    await new Promise(resolve => {
      setTimeout(resolve, 150);
    });
  };
  await checkBulkLayout();
  await clickText('新建转发');
  await wait(`!!document.querySelector('.bulk-columns')`, 'centered bulk form');
  await evaluate(
    `document.querySelector('.bulk-columns fieldset input[type="checkbox"]').click()`,
  );
  await clickText('读取聊天对象');
  await wait(
    `document.querySelectorAll('.bulk-recipient-list input').length===2`,
    'real adapter fixture recipients',
  );
  await evaluate(
    `document.querySelector('.bulk-columns fieldset:nth-child(2) > label input').click();const t=document.querySelector('[aria-label="发送内容"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'这是批量发送本地测试');t.dispatchEvent(new Event('input',{bubbles:true}));`,
  );
  await checkBulkLayout();
  console.log(
    'PASS forwarding history and creation overlay the guest at four window sizes, with scrolling body and clickable fixed footer',
  );
  await shot('/workspace/ZL-WA-bulk-send.png');
  assert.equal(
    await guest(first, 'fixture.bulk.length'),
    0,
    'selecting recipients must not send',
  );
  await clickText('检查并发送');
  assert.equal(
    await guest(first, 'fixture.bulk.length'),
    0,
    'preview confirmation must not send',
  );
  assert(
    await evaluate(
      `(()=>{const buttons=[...document.querySelectorAll('[role="dialog"] button')];const button=buttons.find(b=>b.textContent.trim()==='确认发送');const r=button.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`,
    ),
    'confirmation stays above the forwarding overlay',
  );
  await clickText('确认发送');
  await wait(
    `document.querySelector('.bulk-history tbody tr:first-child')?.textContent.includes('已完成') && ${service(first)}.webview.executeJavaScript('fixture.bulk.length').then(n=>n===2)`,
    'bulk complete',
  );
  assert.deepEqual(await guest(first, 'fixture.bulk'), [
    { id: '10001@g.us', text: '这是批量发送本地测试' },
    { id: '10002@c.us', text: '这是批量发送本地测试' },
  ]);
  assert.equal(await guest(second, 'fixture.bulk.length'), 0);
  await shot('/workspace/ZL-WA-bulk-history.png');
  console.log(
    'PASS centered bulk dialog, real recipient adapter, explicit confirmation, two synthetic sends, progress and history',
  );
  await clickText('新建转发');
  await evaluate(
    `document.querySelectorAll('.bulk-columns fieldset:first-child input[type="checkbox"]')[1].click()`,
  );
  await clickText('读取聊天对象');
  await wait(
    `document.querySelectorAll('.bulk-recipient-list input').length===4`,
    'multi-account recipients',
  );
  await evaluate(
    `document.querySelector('.bulk-columns fieldset:nth-child(2) > label input').click()`,
  );
  await guest(second, `fixture.fail=true;true`);
  await clickText('检查并发送');
  await clickText('确认发送');
  await wait(
    `!!document.querySelector('.bulk-history') && document.querySelector('.bulk-history tbody tr')?.textContent.includes('已停止')`,
    'bulk stops on failure',
  );
  assert.equal(await guest(first, 'fixture.bulk.length'), 4);
  assert.equal(
    await guest(second, 'fixture.bulk.length'),
    1,
    'failure must stop before next target, with no retry',
  );
  console.log(
    'PASS multi-account targets remain distinct and an uncertain/failed send stops the queue without retry',
  );
  await guest(second, `fixture.fail=false;true`);
  await clickText('新建转发');
  await clickText('检查并发送');
  await clickText('确认发送');
  await wait(
    `${service(first)}.webview.executeJavaScript('fixture.bulk.length').then(n=>n===5)`,
    'first cancellation send',
  );
  await clickText('停止发送');
  await wait(
    `!!document.querySelector('.bulk-history') && document.querySelector('.bulk-history tbody tr')?.textContent.includes('已停止')`,
    'queue cancelled',
  );
  assert.equal(await guest(first, 'fixture.bulk.length'), 5);
  assert.equal(await guest(second, 'fixture.bulk.length'), 1);
  console.log(
    'PASS stop button prevents subsequent recipients after the current send',
  );

  // Media + revoke exercise the privileged file picker, isolated guest adapter and live history UI.
  await guest(
    first,
    `fixture.advanced=[];fixture.revoked=[];window.WPP={isReady:true,chat:{get:()=>({}),sendFileMessage:async(id,data,options)=>{const messageId='fixture-media-'+crypto.randomUUID();fixture.advanced.push({id,dataPrefix:data.slice(0,30),options,messageId});return {id:messageId,ack:1}},getMessageById:async()=>({id:{fromMe:true,remote:{_serialized:'10001@g.us'}}}),deleteMessage:async(chat,id,local,revoke)=>{fixture.revoked.push({chat,id,local,revoke});return {isRevoked:true,sendMsgResult:'OK'}}}};true`,
  );
  const mediaPath = `${tlsDirectory}/fixture.png`;
  writeFileSync(
    mediaPath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  await vm(
    `globalThis.__zlOriginalFilePicker=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').dialog.showOpenDialog;process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(mediaPath)}]});true`,
  );
  await clickText('新建转发');
  await evaluate(
    `document.querySelectorAll('.bulk-columns fieldset:first-child input[type="checkbox"]')[1].click()`,
  );
  await clickText('读取聊天对象');
  await wait(
    `document.querySelectorAll('.bulk-recipient-list input').length===2`,
    'media target list',
  );
  await evaluate(
    `document.querySelector('.bulk-recipient-list input').click()`,
  );
  await clickText('图片');
  await clickText('选择图片附件');
  await wait(
    `document.querySelector('.bulk-media')?.textContent.includes('fixture.png')`,
    'native picked and copied image',
  );
  await clickText('检查并发送');
  await clickText('确认发送');
  await wait(
    `${service(first)}.webview.executeJavaScript('fixture.advanced.length').then(n=>n===1)`,
    'one media send',
  );
  await wait(
    `document.querySelector('.bulk-history tbody tr:first-child')?.textContent.includes('已完成')`,
    'media accepted',
  );
  await evaluate(
    `document.querySelector('.bulk-history tbody tr:first-child summary').click()`,
  );
  await clickText('撤回已发消息');
  await clickText('确认撤回消息');
  await wait(
    `document.querySelectorAll('[role="dialog"]')[1]?.textContent.includes('已撤回')`,
    'revoke detail result',
  );
  assert.deepEqual(
    await guest(
      first,
      'fixture.revoked.map(r=>({chat:r.chat,local:r.local,revoke:r.revoke}))',
    ),
    [{ chat: '10001@g.us', local: false, revoke: true }],
  );
  await clickText('关闭详情');
  await clickText('撤回记录');
  await wait(
    `document.querySelector('.bulk-history tbody tr:first-child')?.textContent.includes('已撤回')`,
    'revoke history table',
  );
  await shot('/workspace/ZL-WA-bulk-revoke.png');
  await clickText('发送记录');
  assert.equal(
    await guest(first, 'fixture.advanced.length'),
    1,
    'revoke and record navigation never resend media',
  );
  await vm(
    `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').dialog.showOpenDialog=globalThis.__zlOriginalFilePicker;delete globalThis.__zlOriginalFilePicker;true`,
  );
  console.log(
    'PASS native attachment picker copies media, media adapter records its message ID, revoke requests delete-for-everyone and updates revoke history',
  );

  await clickText('新建转发');
  await evaluate(
    `(()=>{const n=document.querySelector('#bulk-failure');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,'continue');n.dispatchEvent(new Event('change',{bubbles:true}));const t=document.querySelector('#bulk-min');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(t,'4.5');t.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await clickText('关闭');
  await clickText('☷群发');
  await clickText('新建转发');
  await wait(
    `document.querySelector('#bulk-failure')?.value==='continue' && document.querySelector('#bulk-min')?.value==='4.5'`,
    'bulk preferences survive closing and reopening',
  );
  assert.equal(
    await evaluate(
      `document.querySelectorAll('.bulk-recipient-list input:checked').length`,
    ),
    0,
    'remember settings without silently restoring recipients',
  );
  console.log(
    'PASS bulk settings persist on immediate close/reopen without carrying over recipient selection',
  );
  await clickText('关闭');
  // Delete only fixtures created by this run, using the existing real delete action.
  for (const id of ids) {
    await evaluate(
      `window.ferdium.stores.services._deleteService({serviceId:${JSON.stringify(id)},redirect:false})`,
    );
  }
  assert.deepEqual(
    await evaluate('window.ferdium.stores.services.all.map(s=>s.id)'),
    before,
  );
  console.log(
    'PASS original accounts preserved; all created account fixtures removed',
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (sidebarBefore) {
    try {
      await evaluate(
        `window.ferdium.stores.settings._update({type:'app',data:{accountSidebar:${JSON.stringify(sidebarBefore)}}})`,
      );
    } catch {
      /* Keep diagnostic failure visible. */
    }
  }
  try {
    await vm(
      `if(globalThis.__zlOriginalFilePicker){process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').dialog.showOpenDialog=globalThis.__zlOriginalFilePicker;delete globalThis.__zlOriginalFilePicker;}true`,
    );
  } catch {
    /* App may have closed. */
  }
  if (bulkPreferencesBefore)
    try {
      await evaluate(
        `require('electron').ipcRenderer.invoke('account-tools-bulk-preferences',${JSON.stringify(bulkPreferencesBefore)})`,
      );
    } catch {
      /* App may have closed. */
    }
  if (mainPatched)
    try {
      await vm(
        `globalThis.__zlSessionPrototype.fetch=globalThis.__zlToolsFetch;delete globalThis.__zlSessionPrototype;delete globalThis.__zlToolsFetch;delete globalThis.__zlTranslateFail;delete globalThis.__zlTranslationCalls;globalThis.__zlProxyTLS?.closeAllConnections();globalThis.__zlProxyTLS?.close();globalThis.__zlProxyServer?.closeAllConnections();globalThis.__zlProxyServer?.close();true`,
      );
    } catch {
      /* A failed app connection may already have closed; fixtures remain isolated. */
    }
  for (const id of ids)
    try {
      await evaluate(
        `(async()=>{if(window.ferdium.stores.services.all.some(s=>s.id===${JSON.stringify(id)}))await window.ferdium.stores.services._deleteService({serviceId:${JSON.stringify(id)},redirect:false})})()`,
      );
    } catch {
      /* A failed app connection may already have closed; fixtures remain isolated. */
    }
  rmSync(tlsDirectory, { recursive: true, force: true });
  socket.close();
}
