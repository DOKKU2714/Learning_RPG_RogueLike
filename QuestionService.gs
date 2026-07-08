function createQuestion(questionPayload, authToken) {
  ensureQuestionSchemaColumns_();
  var player = getCurrentPlayer_(authToken);
  var normalizedPayload = normalizeQuestionPayload_(questionPayload);
  var now = new Date();
  var question = {
    questionId: generateId_('question'),
    type: normalizedPayload.type,
    prompt: normalizedPayload.prompt,
    choice1: normalizedPayload.choice1,
    choice2: normalizedPayload.choice2,
    choice3: normalizedPayload.choice3,
    choice4: normalizedPayload.choice4,
    answer: normalizedPayload.answer,
    answerAliases: safeJsonStringify_(normalizedPayload.answerAliases),
    explanation: normalizedPayload.explanation,
    difficulty: normalizedPayload.difficulty,
    creatorId: player.playerId,
    creatorName: player.displayName,
    subject: normalizedPayload.subject,
    unit: normalizedPayload.unit,
    tags: normalizedPayload.tags,
    status: STATUS.QUESTION_APPROVED,
    reviewComment: '',
    approvedBy: 'auto',
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
    correctCount: 0,
    totalCount: 0,
    likeCount: 0,
    dislikeCount: 0,
    reactionJson: '{}',
  };

  appendRowObject_(DB_SHEETS.QUESTIONS, question);
  clearTableCache_(DB_SHEETS.QUESTIONS);
  return toClientObject_(question);
}

function createQuestions(questionPayloads, authToken) {
  var payloads = Array.isArray(questionPayloads) ? questionPayloads : [];
  if (!payloads.length) {
    throw new Error('저장할 문제가 없습니다.');
  }
  return payloads.map(function(payload) {
    return createQuestion(payload, authToken);
  });
}

function importQuestionsFromRows(questionRows, authToken) {
  var rows = Array.isArray(questionRows) ? questionRows : [];
  if (!rows.length) {
    throw new Error('가져올 문제가 없습니다.');
  }

  var payloads = rows.map(function(row, index) {
    try {
      return normalizeQuestionImportRow_(row);
    } catch (error) {
      throw new Error((index + 2) + '행: ' + error.message);
    }
  });
  return createQuestions(payloads, authToken);
}

function getMyQuestions(authToken) {
  ensureQuestionSchemaColumns_();
  var player = getCurrentPlayer_(authToken);
  return getQuestionsByCreator_(player.playerId).map(toClientObject_);
}

function updateQuestion(questionId, questionPayload, authToken) {
  ensureQuestionSchemaColumns_();
  var player = getCurrentPlayer_(authToken);
  var targetQuestionId = String(questionId || '').trim();
  if (!targetQuestionId) {
    throw new Error('수정할 문제를 찾을 수 없습니다.');
  }

  var existing = findRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', targetQuestionId);
  if (!existing) {
    throw new Error('문제를 찾을 수 없습니다.');
  }
  if (String(existing.creatorId || '').trim() !== String(player.playerId || '').trim()) {
    throw new Error('본인이 만든 문제만 수정할 수 있습니다.');
  }

  var normalizedPayload = normalizeQuestionPayload_(questionPayload);
  var updated = updateRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', targetQuestionId, {
    type: normalizedPayload.type,
    prompt: normalizedPayload.prompt,
    choice1: normalizedPayload.choice1,
    choice2: normalizedPayload.choice2,
    choice3: normalizedPayload.choice3,
    choice4: normalizedPayload.choice4,
    answer: normalizedPayload.answer,
    answerAliases: safeJsonStringify_(normalizedPayload.answerAliases),
    explanation: normalizedPayload.explanation,
    difficulty: normalizedPayload.difficulty,
    subject: normalizedPayload.subject,
    unit: normalizedPayload.unit,
    tags: normalizedPayload.tags,
    status: STATUS.QUESTION_APPROVED,
    reviewComment: '',
    approvedBy: existing.approvedBy || 'auto',
    approvedAt: existing.approvedAt || new Date(),
    updatedAt: new Date(),
  });
  clearTableCache_(DB_SHEETS.QUESTIONS);
  return toClientObject_(updated);
}

function setQuestionReaction(questionId, reaction, authToken) {
  ensureQuestionSchemaColumns_();
  var player = getCurrentPlayer_(authToken);
  var targetQuestionId = String(questionId || '').trim();
  if (!targetQuestionId) {
    throw new Error('반응을 남길 문제를 찾을 수 없습니다.');
  }

  var normalizedReaction = normalizeQuestionReaction_(reaction);
  var question = findRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', targetQuestionId);
  if (!question) {
    throw new Error('문제를 찾을 수 없습니다.');
  }

  var reactions = safeJsonParse_(question.reactionJson, {});
  if (!reactions || Array.isArray(reactions) || typeof reactions !== 'object') {
    reactions = {};
  }

  var playerId = String(player.playerId || '').trim();
  var previousReaction = normalizeQuestionReaction_(reactions[playerId]);
  if (normalizedReaction) {
    reactions[playerId] = normalizedReaction;
  } else {
    delete reactions[playerId];
  }

  var likeCount = Number(question.likeCount || 0);
  var dislikeCount = Number(question.dislikeCount || 0);
  if (previousReaction === 'like') {
    likeCount -= 1;
  } else if (previousReaction === 'dislike') {
    dislikeCount -= 1;
  }
  if (normalizedReaction === 'like') {
    likeCount += 1;
  } else if (normalizedReaction === 'dislike') {
    dislikeCount += 1;
  }

  var updated = updateRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', targetQuestionId, {
    likeCount: Math.max(0, likeCount),
    dislikeCount: Math.max(0, dislikeCount),
    reactionJson: safeJsonStringify_(reactions) || '{}',
    updatedAt: new Date(),
  });
  clearTableCache_(DB_SHEETS.QUESTIONS);
  return {
    questionId: targetQuestionId,
    likeCount: Number(updated && updated.likeCount || 0),
    dislikeCount: Number(updated && updated.dislikeCount || 0),
    myReaction: normalizedReaction,
  };
}

function deleteQuestion(questionId, authToken) {
  ensureQuestionSchemaColumns_();
  var player = getCurrentPlayer_(authToken);
  var targetQuestionId = String(questionId || '').trim();
  if (!targetQuestionId) {
    throw new Error('삭제할 문제를 찾을 수 없습니다.');
  }

  var deleted = deleteQuestionByOwner_(targetQuestionId, player.playerId);
  if (!deleted) {
    throw new Error('문제를 찾을 수 없습니다.');
  }

  clearTableCache_(DB_SHEETS.QUESTIONS);
  return { ok: true, questionId: targetQuestionId };
}

function getPendingQuestions() {
  ensureQuestionSchemaColumns_();
  requireAdmin_();
  return readTable_(DB_SHEETS.QUESTIONS).filter(function(question) {
    return question.status === STATUS.QUESTION_PENDING;
  }).map(toClientObject_);
}

function approveQuestion(questionId, difficulty) {
  ensureQuestionSchemaColumns_();
  var adminEmail = requireAdmin_();
  var normalizedDifficulty = normalizeDifficulty_(difficulty);
  var question = findRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', questionId);
  if (!question) {
    throw new Error('문제를 찾을 수 없습니다.');
  }

  var updated = updateRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', questionId, {
    difficulty: normalizedDifficulty,
    status: STATUS.QUESTION_APPROVED,
    reviewComment: '',
    approvedBy: adminEmail,
    approvedAt: new Date(),
    updatedAt: new Date(),
  });
  clearTableCache_(DB_SHEETS.QUESTIONS);
  return toClientObject_(updated);
}

function rejectQuestion(questionId, reviewComment) {
  ensureQuestionSchemaColumns_();
  var adminEmail = requireAdmin_();
  var comment = String(reviewComment || '').trim();
  if (!comment) {
    throw new Error('반려 사유를 입력해 주세요.');
  }

  var question = findRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', questionId);
  if (!question) {
    throw new Error('문제를 찾을 수 없습니다.');
  }

  var updated = updateRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', questionId, {
    status: STATUS.QUESTION_REJECTED,
    reviewComment: comment,
    approvedBy: adminEmail,
    approvedAt: '',
    updatedAt: new Date(),
  });
  clearTableCache_(DB_SHEETS.QUESTIONS);
  return toClientObject_(updated);
}

function getQuestionsByCreator_(creatorId) {
  return readTable_(DB_SHEETS.QUESTIONS).filter(function(question) {
    return question.creatorId === creatorId;
  });
}

function deleteQuestionByOwner_(questionId, creatorId) {
  var sheet = getSheet_(DB_SHEETS.QUESTIONS);
  var headers = getHeaderRow_(sheet);
  var questionIdIndex = headers.indexOf('questionId');
  var creatorIdIndex = headers.indexOf('creatorId');
  if (questionIdIndex === -1 || creatorIdIndex === -1) {
    throw new Error('Questions 시트 구조를 확인해 주세요.');
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return false;
  }

  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (var i = 0; i < values.length; i += 1) {
    var rowQuestionId = String(values[i][questionIdIndex] || '').trim();
    if (rowQuestionId !== questionId) {
      continue;
    }
    var rowCreatorId = String(values[i][creatorIdIndex] || '').trim();
    if (rowCreatorId !== String(creatorId || '').trim()) {
      throw new Error('본인이 만든 문제만 삭제할 수 있습니다.');
    }
    sheet.deleteRow(i + 2);
    try {
      CacheService.getScriptCache().remove(getSheetRowNumberCacheKey_(DB_SHEETS.QUESTIONS, 'questionId', questionId));
    } catch (error) {}
    return true;
  }
  return false;
}

function normalizeQuestionPayload_(payload) {
  var source = payload || {};
  var type = source.type === QUESTION_TYPES.SHORT_ANSWER ? QUESTION_TYPES.SHORT_ANSWER : QUESTION_TYPES.MULTIPLE_CHOICE;
  var prompt = String(source.prompt || '').trim();
  var answer = String(source.answer || '').trim();

  if (!prompt) {
    throw new Error('문제 내용을 입력해 주세요.');
  }
  if (!answer) {
    throw new Error('정답을 입력해 주세요.');
  }

  var normalizedPayload = {
    type: type,
    prompt: prompt,
    choice1: '',
    choice2: '',
    choice3: '',
    choice4: '',
    answer: answer,
    answerAliases: splitList_(source.answerAliases),
    explanation: String(source.explanation || '').trim(),
    subject: String(source.subject || '').trim(),
    unit: String(source.unit || '').trim(),
    tags: splitList_(source.tags).join(', '),
    difficulty: normalizeDifficulty_(source.difficulty || GAME_RULES.MIN_DIFFICULTY),
  };

  if (type === QUESTION_TYPES.MULTIPLE_CHOICE) {
    var choices = source.choices || [];
    if (choices.length !== 4 || choices.some(function(choice) { return String(choice || '').trim() === ''; })) {
      throw new Error('객관식 문제는 선택지 4개를 모두 입력해야 합니다.');
    }

    normalizedPayload.choice1 = String(choices[0]).trim();
    normalizedPayload.choice2 = String(choices[1]).trim();
    normalizedPayload.choice3 = String(choices[2]).trim();
    normalizedPayload.choice4 = String(choices[3]).trim();
    normalizedPayload.answerAliases = [];
  }

  return normalizedPayload;
}

function normalizeDifficulty_(difficulty) {
  var numberValue = Number(difficulty);
  if (!Number.isInteger(numberValue) || numberValue < GAME_RULES.MIN_DIFFICULTY || numberValue > GAME_RULES.MAX_DIFFICULTY) {
    throw new Error('난이도는 1부터 5까지 지정해야 합니다.');
  }
  return numberValue;
}

function splitList_(value) {
  if (Array.isArray(value)) {
    return value.map(function(item) {
      return String(item || '').trim();
    }).filter(Boolean);
  }

  return String(value || '').split(/[\n,]/).map(function(item) {
    return item.trim();
  }).filter(Boolean);
}

function normalizeQuestionImportRow_(row) {
  var source = normalizeQuestionImportObject_(row || {});
  var rawType = String(source.type || '').trim();
  var type = normalizeQuestionImportType_(rawType);
  var choices = [
    source.choice1,
    source.choice2,
    source.choice3,
    source.choice4,
  ].map(function(choice) {
    return String(choice || '').trim();
  });

  return normalizeQuestionPayload_({
    type: type,
    prompt: source.prompt,
    choices: choices,
    answer: source.answer,
    answerAliases: source.answerAliases,
    explanation: source.explanation,
    subject: source.subject,
    unit: source.unit,
    tags: source.tags,
    difficulty: source.difficulty,
  });
}

function normalizeQuestionImportObject_(row) {
  var normalized = {};
  Object.keys(row || {}).forEach(function(key) {
    var field = getQuestionImportFieldKey_(key);
    if (field && normalized[field] === undefined) {
      normalized[field] = row[key];
    }
  });
  return normalized;
}

function getQuestionImportFieldKey_(key) {
  var normalizedKey = normalizeQuestionImportHeader_(key);
  var aliases = {
    type: 'type',
    questiontype: 'type',
    유형: 'type',
    문제유형: 'type',
    형식: 'type',
    prompt: 'prompt',
    question: 'prompt',
    problem: 'prompt',
    문제: 'prompt',
    문제내용: 'prompt',
    질문: 'prompt',
    보기1: 'choice1',
    선택지1: 'choice1',
    choice1: 'choice1',
    option1: 'choice1',
    보기2: 'choice2',
    선택지2: 'choice2',
    choice2: 'choice2',
    option2: 'choice2',
    보기3: 'choice3',
    선택지3: 'choice3',
    choice3: 'choice3',
    option3: 'choice3',
    보기4: 'choice4',
    선택지4: 'choice4',
    choice4: 'choice4',
    option4: 'choice4',
    answer: 'answer',
    correctanswer: 'answer',
    정답: 'answer',
    답: 'answer',
    answeraliases: 'answerAliases',
    aliases: 'answerAliases',
    복수정답: 'answerAliases',
    별칭: 'answerAliases',
    인정답: 'answerAliases',
    explanation: 'explanation',
    해설: 'explanation',
    설명: 'explanation',
    풀이: 'explanation',
    difficulty: 'difficulty',
    난이도: 'difficulty',
    subject: 'subject',
    과목: 'subject',
    unit: 'unit',
    단원: 'unit',
    tags: 'tags',
    tag: 'tags',
    태그: 'tags',
  };
  return aliases[normalizedKey] || '';
}

function normalizeQuestionImportHeader_(key) {
  return String(key || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()_\-./]/g, '');
}

function normalizeQuestionImportType_(type) {
  var value = String(type || '').trim().toLowerCase().replace(/\s+/g, '');
  var aliases = {
    multiplechoice: QUESTION_TYPES.MULTIPLE_CHOICE,
    choice: QUESTION_TYPES.MULTIPLE_CHOICE,
    객관식: QUESTION_TYPES.MULTIPLE_CHOICE,
    객관: QUESTION_TYPES.MULTIPLE_CHOICE,
    선다형: QUESTION_TYPES.MULTIPLE_CHOICE,
    shortanswer: QUESTION_TYPES.SHORT_ANSWER,
    short: QUESTION_TYPES.SHORT_ANSWER,
    주관식: QUESTION_TYPES.SHORT_ANSWER,
    단답형: QUESTION_TYPES.SHORT_ANSWER,
    서술형: QUESTION_TYPES.SHORT_ANSWER,
  };
  return aliases[value] || QUESTION_TYPES.MULTIPLE_CHOICE;
}

function normalizeQuestionReaction_(reaction) {
  var value = String(reaction || '').trim();
  if (value === 'like' || value === 'dislike') {
    return value;
  }
  return '';
}

function ensureQuestionSchemaColumns_() {
  var sheet = getSheet_(DB_SHEETS.QUESTIONS);
  var headers = getHeaderRow_(sheet);
  var existing = {};
  headers.forEach(function(header) {
    existing[header] = true;
  });
  var missing = DB_COLUMNS.QUESTIONS.filter(function(header) {
    return !existing[header];
  });
  if (!missing.length) {
    return headers;
  }

  if (sheet.getMaxColumns() < headers.length + missing.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length + missing.length - sheet.getMaxColumns());
  }
  sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
  clearTableCache_(DB_SHEETS.QUESTIONS);
  return headers.concat(missing);
}

function requireAdmin_() {
  var email = requireCurrentUserEmail_();
  if (!isAdmin(email)) {
    throw new Error('관리자만 접근할 수 있습니다.');
  }
  return email;
}
