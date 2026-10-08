const fs = require('node:fs');
const vm = require('node:vm');

// HtmlService keeps viewport metadata on HtmlOutput, separately from template HTML.
function renderOutput(page) {
  let templateFile;
  const output = {
    metaTags: [], appended: [],
    setTitle(title) { this.title = title; return this; },
    addMetaTag(name, content) { this.metaTags.push({ name, content }); return this; },
    setXFrameOptionsMode(mode) { this.frameMode = mode; return this; },
    append(content) { this.appended.push(content); return this; },
  };
  const c = vm.createContext({ HtmlService: {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    createTemplateFromFile(file) { templateFile = file; return { evaluate: () => output }; },
    createHtmlOutputFromFile: file => ({ getContent: () => file }),
  }});
  vm.runInContext(fs.readFileSync('WebApp.gs', 'utf8'), c);
  const result = c.doGet({ parameter: { page } });
  return { output: result, templateFile };
}

module.exports = { renderOutput };
