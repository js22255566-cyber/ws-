/* eslint-disable no-console -- Standalone UI regression output. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { evaluate, wait, call, socket } from './account-tools-cdp.mjs';

const source = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import BulkSend from './src/features/accountTools/BulkSend';
import {getBulkQueue} from './src/features/accountTools/bulkRuntime';
const electron=require('electron');
const invoke=electron.ipcRenderer.invoke;
electron.ipcRenderer.invoke=(name,...args)=>{
  if(name==='account-tools-bulk-preferences') return Promise.resolve(args[0]||{});
  if(name==='account-tools-history') return Promise.resolve([]);
  return invoke.call(electron.ipcRenderer,name,...args);
};
const stores={services:{all:[]},settings:{app:{accountSidebar:{}}}};
const queue=getBulkQueue(stores as any);
const box=document.createElement('div');document.body.append(box);
const toast=document.createElement('div');
toast.textContent='模拟系统通知：新消息';
toast.style.cssText='position:fixed;right:12px;bottom:12px;width:360px;height:170px;background:#292c30;color:white;z-index:2147483647;padding:20px;box-sizing:border-box';
document.body.append(toast);
const fixture={queue,closed:0,open:()=>{},dispose:()=>{}};
function Fixture(){const [open,setOpen]=useState(true);fixture.open=()=>setOpen(true);return open?<BulkSend stores={stores as any} onClose={()=>{fixture.closed++;setOpen(false)}}/>:null;}
const root=createRoot(box);root.render(<Fixture/>);
fixture.dispose=()=>{root.unmount();queue.dispose();box.remove();toast.remove();electron.ipcRenderer.invoke=invoke;delete window.__zlBulkCloseFixture;};
window.__zlBulkCloseFixture=fixture;
`;
let installed = false;
const press = async selector => {
  const point = await evaluate(
    `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
  await call('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    buttons: 1,
    clickCount: 1,
    ...point,
  });
  // The dialog must dismiss on the first press, even if window activation
  // interrupts the subsequent release/click after a system notification.
  await wait(
    `!document.querySelector('.bulk-dialog')`,
    'first press closes bulk dialog',
  );
  await call('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    buttons: 0,
    clickCount: 1,
    ...point,
  });
};
try {
  const built = await build({
    stdin: { contents: source, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    packages: 'external',
  });
  await evaluate(built.outputFiles[0].text);
  installed = true;
  await wait(
    `!!document.querySelector('.bulk-dialog__close')`,
    'bulk modal ready',
  );
  await wait(
    `!document.querySelector('.bulk-dialog .MuiButton-contained')?.disabled`,
    'bulk preferences ready',
  );
  const layout = await evaluate(
    `(()=>{const bottom=document.querySelector('.bulk-dialog__close').getBoundingClientRect();const top=document.querySelector('.bulk-dialog__close-icon').getBoundingClientRect();return {bottomLeft:bottom.x<innerWidth/2,topRight:top.x>innerWidth/2&&top.y<150,noDrag:getComputedStyle(document.querySelector('.bulk-dialog__close')).getPropertyValue('-webkit-app-region')}})()`,
  );
  assert(
    layout.bottomLeft && layout.topRight,
    'close controls avoid the lower-right toast',
  );
  assert.equal(layout.noDrag, 'no-drag');
  await evaluate(
    `window.__zlBulkCloseFixture.queue.activeId='simulated-background-task';window.__zlBulkCloseFixture.queue.notify();window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'))`,
  );
  await press('.bulk-dialog__close');
  assert.equal(await evaluate(`window.__zlBulkCloseFixture.closed`), 1);
  assert.equal(
    await evaluate(`window.__zlBulkCloseFixture.queue.activeId`),
    'simulated-background-task',
    'closing must preserve background execution',
  );
  await evaluate(`window.__zlBulkCloseFixture.open()`);
  await wait(
    `!!document.querySelector('.bulk-dialog__close-icon')`,
    'reopened modal',
  );
  await evaluate(
    `document.querySelector('.bulk-dialog__close-icon').dispatchEvent(new PointerEvent('pointerdown',{pointerType:'mouse',button:2,bubbles:true}))`,
  );
  assert(
    await evaluate(`!!document.querySelector('.bulk-dialog')`),
    'secondary mouse button must not dismiss',
  );
  await press('.bulk-dialog__close-icon');
  assert.equal(await evaluate(`window.__zlBulkCloseFixture.closed`), 2);
  await evaluate(`window.__zlBulkCloseFixture.open()`);
  await wait(
    `!!document.querySelector('.bulk-dialog__close')`,
    'keyboard modal',
  );
  await call('Page.bringToFront');
  await evaluate(
    `new Promise(resolve=>setTimeout(()=>{document.querySelector('.bulk-dialog__close').focus();resolve(true)},300))`,
  );
  await wait(
    `document.activeElement?.classList.contains('bulk-dialog__close')`,
    'keyboard focus on close button',
  );
  await call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    text: '\r',
    unmodifiedText: '\r',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
  });
  await call('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
  });
  await wait(`!document.querySelector('.bulk-dialog')`, 'keyboard close');
  assert.equal(await evaluate(`window.__zlBulkCloseFixture.closed`), 3);
  await evaluate(`window.__zlBulkCloseFixture.open()`);
  await wait(`!!document.querySelector('.bulk-dialog')`, 'escape modal');
  await call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await call('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await wait(`!document.querySelector('.bulk-dialog')`, 'escape close');
  console.log(
    'PASS close controls avoid notification area; first mouse press after focus change, header close, keyboard and Escape work; background task retained',
  );
} finally {
  if (installed) await evaluate(`window.__zlBulkCloseFixture?.dispose()`);
  socket.close();
}
