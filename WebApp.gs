function doGet(e) {
  var page = ((e && e.parameter && e.parameter.page) || 'index').toLowerCase();
  var route = getRoute_(page);

  return HtmlService.createTemplateFromFile(route.file)
    .evaluate()
    .setTitle(route.title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getRoute_(page) {
  var routes = {
    index: { file: 'Index', title: '학습 로그라이크' },
    question: { file: 'QuestionForm', title: '문제 만들기' },
    admin: { file: 'Admin', title: '문제 승인 관리' },
    battle: { file: 'Battle', title: '전투' },
  };

  return routes[page] || routes.index;
}

function getWebAppUrl_() {
  return ScriptApp.getService().getUrl();
}

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
