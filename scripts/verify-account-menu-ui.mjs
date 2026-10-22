/* eslint-disable no-console -- Standalone Electron UI regression output. */
/* eslint-disable no-await-in-loop -- Menu interactions must run in sequence. */
import assert from 'node:assert/strict';
import { evaluate, wait, click, call, socket } from './account-tools-cdp.mjs';

const menu = '.account-context-menu';
const mouseClick = async (x, y) => {
  await call('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await call('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
};
const closed = () =>
  wait(`!document.querySelector(${JSON.stringify(menu)})`, 'menu dismissed');
const open = async () => {
  await click('.account-card__more');
  await wait(`!!document.querySelector('[role="menu"]')`, 'account menu');
};
try {
  await wait(
    `!!document.querySelector('.account-card__more')`,
    'existing account card',
  );
  const before = await evaluate(
    `document.querySelector('.account-sidebar').textContent`,
  );
  // Exercise the actual application portal and compiled stylesheet, including
  // the upstream div-height reset that originally blocked the backdrop.
  for (const region of ['sidebar', 'conversation']) {
    await open();
    const point = await evaluate(`(() => {
      const root = document.querySelector(${JSON.stringify(menu)});
      const sentinels = [...root.querySelectorAll('[data-testid^="sentinel"]')];
      if (sentinels.length !== 2 || sentinels.some(e => e.getBoundingClientRect().height !== 0))
        throw Error('Invisible focus sentinel intercepts outside clicks');
      return {x: ${region === 'sidebar' ? '20' : 'innerWidth - 30'}, y: innerHeight - 100};
    })()`);
    assert(
      await evaluate(
        `document.elementFromPoint(${point.x}, ${point.y}).classList.contains('MuiBackdrop-root')`,
      ),
      `${region}: outside click reaches backdrop over the application`,
    );
    await mouseClick(point.x, point.y);
    await closed();
    assert.equal(
      await evaluate(`!!document.querySelector('[role="dialog"]')`),
      false,
    );
    assert.equal(
      await evaluate(`document.querySelector('.account-sidebar').textContent`),
      before,
      'dismissal does not run a command or change accounts',
    );
  }
  await open();
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
  await closed();
  // A real menu command must still open its separate editable dialog.
  await open();
  const command = await evaluate(`(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(e => e.textContent === '修改昵称');
    const r = item.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};
  })()`);
  await mouseClick(command.x, command.y);
  await wait(
    `!!document.querySelector('[role="dialog"] input')`,
    'nickname form opens',
  );
  await evaluate(`document.querySelector('[role="dialog"] input').focus()`);
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
  await wait(
    `!document.querySelector('[role="dialog"]')`,
    'nickname form cancelled',
  );
  assert.equal(
    await evaluate(`document.querySelector('.account-sidebar').textContent`),
    before,
  );
  console.log(
    'PASS: outside clicks dismiss account menus without commands; Escape and nickname dialog remain usable.',
  );
} finally {
  socket.close();
}
