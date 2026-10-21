const JSONC = require('jsonc-parser');
// Append a property with last-match precedence without reformatting or dropping
// neighboring comments. jsonc-parser's default deletion can consume those comments.
function setLast(text, parentPath, name, value) {
  let root = JSONC.parseTree(text), parent = JSONC.findNodeAtLocation(root, parentPath);
  if (!parent || parent.type !== 'object') throw new Error('配置字段应为对象。');
  const properties = parent.children || [];
  const index = properties.findIndex(property => property.children[0].value === name);
  if (index >= 0) {
    const property = properties[index];
    const edits = [{ offset: property.offset, length: property.length, content: '' }];
    const findComma = (start, end) => {
      const scanner = JSONC.createScanner(text, false); scanner.setPosition(start);
      while (scanner.scan() !== JSONC.SyntaxKind.EOF && scanner.getTokenOffset() < end) {
        if (scanner.getToken() === JSONC.SyntaxKind.CommaToken) return scanner.getTokenOffset();
      }
      return -1;
    };
    let comma = findComma(property.offset + property.length, index < properties.length - 1 ? properties[index + 1].offset : parent.offset + parent.length - 1);
    if (comma < 0 && index > 0) comma = findComma(properties[index - 1].offset + properties[index - 1].length, property.offset);
    if (comma >= 0) edits.push({ offset: comma, length: 1, content: '' });
    text = JSONC.applyEdits(text, edits);
  }
  root = JSONC.parseTree(text); parent = JSONC.findNodeAtLocation(root, parentPath);
  const last = parent.children?.at(-1);
  if (last) {
    const start = last.offset + last.length, end = parent.offset + parent.length - 1;
    const scanner = JSONC.createScanner(text, false); scanner.setPosition(start);
    let comma = false;
    while (scanner.scan() !== JSONC.SyntaxKind.EOF && scanner.getTokenOffset() < end) if (scanner.getToken() === JSONC.SyntaxKind.CommaToken) comma = true;
    if (!comma) text = text.slice(0, start) + ',' + text.slice(start);
  }
  root = JSONC.parseTree(text); parent = JSONC.findNodeAtLocation(root, parentPath);
  const end = parent.offset + parent.length - 1;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indent = '  '.repeat(parentPath.length + 1);
  const serialized = JSON.stringify(value, null, 2).replaceAll('\n', eol + indent);
  return text.slice(0, end) + `${eol}${indent}${JSON.stringify(name)}: ${serialized}${eol}${indent.slice(0, -2)}` + text.slice(end);
}
module.exports = { setLast };
