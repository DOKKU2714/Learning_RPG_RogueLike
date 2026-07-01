function toClientObject_(object) {
  if (!object) {
    return null;
  }

  return Object.keys(object).reduce(function(result, key) {
    result[key] = toClientValue_(object[key]);
    return result;
  }, {});
}

function toClientValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  }
  return value;
}
