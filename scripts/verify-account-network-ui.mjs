/* eslint-disable no-console -- Standalone UI regression output. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { evaluate, wait, socket } from './account-tools-cdp.mjs';

const source = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { observable } from 'mobx';
import AccountNetworkStatus from './src/features/accountTools/AccountNetworkStatus';
const electron = require('electron');
const original = electron.ipcRenderer.invoke;
const requests = [];
electron.ipcRenderer.invoke = (channel, ...args) => channel === 'account-tools-network-status'
  ? new Promise((resolve, reject) => requests.push({ id: args[0], force: args[1], resolve, reject }))
  : original.call(electron.ipcRenderer, channel, ...args);
const box = document.createElement('div');
box.className = 'app-titlebar';
box.style.cssText = 'position:fixed;top:0;left:0;right:0;height:28px;background:#292c30;z-index:100000';
document.body.append(box);
const stores = observable({ services: { active: { id: 'network-one', recipe: { id: 'whatsapp' }, isEnabled: true, isHibernating: false, name: '账号一', accountSnapshot: { nickname: '' } } } });
const root = createRoot(box);
root.render(<AccountNetworkStatus stores={stores as any} />);
window.__zlNetworkFixture = { box, stores, requests, dispose: () => { root.unmount(); box.remove(); electron.ipcRenderer.invoke = original; delete window.__zlNetworkFixture; } };
`;
let installed = false;
try {
  const result = await build({
    stdin: { contents: source, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    external: ['electron', 'react', 'react-dom/client', 'mobx', 'mobx-react'],
  });
  await evaluate(result.outputFiles[0].text);
  installed = true;
  await wait(
    `window.__zlNetworkFixture.requests.length===1`,
    'initial account network request',
  );
  assert(
    await evaluate(
      `document.querySelector('.account-network-status').textContent.includes('检测中')`,
    ),
  );
  await evaluate(
    `window.__zlNetworkFixture.requests[0].resolve({ip:'203.0.113.1',milliseconds:560,checkedAt:Date.now()})`,
  );
  await wait(
    `document.querySelector('.account-network-status').textContent.includes('560 ms')`,
    'network result rendered',
  );
  assert(
    await evaluate(
      `document.querySelector('.account-network-status').textContent.includes('203.0.113.1')`,
    ),
  );
  const region = await evaluate(
    `(()=>{const node=document.querySelector('.account-network-status');const bounds=node.getBoundingClientRect();return {right:innerWidth-bounds.right,top:bounds.top,drag:getComputedStyle(node).getPropertyValue('-webkit-app-region')}})()`,
  );
  assert(region.right >= 135, 'indicator leaves window controls available');
  assert.equal(region.top, 0);
  assert.equal(region.drag, 'no-drag');
  await evaluate(
    `document.querySelector('[aria-label="刷新 IP 和延迟"]').click()`,
  );
  await wait(`window.__zlNetworkFixture.requests.length===2`, 'manual refresh');
  assert(await evaluate(`window.__zlNetworkFixture.requests[1].force`));
  // Switch accounts while the earlier request is still pending.
  await evaluate(
    `window.__zlNetworkFixture.stores.services.active.id='network-two'`,
  );
  await wait(`window.__zlNetworkFixture.requests.length===3`, 'account switch');
  await evaluate(
    `window.__zlNetworkFixture.requests[1].resolve({ip:'203.0.113.99',milliseconds:900,checkedAt:Date.now()});window.__zlNetworkFixture.requests[2].resolve({ip:'2001:db8::2',milliseconds:80,checkedAt:Date.now()})`,
  );
  await wait(
    `document.querySelector('.account-network-status').textContent.includes('2001:db8::2')`,
    'new account result',
  );
  assert(
    !(await evaluate(
      `document.querySelector('.account-network-status').textContent.includes('203.0.113.99')`,
    )),
  );
  await evaluate(
    `window.dispatchEvent(new CustomEvent('zl-account-network-changed',{detail:'network-two'}))`,
  );
  await wait(
    `window.__zlNetworkFixture.requests.length===4`,
    'proxy change triggers refresh',
  );
  await evaluate(
    `window.__zlNetworkFixture.requests[3].reject(new Error('模拟代理连接失败'))`,
  );
  await wait(
    `document.querySelector('.account-network-status').title.includes('模拟代理连接失败')`,
    'failure feedback',
  );
  assert(
    !(await evaluate(
      `document.querySelector('.account-network-status').textContent.includes('2001:db8::2')`,
    )),
    'failed refresh must not show stale IP',
  );
  await evaluate(
    `window.__zlNetworkFixture.stores.services.active.isHibernating=true`,
  );
  await wait(
    `document.querySelector('[aria-label="刷新 IP 和延迟"]').disabled`,
    'sleep disables probe',
  );
  console.log(
    'PASS title-bar placement, no-drag refresh, account switching, stale-result rejection, proxy-change refresh, failure and hibernation',
  );
} finally {
  if (installed) await evaluate(`window.__zlNetworkFixture?.dispose()`);
  socket.close();
}
