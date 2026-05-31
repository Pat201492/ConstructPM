// NotificationService._deliverPush — delivers via Expo's push service using
// the Expo tokens the mobile app registers (user_devices.device_token). db and
// fetch are mocked so this is a fast, network-free unit test that locks in the
// token-column + Expo-payload contract.

jest.mock('../../src/config/database', () => {
  const pluck = jest.fn();
  const where = jest.fn(() => ({ pluck }));
  const db = jest.fn(() => ({ where }));
  db.__pluck = pluck;
  return db;
});

const db = require('../../src/config/database');
const NotificationService = require('../../src/services/NotificationService');

describe('NotificationService._deliverPush', () => {
  const note = { id: 'n1', type: 'test', title: 'Hi', body: 'Body', action_url: '/x' };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve('') }));
  });

  it('sends only to valid Expo tokens via the Expo push API', async () => {
    db.__pluck.mockResolvedValue(['ExponentPushToken[abc]', 'not-a-token', 'ExponentPushToken[def]']);

    await NotificationService._deliverPush('u1', note);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    const payload = JSON.parse(opts.body);
    expect(payload).toHaveLength(2); // the bogus token is filtered out
    expect(payload.map((m) => m.to)).toEqual(['ExponentPushToken[abc]', 'ExponentPushToken[def]']);
    expect(payload[0].title).toBe('Hi');
    expect(payload[0].body).toBe('Body');
    expect(payload[0].data.action_url).toBe('/x');
  });

  it('skips the network entirely when no Expo tokens exist', async () => {
    db.__pluck.mockResolvedValue(['fcm-legacy-token', null]);
    await NotificationService._deliverPush('u1', note);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws when Expo returns a non-ok response', async () => {
    db.__pluck.mockResolvedValue(['ExponentPushToken[abc]']);
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve('bad token') })
    );
    await expect(NotificationService._deliverPush('u1', note)).rejects.toThrow('Expo push 400');
  });
});
