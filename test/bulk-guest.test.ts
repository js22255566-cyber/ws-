import {
  sendBulkMessage,
  revokeBulkMessage,
  listBulkContacts,
} from '../src/features/accountTools/bulkGuest';
import type { BulkSpec } from '../src/features/accountTools/config';

const spec = (type: BulkSpec['type'] = 'text'): BulkSpec => ({
  type,
  text: 'hello',
  targets: [],
  intervalMin: 1,
  intervalMax: 1,
  typingSeconds: 2,
  mentionAll: false,
  failure: 'stop',
  media: {
    id: 'media',
    name: 'sample',
    mime: 'application/octet-stream',
    size: 1,
  },
  contactName: 'Test card',
  contactPhone: '8613800000000',
});
describe('advanced WhatsApp adapter with synthetic WPP, no real messages', () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let wpp: any;
  beforeEach(() => {
    const accepted = { id: 'own-message', ack: 1 };
    wpp = {
      isReady: true,
      chat: {
        get: jest.fn().mockReturnValue({}),
        sendTextMessage: jest.fn().mockResolvedValue(accepted),
        sendFileMessage: jest.fn().mockResolvedValue(accepted),
        sendVCardContactMessage: jest.fn().mockResolvedValue(accepted),
        getMessageById: jest.fn().mockResolvedValue({
          id: { fromMe: true, remote: { _serialized: 'chat@g.us' } },
        }),
        deleteMessage: jest
          .fn()
          .mockResolvedValue({ isRevoked: true, sendMsgResult: 'OK' }),
      },
      group: {
        getParticipants: jest
          .fn()
          .mockResolvedValue([{ id: { _serialized: 'member@lid' } }]),
      },
      contact: {
        list: jest.fn().mockResolvedValue([
          {
            id: { _serialized: 'saved@c.us', server: 'c.us' },
            name: 'Saved contact',
          },
          { id: { server: 'newsletter' } },
        ]),
      },
    };
    for (const [key, value] of Object.entries({
      window: { WPP: wpp },
      location: { hostname: 'web.whatsapp.com' },
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  });
  afterEach(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });
  it.each(['image', 'caption', 'video', 'audio', 'document'] as const)(
    'sends %s through the correct typed adapter with server acknowledgment',
    async type => {
      expect(
        await sendBulkMessage('chat@g.us', spec(type), 'data:test;base64,AA=='),
      ).toEqual({ messageId: 'own-message', confirmed: true });
      expect(wpp.chat.sendFileMessage).toHaveBeenCalledWith(
        'chat@g.us',
        'data:test;base64,AA==',
        expect.objectContaining({
          type: type === 'caption' ? 'image' : type,
          waitForAck: true,
          delay: 2000,
          isPtt: type === 'audio',
          caption: type === 'image' || type === 'audio' ? undefined : 'hello',
        }),
      );
    },
  );
  it('constructs a contact card from the user supplied name and international number', async () => {
    await sendBulkMessage('chat@g.us', spec('contact'));
    expect(wpp.chat.sendVCardContactMessage).toHaveBeenCalledWith(
      'chat@g.us',
      { id: '8613800000000@c.us', name: 'Test card' },
      expect.objectContaining({ waitForAck: true }),
    );
  });
  it('mentions the actual group participant IDs, including LID addressing, only when enabled', async () => {
    await sendBulkMessage('chat@g.us', { ...spec(), mentionAll: true });
    expect(wpp.chat.sendTextMessage).toHaveBeenCalledWith(
      'chat@g.us',
      '@member\nhello',
      expect.objectContaining({
        mentionedList: ['member@lid'],
        detectMentioned: false,
      }),
    );
    await sendBulkMessage('private@c.us', { ...spec(), mentionAll: true });
    expect(wpp.group.getParticipants).toHaveBeenCalledTimes(1);
  });
  it('does not pretend an unacknowledged send or a local deletion is a successful revoke', async () => {
    wpp.chat.sendTextMessage.mockResolvedValue({ id: 'pending', ack: 0 });
    expect(await sendBulkMessage('chat@g.us', spec())).toEqual({
      messageId: 'pending',
      confirmed: false,
    });
    wpp.chat.deleteMessage.mockResolvedValue({
      isRevoked: false,
      isDeleted: true,
      sendMsgResult: 'OK',
    });
    await expect(revokeBulkMessage('chat@g.us', 'own-message')).rejects.toThrow(
      '未确认',
    );
  });
  it('revokes only the current account own message in the recorded chat with revoke=true', async () => {
    await revokeBulkMessage('chat@g.us', 'own-message');
    expect(wpp.chat.deleteMessage).toHaveBeenCalledWith(
      'chat@g.us',
      'own-message',
      false,
      true,
    );
    wpp.chat.getMessageById.mockResolvedValue({ id: { fromMe: false } });
    await expect(
      revokeBulkMessage('chat@g.us', 'foreign-message'),
    ).rejects.toThrow('不属于');
    expect(wpp.chat.deleteMessage).toHaveBeenCalledTimes(1);
  });
  it('reads only this account saved contacts, excluding channels', async () => {
    expect(await listBulkContacts()).toEqual([
      {
        id: 'saved@c.us',
        name: 'Saved contact',
        group: false,
        contact: true,
        contactOnly: true,
      },
    ]);
    expect(wpp.contact.list).toHaveBeenCalledWith({ onlyMyContacts: true });
  });
});
