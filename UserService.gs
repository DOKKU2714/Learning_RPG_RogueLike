function getCurrentUser(authToken) {
  var email = getCurrentUserEmail_();
  var player = authToken ? normalizePlayerAccountDefaults_(getPlayerByAuthToken_(authToken)) : null;

  return {
    email: email,
    isLoggedIn: !!player,
    isRegistered: !!player,
    isAdmin: isAdmin(email),
    player: toClientObject_(player),
    playerData: player ? getPlayerData(player.playerId) : null,
    activeWorkbooks: player && typeof getActiveWorkbooksForClient_ === 'function'
      ? getActiveWorkbooksForClient_()
      : [],
    startingScoreBonus: player && typeof getQuestionLikeStartingScoreSummary_ === 'function'
      ? getQuestionLikeStartingScoreSummary_(player.playerId)
      : { likeCount: 0, multiplier: 5, startingScore: 0 },
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
  var role = normalizeAccountRole_(payload.role);

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
    lastLoginAt: '',
    isActive: true,
    role: role,
    approvalStatus: 'pending',
    approvedBy: '',
    approvedAt: '',
    rejectedReason: '',
  };

  appendRowObject_(DB_SHEETS.PLAYERS, player);
  ensurePlayerData_(player.playerId);
  return {
    ok: true,
    approvalStatus: player.approvalStatus,
    message: '가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.',
  };
}

function loginPlayer(loginPayload) {
  requirePlayerAuthSchema_();
  var payload = loginPayload || {};
  var studentId = normalizeStudentId_(payload.studentId);
  var password = normalizePassword_(payload.password);
  var player = normalizePlayerAccountDefaults_(findPlayerByStudentId_(studentId));

  if (!player || !isTruthy_(player.isActive)) {
    throw new Error('등록된 학번을 찾을 수 없습니다.');
  }
  requireApprovedPlayerForLogin_(player);
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
  return toClientObject_(normalizePlayerAccountDefaults_(findPlayerByEmail_(email)));
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

var ADMIN_ALLOWED_EMAILS_ = Object.freeze(['forkboy159@gmail.com']);

function isAdmin(email) {
  var normalizedEmail = normalizeEmail_(email);
  if (!normalizedEmail) {
    return false;
  }

  return ADMIN_ALLOWED_EMAILS_.indexOf(normalizedEmail) !== -1;
}

function requireAdminUser_() {
  var email = requireCurrentUserEmail_();
  if (!isAdmin(email)) {
    throw new Error('관리자 권한이 필요합니다.');
  }
  return email;
}

function getPendingPlayerApprovals() {
  requireAdminUser_();
  requirePlayerAuthSchema_();
  return readTable_(DB_SHEETS.PLAYERS).map(normalizePlayerAccountDefaults_).filter(function(player) {
    return player.approvalStatus === 'pending';
  }).map(function(player) {
    return toClientObject_({
      playerId: player.playerId,
      studentId: player.studentId,
      studentName: player.studentName,
      displayName: player.displayName,
      role: player.role,
      approvalStatus: player.approvalStatus,
      createdAt: player.createdAt,
    });
  });
}

function approvePlayerRegistration(playerId) {
  var adminEmail = requireAdminUser_();
  requirePlayerAuthSchema_();
  var targetPlayerId = String(playerId || '').trim();
  if (!targetPlayerId) {
    throw new Error('승인할 계정을 찾을 수 없습니다.');
  }
  var player = findRowByKey_(DB_SHEETS.PLAYERS, 'playerId', targetPlayerId);
  if (!player) {
    throw new Error('승인할 계정을 찾을 수 없습니다.');
  }
  var updated = updateRowByKey_(DB_SHEETS.PLAYERS, 'playerId', targetPlayerId, {
    role: normalizeAccountRole_(player.role),
    approvalStatus: 'approved',
    approvedBy: adminEmail,
    approvedAt: new Date(),
    rejectedReason: '',
  });
  return toClientObject_(normalizePlayerAccountDefaults_(updated));
}

function rejectPlayerRegistration(playerId, rejectedReason) {
  requireAdminUser_();
  requirePlayerAuthSchema_();
  var targetPlayerId = String(playerId || '').trim();
  if (!targetPlayerId) {
    throw new Error('반려할 계정을 찾을 수 없습니다.');
  }
  var player = findRowByKey_(DB_SHEETS.PLAYERS, 'playerId', targetPlayerId);
  if (!player) {
    throw new Error('반려할 계정을 찾을 수 없습니다.');
  }
  var reason = String(rejectedReason || '').trim();
  var updated = updateRowByKey_(DB_SHEETS.PLAYERS, 'playerId', targetPlayerId, {
    role: normalizeAccountRole_(player.role),
    approvalStatus: 'rejected',
    approvedBy: '',
    approvedAt: '',
    rejectedReason: reason,
  });
  return toClientObject_(normalizePlayerAccountDefaults_(updated));
}

function getAppSettings() {
  var settingTypes = getDefaultSettingTypes_();
  var defaults = (typeof MASTER_SETTINGS !== 'undefined' ? MASTER_SETTINGS : []).reduce(function(settings, row) {
    var key = String(row.key || '').trim();
    if (key) {
      settings[key] = coerceSettingValue_(row.value, row.type);
    }
    return settings;
  }, {});
  return readTable_(DB_SHEETS.SETTINGS).reduce(function(settings, row) {
    var key = String(row.key || '').trim();
    if (key) {
      settings[key] = coerceSettingValue_(row.value, row.type || settingTypes[key] || '');
    }
    return settings;
  }, defaults);
}

function getDefaultSettingTypes_() {
  return (typeof MASTER_SETTINGS !== 'undefined' ? MASTER_SETTINGS : []).reduce(function(types, row) {
    var key = String(row.key || '').trim();
    if (key) {
      types[key] = String(row.type || '').trim();
    }
    return types;
  }, {});
}

function getAdminGameSettings() {
  requireAdminUser_();
  var settings = getAppSettings();
  return toClientObject_({
    gameEnabled: !!settings.gameEnabled,
    requireOwnQuestionForRunStart: settings.requireOwnQuestionForRunStart !== false,
  });
}

function updateAdminGameSettings(settingsPayload) {
  requireAdminUser_();
  var payload = settingsPayload || {};
  ensureTableColumns_(DB_SHEETS.SETTINGS, DB_COLUMNS.SETTINGS);
  upsertBooleanSetting_('gameEnabled', payload.gameEnabled, 'Whether students can start the game.');
  upsertBooleanSetting_(
    'requireOwnQuestionForRunStart',
    payload.requireOwnQuestionForRunStart,
    'Require the player to have created a workbook question before starting a new run.'
  );
  clearTableCache_(DB_SHEETS.SETTINGS);
  return getAdminGameSettings();
}

function upsertBooleanSetting_(key, value, description) {
  upsertRowByKey_(DB_SHEETS.SETTINGS, 'key', key, {
    key: key,
    value: value ? 'true' : 'false',
    type: 'boolean',
    description: description || '',
    updatedAt: new Date(),
  });
}

function getCurrentPlayer_(authToken) {
  var player = normalizePlayerAccountDefaults_(getPlayerByAuthToken_(authToken));
  if (!player) {
    throw new Error('먼저 학번과 비밀번호로 로그인해 주세요.');
  }
  return player;
}

function normalizePlayerAccountDefaults_(player) {
  if (!player) {
    return null;
  }
  return Object.assign({}, player, {
    role: String(player.role || '').trim() || 'student',
    approvalStatus: String(player.approvalStatus || '').trim() || 'approved',
    approvedBy: player.approvedBy || '',
    approvedAt: player.approvedAt || '',
    rejectedReason: player.rejectedReason || '',
  });
}

function requireApprovedPlayerForLogin_(player) {
  var approvalStatus = String(player && player.approvalStatus || '').trim() || 'approved';
  if (approvalStatus === 'approved') {
    return;
  }
  if (approvalStatus === 'pending') {
    throw new Error('관리자 승인 대기 중입니다.');
  }
  if (approvalStatus === 'rejected') {
    throw new Error('가입이 반려되었습니다.');
  }
  throw new Error('가입 승인 상태를 확인할 수 없습니다.');
}

function normalizeAccountRole_(role) {
  return String(role || '').trim() === 'teacher' ? 'teacher' : 'student';
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
  ensureTableColumns_(DB_SHEETS.PLAYERS, DB_COLUMNS.PLAYERS);
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
  ensureTableColumns_(DB_SHEETS.PLAYER_DATA, DB_COLUMNS.PLAYER_DATA);
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
    bestScore: 0,
    bestScoreRunId: '',
    bestScoreUpdatedAt: '',
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
