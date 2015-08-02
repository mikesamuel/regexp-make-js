// Using the subset of ES6 currently supported by FF Nightly 42.0a1 (2015-08-01)
// For full ES6:
// * replace "var" below with "let"

(function () {
  "use strict";

  function qpair(template, ...values) {
    return [template, values];
  }

  const tests = [
    [...qpair`^${ 'foo' }$`, '',
     '/^(?:foo)$/'],
    [...qpair`^([${ '\\' }${ /[a-z]/ }]{${ 42 }})${ /$/ }`, 'i',
     '/^([\\\\a-z]{42})(?:$)/i'],
    // See above for why this says "\$${" rather than "\${"
    [...qpair`^(#+)([^#\r\n]*)${ /\1/ }`, '',
     '/^(#+)([^#\\r\\n]*)(?:\\1)/'],
  ];

  function el(name, parent, opt_text) {
    const elem = document.createElement(name);
    parent.appendChild(elem);
    if (opt_text) {
      elem.appendChild(document.createTextNode(opt_text));
    }
    return elem;
  }

  function stringify(arr) {
    var s = '';
    s += '[';
    for (var i = 0, n = arr.length; i < n; ++i) {
      if (i) { s += ', '; }
      const x = arr[i];
      if (x && 'object' === typeof x) {
        s += x;
      } else {
        s += JSON.stringify(x);
      }
    }
    s += ']';
    return s;
  }

  const table = el('table', document.body);
  var tr = el('tr', el('thead', table));
  el('th', tr, 'string parts');
  el('th', tr, 'values');
  el('th', tr, 'expected');
  el('th', tr, 'output');
  const tbody = el('tbody', table);
  for (var i = 0, n = tests.length; i < n; ++i) {
    const [template, values, flags, expected] = tests[i];
    tr = el('tr', tbody);
    el('td', tr, JSON.stringify(template.raw));
    el('td', tr, stringify(values));
    el('td', tr, expected);
    const maker = flags ? RegExp.make(flags) : RegExp.make;
    const got = maker(template, ...values).toString();
    el('td', tr, got);
    tr.className += ' ' + (got === expected ? 'pass' : 'fail');
  }
}());
