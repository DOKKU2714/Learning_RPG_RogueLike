function createQuestion(questionPayload, authToken) {
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
    status: STATUS.QUESTION_PENDING,
    reviewComment: '',
    approvedBy: '',
    approvedAt: '',
    createdAt: now,
    updatedAt: now,
    correctCount: 0,
    totalCount: 0,
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

function getMyQuestions(authToken) {
  var player = getCurrentPlayer_(authToken);
  return getQuestionsByCreator_(player.playerId).map(toClientObject_);
}

function deleteQuestion(questionId, authToken) {
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
  requireAdmin_();
  return readTable_(DB_SHEETS.QUESTIONS).filter(function(question) {
    return question.status === STATUS.QUESTION_PENDING;
  }).map(toClientObject_);
}

function approveQuestion(questionId, difficulty) {
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

function requireAdmin_() {
  var email = requireCurrentUserEmail_();
  if (!isAdmin(email)) {
    throw new Error('관리자만 접근할 수 있습니다.');
  }
  return email;
}
