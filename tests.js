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
     r`/^([\\a-z]{42})(?:$)/i`, [0, 1]],
    // Back-reference not scoped to containing RegExp
    [...qpair`^(#+)([^#\r\n]*)${ /\1/ }`, '',
     // Can't use r`...` since \1 triggers an octal-escape strict parse error.
     '/^(#+)([^#\\r\\n]*)(?:\\1)/', [0, 1, 2]],
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
    // {1,2} does not contribute chars.
    [...qpair`[${ /x{1,2}/ }]`, '',
     r`/[x]/`],
    // Rewrite group indices.
    [
      //...qpair`(fo(o))${ /(x)\1(?:\2)/ }bar${ /\1/ }(baz)`,  // Octal escapes error
      { raw: ['(fo(o))', 'bar', '(baz)'] },
      [/(x)\1(?:\2)/, /\1/],
      '',
      '/(fo(o))(?:(x)\\3(?:\\2))bar(?:\\1)(baz)/',
      // Group 3 -^ comes from an interpolated group.
      [0, 1, 2, 4]
    ],
    // Rewrite template back-references when interrupted.
    [
      //...qpair`^(${ /(.*)/ }\n(#+)\n${ /(.*)/ }\n\2)\n`,
      { raw: ['^(',         '\\n(#+)\\n',         '\\n\\2)\\n'] },
      [             /(.*)/,               /(.*)/],
      //      0 1               2                                 <- Template groups
      //      0 1   2           3          4                      <- Output groups
      '',
      '/^((?:(.*))\\n(#+)\\n(?:(.*))\\n\\3)\\n/',
      [0, 1, 3]
    ],
    // Test that interpolations break tokens.
    // ($x?:x) should not run together into (?:x) when x is empty.
    [...qpair`(${""}?:x)`, '',
     '/((?:)?:x)/', [0, 1]],
    [...qpair`(${new RegExp('')}?:x)`, '',
     '/((?:(?:))?:x)/', [0, 1]],
    // TODO: Write test to check that \b means different things.
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

  function markPassFail(passed, el) {
    el.className += (passed ? ' pass' : ' fail');
  }

  const table = el('table', document.body);
  var tr = el('tr', el('thead', table));
  el('th', tr, 'string parts');
  el('th', tr, 'values');
  el('th', tr, 'expected pattern');
  el('th', tr, 'expected groups');
  tr = el('tr', el('thead', table));
  el('th', tr);
  el('th', tr);
  el('th', tr, 'actual pattern');
  el('th', tr, 'actual groups');
  const tbody = el('tbody', table);
  for (var i = 0, n = tests.length; i < n; ++i) {
    const [
      template, values, flags, expectedPattern, expectedGroupsOpt
    ] = tests[i];
    const expectedGroups = expectedGroupsOpt || [0];

    const maker = flags ? RegExp.make(flags) : RegExp.make;
    const re = maker(template, ...values);
    const actualPattern = re.toString();
    const actualGroups = re.templateGroups;

    const passPattern = actualPattern === expectedPattern;
    const passGroups = expectedGroups.join(' ') === actualGroups.join(' ');
    const passAll = passPattern && passGroups;

    tr = el('tr', tbody);
    el('td', tr, JSON.stringify(template.raw)).setAttribute('rowspan', 2);
    el('td', tr, stringify(values)).setAttribute('rowspan', 2);
    el('td', tr, expectedPattern);
    el('td', tr, expectedGroups.join(' '));

    // Position the actual values below the wanted for easy scanning.
    const trActual = el('tr', tbody);
    const actualPatternTd = el('td', trActual, actualPattern);
    const actualGroupsTd = el('td', trActual, actualGroups.join(' '));

    markPassFail(passPattern, actualPatternTd);
    markPassFail(passGroups, actualGroupsTd);
    markPassFail(passAll, tr);
    markPassFail(passAll, trActual);
  }
}());
