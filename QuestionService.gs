var QUESTION_TEXT_LIMITS_ = Object.freeze({
  prompt: 200,
  choice: 60,
  answer: 80,
  answerAliases: 200,
  explanation: 300,
  subject: 40,
  unit: 40,
  tags: 80,
});

function createQuestion(questionPayload, authToken, workbookId) {
  var player = getCurrentPlayer_(authToken);
  var workbook = requireQuestionWorkbook_(workbookId);
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

  appendWorkbookQuestion_(workbook.workbookId, question);
  return toClientObject_(question);
}

function createQuestions(questionPayloads, authToken, workbookId) {
  var payloads = Array.isArray(questionPayloads) ? questionPayloads : [];
  if (!payloads.length) {
    throw new Error('저장할 문제가 없습니다.');
  }
  var player = getCurrentPlayer_(authToken);
  var workbook = requireQuestionWorkbook_(workbookId);
  var now = new Date();
  var questions = payloads.map(function(payload, index) {
    var normalizedPayload;
    try {
      normalizedPayload = normalizeQuestionPayload_(payload);
    } catch (error) {
      throw new Error((index + 1) + '번째 문제: ' + error.message);
    }
    return {
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
  });
  return appendWorkbookQuestions_(workbook.workbookId, questions).map(toClientObject_);
}

function importQuestionsFromRows(questionRows, authToken, workbookId) {
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
  return createQuestions(payloads, authToken, workbookId);
}

function getMyQuestions(authToken, workbookId) {
  var player = getCurrentPlayer_(authToken);
  var workbook = requireQuestionWorkbook_(workbookId);
  return getWorkbookQuestionsByCreatorForQuestionService_(workbook.workbookId, player.playerId).map(toClientObject_);
}

function updateQuestion(questionId, questionPayload, authToken, workbookId) {
  var player = getCurrentPlayer_(authToken);
  var workbook = requireQuestionWorkbook_(workbookId);
  var targetQuestionId = String(questionId || '').trim();
  if (!targetQuestionId) {
    throw new Error('수정할 문제를 찾을 수 없습니다.');
  }

  var existing = findWorkbookQuestionById_(workbook.workbookId, targetQuestionId);
  if (!existing) {
    throw new Error('문제를 찾을 수 없습니다.');
  }
  if (String(existing.creatorId || '').trim() !== String(player.playerId || '').trim()) {
    throw new Error('본인이 만든 문제만 수정할 수 있습니다.');
  }

  var normalizedPayload = normalizeQuestionPayload_(questionPayload);
  var updated = updateWorkbookQuestionById_(workbook.workbookId, targetQuestionId, {
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
  return toClientObject_(updated);
}

function setQuestionReaction(questionId, reaction, authToken, runId) {
  var player = getCurrentPlayer_(authToken);
  var targetQuestionId = String(questionId || '').trim();
  if (!targetQuestionId) {
    throw new Error('반응을 남길 문제를 찾을 수 없습니다.');
  }

  var normalizedReaction = normalizeQuestionReaction_(reaction);
  if (!normalizedReaction) {
    throw new Error('좋아요 또는 싫어요를 선택해 주세요.');
  }

  var lock = null;
  try {
    if (typeof LockService !== 'undefined') {
      lock = LockService.getScriptLock();
      lock.waitLock(5000);
    }
    return setQuestionReactionLocked_(targetQuestionId, normalizedReaction, player, runId);
  } finally {
    if (lock) {
      try {
        lock.releaseLock();
      } catch (error) {}
    }
  }
}

function setQuestionReactionLocked_(targetQuestionId, normalizedReaction, player, runId) {
  var run = getReactionRunForQuestion_(runId, player);
  var location = run ? null : findWorkbookQuestionLocationById_(targetQuestionId);
  var workbookId = run ? getRunWorkbookContext_(run).workbookId : String(location && location.workbookId || '');
  var question = run ? findRunQuestionById_(run, targetQuestionId) : location && location.question;
  if (!question) {
    throw new Error('문제를 찾을 수 없습니다.');
  }

  var reactions = safeJsonParse_(question.reactionJson, {});
  if (!reactions || Array.isArray(reactions) || typeof reactions !== 'object') {
    reactions = {};
  }

  var playerId = String(player.playerId || '').trim();
  var previousReaction = normalizeQuestionReaction_(reactions[playerId]);
  if (previousReaction) {
    return {
      questionId: targetQuestionId,
      likeCount: Number(question.likeCount || 0),
      dislikeCount: Number(question.dislikeCount || 0),
      myReaction: previousReaction,
      alreadyReacted: true,
      scoreDelta: 0,
      totalScore: getQuestionReactionRunScore_(runId, playerId),
    };
  }

  reactions[playerId] = normalizedReaction;

  var likeCount = Number(question.likeCount || 0);
  var dislikeCount = Number(question.dislikeCount || 0);
  if (normalizedReaction === 'like') {
    likeCount += 1;
  } else if (normalizedReaction === 'dislike') {
    dislikeCount += 1;
  }

  var patch = {
    likeCount: Math.max(0, likeCount),
    dislikeCount: Math.max(0, dislikeCount),
    reactionJson: safeJsonStringify_(reactions) || '{}',
    updatedAt: new Date(),
  };
  var updated = updateWorkbookQuestionById_(workbookId, targetQuestionId, patch);
  clearWorkbookQuestionCache_(workbookId);
  var scoreResult = awardQuestionReactionScore_(runId, playerId);
  return {
    questionId: targetQuestionId,
    likeCount: Number(updated && updated.likeCount || 0),
    dislikeCount: Number(updated && updated.dislikeCount || 0),
    myReaction: normalizedReaction,
    alreadyReacted: false,
    scoreDelta: Number(scoreResult.scoreDelta || 0),
    totalScore: Number(scoreResult.totalScore || 0),
  };
}

function getReactionRunForQuestion_(runId, player) {
  var targetRunId = String(runId || '').trim();
  if (!targetRunId) {
    return null;
  }
  var run = requireRun_(targetRunId);
  if (!run || String(run.playerId || '') !== String(player && player.playerId || '') || run.status !== STATUS.RUN_ACTIVE) {
    throw new Error('진행 중인 전투의 문제만 평가할 수 있습니다.');
  }
  return run;
}

function awardQuestionReactionScore_(runId, playerId) {
  var targetRunId = String(runId || '').trim();
  if (!targetRunId || typeof awardRunScore_ !== 'function') {
    return { scoreDelta: 0, totalScore: 0 };
  }
  var run = findRowByKey_(DB_SHEETS.RUNS, 'runId', targetRunId);
  if (!run || String(run.playerId || '') !== String(playerId || '') || run.status !== STATUS.RUN_ACTIVE) {
    return { scoreDelta: 0, totalScore: Number(run && run.score || 0) };
  }
  var awardResult = awardRunScore_(targetRunId, 10);
  recordQuestionReactionScoreForRun_(run, 10);
  return awardResult;
}

function recordQuestionReactionScoreForRun_(run, scoreDelta) {
  var delta = Number(scoreDelta || 0);
  if (!run || !run.runId || delta <= 0) {
    return;
  }
  var stageState = safeJsonParse_(run.stageStateJson, {});
  var battleState = stageState.battle || {};
  var battleId = String(battleState.battleId || '');
  if (!battleId) {
    return;
  }
  stageState.scoreState = stageState.scoreState || {};
  if (stageState.scoreState.questionReactionScoreBattleId && stageState.scoreState.questionReactionScoreBattleId !== battleId) {
    stageState.scoreState.questionReactionScore = 0;
  }
  stageState.scoreState.questionReactionScoreBattleId = battleId;
  stageState.scoreState.questionReactionScore = Number(stageState.scoreState.questionReactionScore || 0) + delta;
  battleState.questionReactionScoreState = {
    battleId: battleId,
    score: Number(stageState.scoreState.questionReactionScore || 0),
  };
  stageState.battle = battleState;
  updateRowByKey_(DB_SHEETS.RUNS, 'runId', run.runId, {
    stageStateJson: safeJsonStringify_(stageState),
    updatedAt: new Date(),
  });
}

function getQuestionReactionRunScore_(runId, playerId) {
  var targetRunId = String(runId || '').trim();
  if (!targetRunId) {
    return 0;
  }
  var run = findRowByKey_(DB_SHEETS.RUNS, 'runId', targetRunId);
  if (!run || String(run.playerId || '') !== String(playerId || '')) {
    return 0;
  }
  return Number(run.score || 0);
}

function deleteQuestion(questionId, authToken, workbookId) {
  var player = getCurrentPlayer_(authToken);
  var workbook = requireQuestionWorkbook_(workbookId);
  var targetQuestionId = String(questionId || '').trim();
  if (!targetQuestionId) {
    throw new Error('삭제할 문제를 찾을 수 없습니다.');
  }

  var deleted = deleteWorkbookQuestionByOwner_(workbook.workbookId, targetQuestionId, player.playerId);
  if (!deleted) {
    throw new Error('문제를 찾을 수 없습니다.');
  }

  return { ok: true, questionId: targetQuestionId };
}

function getPendingQuestions(workbookId) {
  requireAdmin_();
  var workbook = requireQuestionWorkbook_(workbookId);
  return readWorkbookQuestionTable_(workbook.workbookId).filter(function(question) {
    return question.status === STATUS.QUESTION_PENDING;
  }).map(function(question) {
    return toClientObject_(Object.assign({}, question, {
      workbookId: workbook.workbookId,
      workbookName: workbook.workbookName || workbook.workbookId,
    }));
  });
}

function approveQuestion(questionId, difficulty, workbookId) {
  var adminEmail = requireAdmin_();
  var workbook = requireQuestionWorkbook_(workbookId);
  var normalizedDifficulty = normalizeDifficulty_(difficulty);
  var question = findWorkbookQuestionById_(workbook.workbookId, questionId);
  if (!question) {
    throw new Error('문제를 찾을 수 없습니다.');
  }

  var updated = updateWorkbookQuestionById_(workbook.workbookId, questionId, {
    difficulty: normalizedDifficulty,
    status: STATUS.QUESTION_APPROVED,
    reviewComment: '',
    approvedBy: adminEmail,
    approvedAt: new Date(),
    updatedAt: new Date(),
  });
  return toClientObject_(updated);
}

function rejectQuestion(questionId, reviewComment, workbookId) {
  var adminEmail = requireAdmin_();
  var workbook = requireQuestionWorkbook_(workbookId);
  var comment = String(reviewComment || '').trim();
  if (!comment) {
    throw new Error('반려 사유를 입력해 주세요.');
  }

  var question = findWorkbookQuestionById_(workbook.workbookId, questionId);
  if (!question) {
    throw new Error('문제를 찾을 수 없습니다.');
  }

  var updated = updateWorkbookQuestionById_(workbook.workbookId, questionId, {
    status: STATUS.QUESTION_REJECTED,
    reviewComment: comment,
    approvedBy: adminEmail,
    approvedAt: '',
    updatedAt: new Date(),
  });
  return toClientObject_(updated);
}

function getQuestionsByCreator_(creatorId) {
  var targetCreatorId = String(creatorId || '').trim();
  return readAllActiveWorkbookQuestions_().filter(function(question) {
    return String(question.creatorId || '').trim() === targetCreatorId;
  });
}

function getWorkbookQuestionsByCreatorForQuestionService_(workbookId, creatorId) {
  var targetCreatorId = String(creatorId || '').trim();
  return readWorkbookQuestionTable_(workbookId).filter(function(question) {
    return String(question.creatorId || '').trim() === targetCreatorId;
  });
}

function requireQuestionWorkbook_(workbookId) {
  var targetWorkbookId = String(workbookId || '').trim();
  if (!targetWorkbookId) {
    throw new Error('문제집을 먼저 선택해 주세요.');
  }
  var workbook = requireWorkbook_(targetWorkbookId);
  if (String(workbook.status || STATUS.WORKBOOK_ACTIVE) !== STATUS.WORKBOOK_ACTIVE) {
    throw new Error('활성 상태인 문제집만 사용할 수 있습니다.');
  }
  ensureWorkbookQuestionSheet_(workbook);
  return workbook;
}

function calculateQuestionLikeStartingScore_(playerId) {
  return getQuestionLikeStartingScoreSummary_(playerId).startingScore;
}

function getQuestionLikeStartingScoreSummary_(playerId) {
  var questions = getQuestionsByCreator_(playerId);
  var questionCount = questions.length;
  var likeCount = questions.reduce(function(total, question) {
    return total + Math.max(0, Number(question.likeCount || 0));
  }, 0);
  var multiplier = 5;
  var questionScore = questionCount * multiplier;
  var likeScore = likeCount * multiplier;
  return {
    questionCount: questionCount,
    likeCount: likeCount,
    multiplier: multiplier,
    questionScore: questionScore,
    likeScore: likeScore,
    startingScore: questionScore + likeScore,
  };
}

function deleteQuestionByOwner_(questionId, creatorId) {
  var location = findWorkbookQuestionLocationById_(questionId);
  return location
    ? deleteWorkbookQuestionByOwner_(location.workbookId, questionId, creatorId)
    : false;
}

function normalizeQuestionPayload_(payload) {
  var source = payload || {};
  var type = source.type === QUESTION_TYPES.SHORT_ANSWER ? QUESTION_TYPES.SHORT_ANSWER : QUESTION_TYPES.MULTIPLE_CHOICE;
  var prompt = limitQuestionText_('문제 내용', source.prompt, QUESTION_TEXT_LIMITS_.prompt).trim();
  var answer = limitQuestionText_('정답', source.answer, QUESTION_TEXT_LIMITS_.answer).trim();

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
    answerAliases: splitList_(limitQuestionText_('복수 정답 / 별칭', source.answerAliases, QUESTION_TEXT_LIMITS_.answerAliases)),
    explanation: limitQuestionText_('해설', source.explanation, QUESTION_TEXT_LIMITS_.explanation).trim(),
    subject: limitQuestionText_('과목', source.subject, QUESTION_TEXT_LIMITS_.subject).trim(),
    unit: limitQuestionText_('단원', source.unit, QUESTION_TEXT_LIMITS_.unit).trim(),
    tags: splitList_(limitQuestionText_('태그', source.tags, QUESTION_TEXT_LIMITS_.tags)).join(', '),
    difficulty: normalizeDifficulty_(source.difficulty || GAME_RULES.MIN_DIFFICULTY),
  };

  if (type === QUESTION_TYPES.MULTIPLE_CHOICE) {
    var choices = Array.isArray(source.choices)
      ? source.choices
      : [source.choice1, source.choice2, source.choice3, source.choice4];
    if (choices.length !== 4 || choices.some(function(choice) { return String(choice || '').trim() === ''; })) {
      throw new Error('객관식 문제는 선택지 4개를 모두 입력해야 합니다.');
    }

    normalizedPayload.choice1 = limitQuestionText_('선택지 1', choices[0], QUESTION_TEXT_LIMITS_.choice).trim();
    normalizedPayload.choice2 = limitQuestionText_('선택지 2', choices[1], QUESTION_TEXT_LIMITS_.choice).trim();
    normalizedPayload.choice3 = limitQuestionText_('선택지 3', choices[2], QUESTION_TEXT_LIMITS_.choice).trim();
    normalizedPayload.choice4 = limitQuestionText_('선택지 4', choices[3], QUESTION_TEXT_LIMITS_.choice).trim();
    if (!/^[1-4]$/.test(normalizedPayload.answer)) {
      throw new Error('객관식 정답을 선택해 주세요.');
    }
    normalizedPayload.answerAliases = [];
  }

  return normalizedPayload;
}

function limitQuestionText_(label, value, maxLength) {
  var text = String(value || '');
  var max = Number(maxLength || 0);
  if (max > 0 && text.length > max) {
    throw new Error(label + '은(는) ' + max + '자 이내로 입력해 주세요.');
  }
  return text;
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
  var stableAliases = getStableQuestionImportHeaderAliases_();
  if (stableAliases[normalizedKey]) {
    return stableAliases[normalizedKey];
  }
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

function getStableQuestionImportHeaderAliases_() {
  var aliases = {};
  function add(headers, field) {
    headers.forEach(function(header) {
      aliases[normalizeQuestionImportHeader_(header)] = field;
    });
  }

  add(['type', 'questionType', '유형', '문제유형', '문제 유형', '형식'], 'type');
  add(['prompt', 'question', 'problem', '문제', '문제내용', '문제 내용', '질문', '문항'], 'prompt');
  add(['choice1', 'option1', '보기1', '보기 1', '선택지1', '선택지 1'], 'choice1');
  add(['choice2', 'option2', '보기2', '보기 2', '선택지2', '선택지 2'], 'choice2');
  add(['choice3', 'option3', '보기3', '보기 3', '선택지3', '선택지 3'], 'choice3');
  add(['choice4', 'option4', '보기4', '보기 4', '선택지4', '선택지 4'], 'choice4');
  add(['answer', 'correctAnswer', '정답', '답', '정답번호', '정답 번호'], 'answer');
  add(['answerAliases', 'aliases', '복수정답', '복수 정답', '별칭', '인정답안', '인정 답안'], 'answerAliases');
  add(['explanation', '해설', '설명', '풀이'], 'explanation');
  add(['difficulty', '난이도', '문제난이도', '문제 난이도'], 'difficulty');
  add(['subject', '과목'], 'subject');
  add(['unit', '단원'], 'unit');
  add(['tags', 'tag', '태그'], 'tags');
  return aliases;
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
  var stableAliases = {};
  stableAliases[normalizeQuestionImportHeader_('객관식')] = QUESTION_TYPES.MULTIPLE_CHOICE;
  stableAliases[normalizeQuestionImportHeader_('선택형')] = QUESTION_TYPES.MULTIPLE_CHOICE;
  stableAliases[normalizeQuestionImportHeader_('multipleChoice')] = QUESTION_TYPES.MULTIPLE_CHOICE;
  stableAliases[normalizeQuestionImportHeader_('주관식')] = QUESTION_TYPES.SHORT_ANSWER;
  stableAliases[normalizeQuestionImportHeader_('단답형')] = QUESTION_TYPES.SHORT_ANSWER;
  stableAliases[normalizeQuestionImportHeader_('서술형')] = QUESTION_TYPES.SHORT_ANSWER;
  stableAliases[normalizeQuestionImportHeader_('shortAnswer')] = QUESTION_TYPES.SHORT_ANSWER;
  if (stableAliases[value]) {
    return stableAliases[value];
  }
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

function requireAdmin_() {
  var email = requireCurrentUserEmail_();
  if (!isAdmin(email)) {
    throw new Error('관리자만 접근할 수 있습니다.');
  }
  return email;
}
