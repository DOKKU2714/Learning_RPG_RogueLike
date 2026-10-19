const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function server() {
  const properties = new Map(), cache = new Map();
  const player = { playerId: 'p1', isActive: true, passwordHash: 'hash', passwordSalt: 'salt', role: 'student', approvalStatus: 'approved' };
  let id = 0;
  const c = vm.createContext({ Date, DB_SHEETS: { PLAYERS: 'Players' },
    PropertiesService: { getScriptProperties: () => ({
      getProperties: () => Object.fromEntries(properties),
      getProperty: key => properties.get(key) || null,
      setProperty: (key, value) => properties.set(key, value),
      deleteProperty: key => properties.delete(key),
    }) },
    CacheService: { getScriptCache: () => ({ get: key => cache.get(key), put: (key, value) => cache.set(key, value), remove: key => cache.delete(key) }) },
    safeJsonParse_: (value, fallback) => { try { return JSON.parse(value) || fallback; } catch { return fallback; } },
    safeJsonStringify_: JSON.stringify, generateId_: prefix => prefix + '_' + ++id,
    isTruthy_: Boolean, findRowByKeyUncached_: () => player,
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'UserService.gs'), 'utf8'), c);
  c.hashPassword_ = (value, salt) => crypto.createHash('sha256').update(salt + ':' + value).digest('hex');
  c.getCurrentUser = token => ({ isRegistered: !!c.getPlayerByAuthToken_(token) });
  return { c, properties, cache, player };
}

test('remembered login survives cache loss and logout revokes it', () => {
  const { c, properties, cache, player } = server();
  const response = c.buildAuthResponse_(player, true);
  assert.equal(response.user.isRegistered, true);
  assert.ok(response.rememberExpiresAt > Date.now() + 29 * 86400000);
  assert.ok(![...properties.keys()][0].includes(response.authToken));
  cache.clear();
  assert.equal(c.getPlayerByAuthToken_(response.authToken).playerId, 'p1');
  c.logoutPlayer(response.authToken);
  assert.equal(c.getPlayerByAuthToken_(response.authToken), null);
});

test('expired, disabled, rejected and changed-password logins cannot be restored', () => {
  for (const change of ['expired', 'disabled', 'rejected', 'password']) {
    const { c, properties, player } = server();
    const { authToken } = c.buildAuthResponse_(player, true);
    if (change === 'expired') {
      const key = c.getRememberedAuthKey_(authToken);
      properties.set(key, JSON.stringify({ ...JSON.parse(properties.get(key)), expiresAt: Date.now() - 1 }));
    }
    if (change === 'disabled') player.isActive = false;
    if (change === 'rejected') player.approvalStatus = 'rejected';
    if (change === 'password') player.passwordHash = 'changed';
    assert.equal(c.getPlayerByAuthToken_(authToken), null, change);
    assert.equal(properties.size, 0);
  }
});

test('ordinary login stays temporary', () => {
  const { c, properties, cache, player } = server();
  const response = c.buildAuthResponse_(player, false);
  assert.equal(response.rememberExpiresAt, 0);
  assert.equal(properties.size, 0);
  cache.clear();
  assert.equal(c.getPlayerByAuthToken_(response.authToken), null);
});

function client() {
  const html = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
  const extract = name => html.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))[0];
  function storage() {
    const values = new Map();
    return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  }
  const c = vm.createContext({ localStorage: storage(), sessionStorage: storage(), Date });
  vm.runInContext(['getAuthToken', 'saveAuthToken', 'saveAuthTokenToSession'].map(extract).join('\n'), c);
  return c;
}

test('new browser session restores remembered token without storing credentials', () => {
  const c = client();
  c.saveAuthToken('remember_123', Date.now() + 86400000);
  c.sessionStorage.removeItem('learningRpgAuthToken');
  assert.equal(c.getAuthToken(), 'remember_123');
  assert.equal(c.sessionStorage.getItem('learningRpgAuthToken'), 'remember_123');
  c.saveAuthToken('session_456', 0);
  assert.equal(c.localStorage.getItem('learningRpgRememberedAuth'), null);
  c.sessionStorage.removeItem('learningRpgAuthToken');
  assert.equal(c.getAuthToken(), '');
});

test('expired local records are discarded and blocked storage allows temporary login', () => {
  const c = client();
  c.localStorage.setItem('learningRpgRememberedAuth', JSON.stringify({ token: 'old', expiresAt: Date.now() - 1 }));
  assert.equal(c.getAuthToken(), '');
  assert.equal(c.localStorage.getItem('learningRpgRememberedAuth'), null);
  c.localStorage.setItem = () => { throw new Error('blocked'); };
  assert.equal(c.saveAuthToken('remember_new', Date.now() + 86400000), false);
  assert.equal(c.getAuthToken(), 'remember_new');
});
