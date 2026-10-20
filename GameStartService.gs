// Loading tips are editable data, independent of combat snapshots and rules.
function getGameStartTips() {
  var sheet = getSpreadsheet_().getSheetByName(DB_SHEETS.LOADING_TIPS);
  if (!sheet) return [];
  return readTable_(DB_SHEETS.LOADING_TIPS).filter(function(row) {
    return row.tipId && String(row.text || '').trim() && isTruthy_(row.active);
  }).sort(function(a,b) {
    return Number(a.sortOrder || 0)-Number(b.sortOrder || 0) || String(a.tipId).localeCompare(String(b.tipId));
  }).map(function(row) {
    return { tipId:String(row.tipId), text:String(row.text) };
  });
}
