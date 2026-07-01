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
  if (value === null || value === undefined) {
    return value;
  }
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  }
  if (Array.isArray(value)) {
    return value.map(function(item) {
      return toClientValue_(item);
    });
  }
  if (typeof value === 'object') {
    return toClientObject_(value);
  }
  return value;
}
