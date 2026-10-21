import { app, dialog, ipcMain, type BrowserWindow } from 'electron';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BulkMedia } from '../../features/accountTools/config';

const mimeTypes: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  txt: 'text/plain',
};
export default function initBulkMedia(mainWindow: BrowserWindow) {
  const directory = join(app.getPath('userData'), 'bulk-media');
  const check = (event: Electron.IpcMainInvokeEvent) => {
    if (
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    )
      throw new Error('禁止访问附件');
  };
  ipcMain.handle('account-tools-library', event => {
    check(event);
    return readFileSync(join(__dirname, '../../wppconnect-wa.js'), 'utf8');
  });
  ipcMain.handle('account-tools-media-pick', async (event, type: string) => {
    check(event);
    const extensions =
      type === 'image' || type === 'caption'
        ? ['jpg', 'jpeg', 'png', 'webp', 'gif']
        : type === 'video'
          ? ['mp4', 'mov', 'webm']
          : type === 'audio'
            ? ['ogg', 'opus', 'mp3', 'm4a', 'wav']
            : type === 'document'
              ? ['*']
              : [];
    if (extensions.length === 0) throw new Error('无效附件类型');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择群发附件',
      properties: ['openFile'],
      filters: [{ name: '支持的附件', extensions }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    const stat = statSync(source);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 50 * 1024 * 1024)
      throw new Error('请选择 1 字节至 50 MB 的文件');
    const ext = extname(source).slice(1).toLowerCase();
    if (type !== 'document' && !extensions.includes(ext))
      throw new Error('文件类型不匹配');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const meta: BulkMedia = {
      id: randomUUID(),
      name: basename(source),
      mime: mimeTypes[ext] || 'application/octet-stream',
      size: stat.size,
    };
    copyFileSync(source, join(directory, meta.id));
    writeFileSync(join(directory, `${meta.id}.json`), JSON.stringify(meta), {
      mode: 0o600,
    });
    return meta;
  });
  ipcMain.handle('account-tools-media-read', (event, id: string) => {
    check(event);
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))
      throw new Error('无效附件编号');
    const meta: BulkMedia = JSON.parse(
      readFileSync(join(directory, `${id}.json`), 'utf8'),
    );
    const path = join(directory, id);
    if (statSync(path).size > 50 * 1024 * 1024)
      throw new Error('附件超过大小限制');
    return `data:${meta.mime};base64,${readFileSync(path).toString('base64')}`;
  });
}
