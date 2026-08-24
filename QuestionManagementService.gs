function getQuestionManagementData(authToken, workbookId) {
  var player = getCurrentPlayer_(authToken);
  var workbook = requireQuestionWorkbook_(workbookId);
  requireQuestionWorkbookOwner_(workbook, player);
  return {
    workbook: toClientObject_(workbook),
    currentPlayerId: String(player.playerId || ''),
    questions: readWorkbookQuestionTable_(workbook.workbookId).map(function(question) {
      return toClientObject_(question);
    }),
  };
}

function updateManagedQuestion(questionId, questionPayload, authToken, workbookId) {
  var player = getCurrentPlayer_(authToken);
  var workbook = requireQuestionWorkbook_(workbookId);
  requireQuestionWorkbookOwner_(workbook, player);
  var targetQuestionId = String(questionId || '').trim();
  if (!targetQuestionId) {
    throw new Error('수정할 문제를 찾을 수 없습니다.');
  }

  var existing = findWorkbookQuestionById_(workbook.workbookId, targetQuestionId);
  if (!existing) {
    throw new Error('문제를 찾을 수 없습니다.');
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
    approvedBy: existing.approvedBy || 'manager',
    approvedAt: existing.approvedAt || new Date(),
    updatedAt: new Date(),
  });
  clearWorkbookQuestionCache_(workbook.workbookId);
  return toClientObject_(updated);
}

function deleteManagedQuestion(questionId, authToken, workbookId) {
  var player = getCurrentPlayer_(authToken);
  var workbook = requireQuestionWorkbook_(workbookId);
  requireQuestionWorkbookOwner_(workbook, player);
  var targetQuestionId = String(questionId || '').trim();
  if (!targetQuestionId) {
    throw new Error('삭제할 문제를 찾을 수 없습니다.');
  }

  var sheet = getQuestionsSpreadsheet_().getSheetByName(workbook.questionSheetName);
  if (!sheet) {
    throw new Error('문제집 문제 시트를 찾을 수 없습니다.');
  }

  var headers = getHeaderRowAt_(sheet, 2);
  var questionIdIndex = headers.indexOf('questionId');
  if (questionIdIndex === -1) {
    throw new Error('문제 ID 열을 찾을 수 없습니다.');
  }

  var lastRow = sheet.getLastRow();
  var deleted = false;
  if (lastRow >= 3) {
    var values = sheet.getRange(3, questionIdIndex + 1, lastRow - 2, 1).getValues();
    for (var i = values.length - 1; i >= 0; i -= 1) {
      if (String(values[i][0] || '').trim() === targetQuestionId) {
        sheet.deleteRow(i + 3);
        deleted = true;
        break;
      }
    }
  }

  if (!deleted) {
    throw new Error('삭제할 문제를 찾을 수 없습니다.');
  }

  clearWorkbookQuestionCache_(workbook.workbookId);
  return { ok: true, questionId: targetQuestionId };
}

function requireQuestionWorkbookOwner_(workbook, player) {
  var ownerId = String(workbook && workbook.createdBy || '').trim();
  var playerId = String(player && player.playerId || '').trim();
  if (!ownerId || !playerId || ownerId !== playerId) {
    throw new Error('현재 문제집을 만든 사람만 문제를 관리할 수 있습니다.');
  }
}
