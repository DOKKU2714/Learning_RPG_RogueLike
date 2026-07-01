function createQuestion(questionPayload, authToken) {
  var player = getCurrentPlayer_(authToken);
  var myQuestions = getQuestionsByCreator_(player.playerId);
  if (myQuestions.length >= 10) {
    throw new Error('문제는 최대 10개까지 만들 수 있습니다.');
  }

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
    difficulty: '',
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

function getMyQuestions(authToken) {
  var player = getCurrentPlayer_(authToken);
  return getQuestionsByCreator_(player.playerId).map(toClientObject_);
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
  }

  return normalizedPayload;
}

function normalizeDifficulty_(difficulty) {
  var numberValue = Number(difficulty);
  if (!Number.isInteger(numberValue) || numberValue < GAME_RULES.MIN_DIFFICULTY || numberValue > GAME_RULES.MAX_DIFFICULTY) {
    throw new Error('난이도는 1부터 10까지 지정해야 합니다.');
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
