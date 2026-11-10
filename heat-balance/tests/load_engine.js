/* Load the model engine from src/ as a Node module. */
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', 'src');
const code = 'const THERMO = ' + fs.readFileSync(path.join(src, 'thermo.json'), 'utf8') + ';\n' +
  fs.readFileSync(path.join(src, 'engine.js'), 'utf8') + '\nreturn FumeEngine;';
module.exports = new Function(code)();
