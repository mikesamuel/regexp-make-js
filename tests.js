// Using the subset of ES6 currently supported by FF Nightly 42.0a1 (2015-08-01)
// For full ES6:
// * replace "var" below with "let"

(function () {
  "use strict";

  function qpair(template, ...values) {
    return [template, values];
  }

  /** Python style raw strings. */
  function r(template, ...values) {
    if (values.length !== 0) {
      throw new Error(
	  'Interpolation not allowed into r`...` style raw strings');
    }
    return template.raw[0];
  }

  const tests = [
    // No interpolations
    [...qpair`^foo\(bar\);\n$`, '',
     r`/^foo\(bar\);\n$/`],
    // No interpolations but flags
    [...qpair`^foo\(bar\);\n$`, 'gi',
     r`/^foo\(bar\);\n$/gi`],
    // A single string into a block context.
    [...qpair`^${ 'foo' }$`, '',
     r`/^(?:foo)$/`],
    // Testing transitions between contexts.
    [...qpair`^([${ '\\' }${ /[a-z]/ }]{${ 42 }})${ /$/ }`, 'i',
     r`/^([\\a-z]{42})(?:$)/i`],
    // Back-reference not scoped to containing RegExp
    [...qpair`^(#+)([^#\r\n]*)${ /\1/ }`, '',
     '/^(#+)([^#\\r\\n]*)(?:\\1)/'],
    // Negated charset into a charset
    [...qpair`[${ /[^A-Z]/ }]`, '',
     r`/[\u0000-@\[-\uffff]/`],
    // String into a charset
    [...qpair`[${ "A-Z" }]`, '',
     r`/[A\-Z]/`],
    // String into a negated charset
    [...qpair`[^${ "A-Z" }]`, '',
     r`/[^A\-Z]/`],
    // Multiple elements into a charset: individual chars, charsets,
    // and special groups.
    [...qpair`[${ /[a]|([c]|b)|d|_/ }]`, '',
     r`/[_a-d]/`],
    // Multiple case-insensitive elements into a charset: individual chars,
    // charsets, and special groups.
    [...qpair`[${ /[a]|(?:[c]|b)|d|_/i }]`, '',
     r`/[A-D_a-d]/`],
    [...qpair`[${ /x{1,2}/ }]`, '',
     r`/[x]/`],
    // \b means different things.

    // TODO: interpolation of charset after - as in `[a-${...}]`
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
