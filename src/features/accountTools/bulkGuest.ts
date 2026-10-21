import type { BulkSpec, BulkSendOutcome } from './config';

export async function listBulkContacts() {
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    throw new Error('当前会话不是 WhatsApp');
  const wpp = (window as any).WPP;
  if (!wpp?.isReady) throw new Error('WhatsApp 接口未就绪');
  const contacts = await wpp.contact.list({ onlyMyContacts: true });
  return contacts
    .filter(c => c.id && ['c.us', 'lid'].includes(c.id.server))
    .map(c => ({
      id: c.id._serialized,
      name: String(c.name || c.pushname || c.id.user),
      group: false,
      contact: true,
      contactOnly: true,
    }));
}

// Serialized into the isolated account. Keep all helpers inside each function.
export async function sendBulkMessage(
  chatId: string,
  spec: BulkSpec,
  dataUrl?: string,
): Promise<BulkSendOutcome> {
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    throw new Error('当前会话不是 WhatsApp');
  const wpp = (window as any).WPP;
  if (!wpp?.isReady)
    throw new Error('WhatsApp 消息接口尚未就绪，请刷新账号后重试');
  const chat = await wpp.chat.get(chatId);
  if (
    chat?.isReadOnly ||
    (!chat && !spec.targets.some(r => r.id === chatId && r.contactOnly))
  )
    throw new Error('所选聊天没有发送权限');
  const options: any = {
    waitForAck: true,
    markIsRead: false,
    detectMentioned: false,
    delay: spec.typingSeconds * 1000,
  };
  let content = spec.text;
  if (spec.mentionAll && chatId.endsWith('@g.us')) {
    const participants = await wpp.group.getParticipants(chatId);
    options.mentionedList = participants
      .map(p => p.id?._serialized || String(p.id))
      .filter(Boolean);
    if (options.mentionedList.length === 0)
      throw new Error('未能读取群成员，无法 @所有人');
    content = `${options.mentionedList.map(id => `@${id.split('@')[0]}`).join(' ')}\n${content}`;
  }
  let result: any;
  if (spec.type === 'text')
    result = await wpp.chat.sendTextMessage(chatId, content, options);
  else if (spec.type === 'contact')
    result = await wpp.chat.sendVCardContactMessage(
      chatId,
      { id: `${spec.contactPhone}@c.us`, name: spec.contactName },
      options,
    );
  else {
    if (!dataUrl?.startsWith('data:')) throw new Error('附件不可用');
    result = await wpp.chat.sendFileMessage(chatId, dataUrl, {
      ...options,
      type: spec.type === 'caption' ? 'image' : spec.type,
      filename: spec.media?.name,
      mimetype: spec.media?.mime,
      caption:
        spec.type === 'image' || spec.type === 'audio' ? undefined : content,
      isPtt: spec.type === 'audio',
    });
  }
  if (typeof result?.id !== 'string')
    throw new Error('未确认服务器接受消息，请在 WhatsApp 核查');
  return {
    messageId: result.id,
    confirmed:
      result.ack >= 1 || result.sendMsgResult?.messageSendResult === 'success',
  };
}

export async function revokeBulkMessage(
  chatId: string,
  messageId: string,
): Promise<void> {
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    throw new Error('当前会话不是 WhatsApp');
  const wpp = (window as any).WPP;
  if (!wpp?.isReady) throw new Error('WhatsApp 消息接口尚未就绪');
  const message = await wpp.chat.getMessageById(messageId);
  if (
    !message?.id?.fromMe ||
    String(message.id.remote?._serialized || message.id.remote) !== chatId
  )
    throw new Error('消息不属于当前账号或聊天，无法撤回');
  const result = await wpp.chat.deleteMessage(chatId, messageId, false, true);
  const item = Array.isArray(result) ? result[0] : result;
  if (!item?.isRevoked || !['OK', 'success'].includes(item.sendMsgResult))
    throw new Error(
      '未确认撤回成功，可能已超出平台撤回时限，请在 WhatsApp 核查',
    );
}
