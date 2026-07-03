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
    index: { file: 'Index', title: 'Learning Roguelike' },
    question: { file: 'QuestionForm', title: 'Question Form' },
    mypage: { file: 'MyPage', title: 'My Page' },
    admin: { file: 'Admin', title: 'Admin' },
    battle: { file: 'Battle', title: 'Battle' },
    leaderboard: { file: 'Leaderboard', title: 'Leaderboard' },
  };

  return routes[page] || routes.index;
}

function getWebAppUrl_() {
  return ScriptApp.getService().getUrl();
}

function getAssetBaseUrl_() {
  return String((typeof CONFIG !== 'undefined' && CONFIG.ASSET_BASE_URL) || '').replace(/\/+$/, '');
}

function getAssetUrl_(path) {
  var baseUrl = getAssetBaseUrl_();
  var normalizedPath = String(path || '').replace(/^\/+/, '');
  return baseUrl && normalizedPath ? baseUrl + '/' + normalizedPath : '';
}

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
