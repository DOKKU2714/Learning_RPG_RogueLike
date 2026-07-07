function getCurrentUser(authToken) {
  var email = getCurrentUserEmail_();
  var player = authToken ? getPlayerByAuthToken_(authToken) : null;

  return {
    email: email,
    isLoggedIn: !!player,
    isRegistered: !!player,
    isAdmin: isAdmin(email),
    player: toClientObject_(player),
    playerData: player ? getPlayerData(player.playerId) : null,
    settings: getAppSettings(),
  };
}

function registerPlayer(signupPayload) {
  requirePlayerAuthSchema_();
  var payload = signupPayload || {};
  var studentId = normalizeStudentId_(payload.studentId);
  var studentName = normalizeStudentName_(payload.studentName);
  var password = normalizePassword_(payload.password);
  var avatarDataUrl = normalizeAvatarDataUrl_(payload.avatarDataUrl);

  if (findPlayerByStudentId_(studentId)) {
    throw new Error('이미 등록된 학번입니다. 로그인해 주세요.');
  }

  var now = new Date();
  var passwordSalt = generateId_('salt');
  var displayName = studentId + ' ' + studentName;
  var player = {
    playerId: generateId_('player'),
    studentId: studentId,
    studentName: studentName,
    passwordHash: hashPassword_(password, passwordSalt),
    passwordSalt: passwordSalt,
    email: '',
    displayName: displayName,
    avatarType: avatarDataUrl ? AVATAR_TYPES.PHOTO : AVATAR_TYPES.INITIAL,
    avatarKey: avatarDataUrl || studentName.charAt(0) || '?',
    createdAt: now,
    lastLoginAt: now,
    isActive: true,
  };

  appendRowObject_(DB_SHEETS.PLAYERS, player);
  ensurePlayerData_(player.playerId);
  return buildAuthResponse_(player);
}

function loginPlayer(loginPayload) {
  requirePlayerAuthSchema_();
  var payload = loginPayload || {};
  var studentId = normalizeStudentId_(payload.studentId);
  var password = normalizePassword_(payload.password);
  var player = findPlayerByStudentId_(studentId);

  if (!player || !isTruthy_(player.isActive)) {
    throw new Error('등록된 학번을 찾을 수 없습니다.');
  }
  if (!verifyPassword_(password, player.passwordSalt, player.passwordHash)) {
    throw new Error('비밀번호가 올바르지 않습니다.');
  }

  updateRowByKey_(DB_SHEETS.PLAYERS, 'playerId', player.playerId, {
    lastLoginAt: new Date(),
  });
  return buildAuthResponse_(Object.assign({}, player, { lastLoginAt: new Date() }));
}

function logoutPlayer(authToken) {
  if (authToken) {
    var cache = CacheService.getScriptCache();
    cache.remove(getAuthCacheKey_(authToken));
    cache.remove(getAuthPlayerCacheKey_(authToken));
  }
  return { ok: true };
}

function getPlayerByEmail(email) {
  return toClientObject_(findPlayerByEmail_(email));
}

function getPlayerData(playerId) {
  return toClientObject_(getPlayerData_(playerId));
}

function getPlayerData_(playerId) {
  if (!playerId) {
    return null;
  }

  return findRowByKey_(DB_SHEETS.PLAYER_DATA, 'playerId', playerId);
}

function isAdmin(email) {
  var normalizedEmail = normalizeEmail_(email);
  if (!normalizedEmail) {
    return false;
  }

  var admin = readTableCached_(DB_SHEETS.ADMINS, 600).filter(function(row) {
    return normalizeEmail_(row.email) === normalizedEmail;
  })[0];
  return !!admin && isTruthy_(admin.active);
}

function getAppSettings() {
  return readTable_(DB_SHEETS.SETTINGS).reduce(function(settings, row) {
    settings[row.key] = coerceSettingValue_(row.value, row.type);
    return settings;
  }, {});
}

function getCurrentPlayer_(authToken) {
  var player = getPlayerByAuthToken_(authToken);
  if (!player) {
    throw new Error('먼저 학번과 비밀번호로 로그인해 주세요.');
  }
  return player;
}

function findPlayerByEmail_(email) {
  var normalizedEmail = normalizeEmail_(email);
  if (!normalizedEmail) {
    return null;
  }

  return readTable_(DB_SHEETS.PLAYERS).filter(function(player) {
    return normalizeEmail_(player.email) === normalizedEmail;
  })[0] || null;
}

function findPlayerByStudentId_(studentId) {
  var normalizedStudentId = normalizeStudentId_(studentId);
  return readTable_(DB_SHEETS.PLAYERS).filter(function(player) {
    return normalizeStudentId_(player.studentId) === normalizedStudentId;
  })[0] || null;
}

function requirePlayerAuthSchema_() {
  var headers = getHeaderRow_(getSheet_(DB_SHEETS.PLAYERS));
  var requiredHeaders = ['playerId', 'studentId', 'studentName', 'passwordHash', 'passwordSalt', 'displayName'];
  var missingHeaders = requiredHeaders.filter(function(header) {
    return headers.indexOf(header) === -1;
  });

  if (missingHeaders.length > 0) {
    throw new Error('Players 시트에 필요한 컬럼이 없습니다: ' + missingHeaders.join(', ') + '. 스프레드시트 헤더를 먼저 수정해 주세요.');
  }
}

function getPlayerByAuthToken_(authToken) {
  var token = String(authToken || '').trim();
  if (!token) {
    return null;
  }

  var cache = CacheService.getScriptCache();
  var playerId = cache.get(getAuthCacheKey_(token));
  if (!playerId) {
    return null;
  }

  var playerCacheKey = getAuthPlayerCacheKey_(token);
  var cachedPlayer = safeJsonParse_(cache.get(playerCacheKey), null);
  if (cachedPlayer && cachedPlayer.playerId === playerId) {
    return cachedPlayer;
  }

  var player = findRowByKey_(DB_SHEETS.PLAYERS, 'playerId', playerId);
  if (player) {
    cache.put(playerCacheKey, safeJsonStringify_(player), 21600);
  }
  return player;
}

function buildAuthResponse_(player) {
  var authToken = generateId_('session');
  var cache = CacheService.getScriptCache();
  cache.put(getAuthCacheKey_(authToken), player.playerId, 21600);
  cache.put(getAuthPlayerCacheKey_(authToken), safeJsonStringify_(player), 21600);
  return {
    authToken: authToken,
    user: getCurrentUser(authToken),
  };
}

function getAuthCacheKey_(authToken) {
  return 'auth_' + String(authToken || '').trim();
}

function getAuthPlayerCacheKey_(authToken) {
  return 'authPlayer_' + String(authToken || '').trim();
}

function ensurePlayerData_(playerId) {
  var existing = getPlayerData_(playerId);
  if (existing) {
    return existing;
  }

  var now = new Date();
  var playerData = {
    playerId: playerId,
    maxFloor: 1,
    maxStage: 1,
    bestClearTimeMs: '',
    totalAnswerCount: 0,
    correctAnswerCount: 0,
    averageAnswerTimeMs: 0,
    currency: 0,
    baseStatsJson: safeJsonStringify_(BASE_PLAYER_STATS),
    ownedSkillsJson: safeJsonStringify_([]),
    ownedItemsJson: safeJsonStringify_([]),
    updatedAt: now,
  };

  appendRowObject_(DB_SHEETS.PLAYER_DATA, playerData);
  return playerData;
}

function getCurrentUserEmail_() {
  return normalizeEmail_(Session.getActiveUser().getEmail());
}

function requireCurrentUserEmail_() {
  var email = getCurrentUserEmail_();
  if (!email) {
    throw new Error('Google 계정 이메일을 확인할 수 없습니다. 로그인 상태와 웹앱 배포 권한을 확인해 주세요.');
  }
  return email;
}

function normalizeDisplayName_(displayName) {
  var normalizedName = String(displayName || '').trim();
  if (normalizedName.length < 1) {
    throw new Error('이름을 입력해 주세요.');
  }
  if (normalizedName.length > 20) {
    throw new Error('이름은 20자 이하로 입력해 주세요.');
  }
  return normalizedName;
}

function normalizeStudentId_(studentId) {
  var normalizedStudentId = String(studentId || '').trim();
  if (normalizedStudentId.length < 1) {
    throw new Error('학번을 입력해 주세요.');
  }
  if (normalizedStudentId.length > 30) {
    throw new Error('학번은 30자 이하로 입력해 주세요.');
  }
  return normalizedStudentId;
}

function normalizeStudentName_(studentName) {
  var normalizedStudentName = String(studentName || '').trim();
  if (normalizedStudentName.length < 1) {
    throw new Error('이름을 입력해 주세요.');
  }
  if (normalizedStudentName.length > 20) {
    throw new Error('이름은 20자 이하로 입력해 주세요.');
  }
  return normalizedStudentName;
}

function normalizePassword_(password) {
  var normalizedPassword = String(password || '');
  if (normalizedPassword.length < 4) {
    throw new Error('비밀번호는 4자 이상으로 설정해 주세요.');
  }
  if (normalizedPassword.length > 40) {
    throw new Error('비밀번호는 40자 이하로 입력해 주세요.');
  }
  return normalizedPassword;
}

function normalizeAvatarDataUrl_(avatarDataUrl) {
  var value = String(avatarDataUrl || '').trim();
  if (!value) {
    return '';
  }
  if (value.length > 60000) {
    throw new Error('Uploaded profile image is too large.');
  }
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) {
    throw new Error('Unsupported profile image format.');
  }
  return value;
}

function hashPassword_(password, salt) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt || '') + ':' + String(password || ''),
    Utilities.Charset.UTF_8
  );

  return bytes.map(function(byte) {
    var value = byte;
    if (value < 0) {
      value += 256;
    }
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
}

function verifyPassword_(password, salt, expectedHash) {
  return hashPassword_(password, salt) === String(expectedHash || '');
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function isTruthy_(value) {
  if (value === true) {
    return true;
  }

  var normalizedValue = String(value || '').trim().toLowerCase();
  return normalizedValue === 'true' || normalizedValue === '1' || normalizedValue === 'yes' || normalizedValue === 'active';
}

function coerceSettingValue_(value, type) {
  if (type === 'number') {
    return Number(value);
  }
  if (type === 'boolean') {
    return isTruthy_(value);
  }
  if (type === 'json') {
    return safeJsonParse_(value, null);
  }
  return value;
}
