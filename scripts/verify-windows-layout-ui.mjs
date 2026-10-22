/* eslint-disable no-console -- Standalone Electron regression output. */
/* eslint-disable no-await-in-loop -- Layout transitions must run sequentially. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { evaluate, wait, call, socket } from './account-tools-cdp.mjs';

// Render the real AppLayout Windows branch with the actual compiled CSS.
// Do not supply a height override for .app-titlebar: that hid this regression
// in the earlier isolated network-indicator fixture.
const source = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {IntlProvider} from 'react-intl';
import {MemoryRouter} from 'react-router-dom';
import AppLayout from './src/components/layout/AppLayout';
const electron=require('electron');
const originalInvoke=electron.ipcRenderer.invoke;
electron.ipcRenderer.invoke=(channel,...args)=>channel==='electron-react-titlebar/initialize'
  ? Promise.resolve(0) : originalInvoke.call(electron.ipcRenderer,channel,...args);
const box=document.createElement('div');
box.style.cssText='position:fixed;inset:0;z-index:100000;background:#272727';
document.body.append(box);
const originalClasses=document.body.className;
document.body.classList.add('win32');document.body.classList.remove('isFullScreen');
const fixture={clicks:0,fullscreen:()=>{},dispose:()=>{}};
const settings={app:{locked:false,automaticUpdates:false,useCompactWorkspaceDrawer:false}};
const props={settings,isUpdateAvailable:false,updateVersion:'',showServicesUpdatedInfoBar:false,
 appUpdateIsDownloaded:false,authRequestFailed:false,installAppUpdate:()=>{},
 showRequiredRequestsError:false,areRequiredRequestsSuccessful:true,
 retryRequiredRequests:()=>{},areRequiredRequestsLoading:false,
 workspacesDrawer:<></>,sidebar:<aside className="account-sidebar" data-layout-account>Existing account</aside>,
 accountTools:<aside data-layout-tools><button onClick={()=>fixture.clicks++}>Customer</button></aside>,
 services:<section data-layout-chat><button onClick={()=>fixture.clicks++}>Existing chat</button></section>,
 networkStatus:<div className="account-network-status">IP: 203.0.113.1 · 180 ms</div>};
function Fixture(){const [full,setFull]=useState(false);fixture.fullscreen=(value)=>{
 document.body.classList.toggle('isFullScreen',value);setFull(value);
};return <IntlProvider locale="en"><MemoryRouter><AppLayout {...props} isFullScreen={full}/></MemoryRouter></IntlProvider>;}
const root=createRoot(box);root.render(<Fixture/>);
fixture.box=box;
fixture.dispose=()=>{root.unmount();box.remove();document.body.className=originalClasses;
 electron.ipcRenderer.invoke=originalInvoke;delete window.__zlWindowsLayoutFixture;};
window.__zlWindowsLayoutFixture=fixture;
`;
let installed = false;
const viewport = await evaluate(`({width:innerWidth,height:innerHeight})`);
try {
  const bundle = await build({
    stdin: { contents: source, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    packages: 'external',
    plugins: [
      {
        name: 'windows-layout-fixture',
        setup(builder) {
          builder.onResolve({ filter: /^\.\./ }, args => {
            if (!args.importer.endsWith('/components/layout/AppLayout.tsx'))
              return null;
            if (args.path === '../../environment')
              return { path: 'windows', namespace: 'layout-fixture' };
            if (args.path === '../util/ErrorBoundary')
              return { path: 'boundary', namespace: 'layout-fixture' };
            if (
              [
                '../../features/basicAuth',
                '../../features/publishDebugInfo',
                '../../features/quickSwitch',
                '../../features/todos/containers/TodosScreen',
                '../../features/workspaces/components/WorkspaceSwitchingIndicator',
                '../AppUpdateInfoBar',
                '../../containers/auth/LockedScreen',
                '../ui/InfoBar',
              ].includes(args.path)
            )
              return { path: 'unused', namespace: 'layout-fixture' };
            return null;
          });
          builder.onLoad(
            { filter: /.*/, namespace: 'layout-fixture' },
            args => ({
              contents:
                args.path === 'windows'
                  ? 'export const isWindows=true;export const isMac=false;'
                  : args.path === 'boundary'
                    ? 'export default function Boundary({children}){return children}'
                    : 'export const Component=()=>null;export default Component;',
              loader: 'tsx',
            }),
          );
        },
      },
    ],
  });
  await evaluate(bundle.outputFiles[0].text);
  installed = true;
  await wait(
    `!!window.__zlWindowsLayoutFixture.box.querySelector('#electron-app-title-bar')`,
    'real Windows title bar',
  );
  // Reproduce the exact 7.2.8 defect, then remove only the injected old rule.
  const previous = await evaluate(`(() => {
    const rule=document.createElement('style');rule.id='layout-old-height';
    rule.textContent='.app-titlebar {height:100% !important}';document.head.append(rule);
    const box=window.__zlWindowsLayoutFixture.box;
    const hidden=box.querySelector('.app__content').getBoundingClientRect().top>=innerHeight;
    rule.remove();return hidden;
  })()`);
  assert(
    previous,
    '7.2.8 full-height title-bar wrapper pushes content below viewport',
  );
  for (const [width, height] of [
    [1462, 1100],
    [1280, 720],
    [800, 600],
  ]) {
    await call('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (const full of [false, true, false]) {
      await evaluate(`window.__zlWindowsLayoutFixture.fullscreen(${full})`);
      await wait(
        `!!window.__zlWindowsLayoutFixture.box.querySelector('.app-titlebar')===${!full}`,
        'full-screen transition',
      );
      const layout = await evaluate(`(() => {
        const box=window.__zlWindowsLayoutFixture.box;
        const r=e=>{const b=e.getBoundingClientRect();return {top:b.top,bottom:b.bottom,height:b.height}};
        const header=box.querySelector('.app-titlebar');
        return {header:header?r(header):null,content:r(box.querySelector('.app__content')),
          account:r(box.querySelector('[data-layout-account]')),chat:r(box.querySelector('[data-layout-chat]'))};
      })()`);
      assert.equal(layout.header?.height ?? 0, full ? 0 : 28);
      assert.equal(layout.content.top, full ? 0 : 28);
      assert.equal(layout.content.bottom, height);
      assert(
        layout.account.top < height && layout.account.height > 0,
        'account sidebar remains on screen',
      );
      assert(
        layout.chat.top < height && layout.chat.height > 0,
        'conversation remains on screen',
      );
      const target = await evaluate(
        `(() => {const r=window.__zlWindowsLayoutFixture.box.querySelector('[data-layout-chat] button').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
      );
      const before = await evaluate(`window.__zlWindowsLayoutFixture.clicks`);
      await call('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        ...target,
        button: 'left',
        buttons: 1,
        clickCount: 1,
      });
      await call('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        ...target,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      });
      assert.equal(
        await evaluate(`window.__zlWindowsLayoutFixture.clicks`),
        before + 1,
      );
    }
  }
  console.log(
    'PASS: reproduced 7.2.8 blank Windows layout; fixed title-bar height keeps account/chat visible and clickable across sizes and full-screen transitions.',
  );
} finally {
  if (installed) await evaluate(`window.__zlWindowsLayoutFixture.dispose()`);
  await call('Emulation.setDeviceMetricsOverride', {
    ...viewport,
    deviceScaleFactor: 1,
    mobile: false,
  });
  socket.close();
}
