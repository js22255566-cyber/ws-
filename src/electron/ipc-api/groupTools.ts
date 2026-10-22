import { app, ipcMain } from 'electron';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultGroupState,
  validateGroupState,
  type GroupToolsState,
} from '../../features/groups/types';

export default function initGroupTools(
  check: (event: Electron.IpcMainInvokeEvent) => void,
) {
  const path = join(app.getPath('userData'), 'group-tools.json');
  let state: GroupToolsState | undefined;
  const load = () => {
    state ??= existsSync(path)
      ? validateGroupState(JSON.parse(readFileSync(path, 'utf8')))
      : defaultGroupState();
    return structuredClone(state);
  };
  ipcMain.handle('group-tools-load', event => {
    check(event);
    return load();
  });
  ipcMain.handle('group-tools-save', (event, input: unknown) => {
    check(event);
    const next = validateGroupState(input);
    const json = JSON.stringify(next);
    if (json.length > 5_000_000)
      throw new Error('群组任务记录过大，请减少执行对象');
    writeFileSync(`${path}.tmp`, json, { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
    state = next;
    return true;
  });
}
