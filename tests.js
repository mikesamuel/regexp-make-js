// Using the subset of ES6 currently supported by FF Nightly 42.0a1 (2015-08-01)
// For full ES6:
// * replace "var" below with "let"

(function () {
  "use strict";

  if (typeof RegExp.make !== 'function') {
    return;
  }

  // Set up a RegExp subclass so that we can test subclass creation.
  function SubRegExp(source, flags) {
    const re = new RegExp(source, flags);
    Object.setPrototypeOf(re, SubRegExp.prototype);
    return re;
  }
  SubRegExp.prototype = new RegExp();
  SubRegExp.prototype.toString = function () {
    return 'SubRegExp:/' + this.source + '/' + this.flags;
  };
  SubRegExp.make = RegExp.make;

  const test = (
    function testMaker(ctor, flags, x, ...values) {
      if ('object' === typeof x && 'raw' in x) {
        // Produce a test record if called as a string template.
        const template = x;
        return {
          ctor: ctor,
          flags: flags,
          template: template,
          values: values.slice()
        };
      } else {
        var makerCtor = ctor;
        var makerFlags = flags;
        const args = [x, ...values];
        for (var i = 0, n = args.length; i < n; ++i) {
          const arg = args[i];
          switch (typeof arg) {
          case 'function': makerCtor = arg; break;
          case 'string':   makerFlags = arg; break;
          }
        }
        return testMaker.bind(this, makerCtor, makerFlags);
      }
    }
  ).bind(null, RegExp, null);

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
    [test`^foo\(bar\);\n$`,
     r`/^foo\(bar\);\n$/`],

    // No interpolations but flags
    [test('gi')`^foo\(bar\);\n$`,
     r`/^foo\(bar\);\n$/gi`],
    // A single string into a block context.
    [test`^${ 'foo' }$`,
     r`/^(?:foo)$/`],
    // Testing transitions between contexts.
    [test('i')`^([${ '\\' }${ /[a-z]/ }]{${ 42 }})${ /$/ }`,
     r`/^([\\a-z]{42})(?:$)/i`, [0, 1]],

    // We allow numbers in counts and don't wrap with (?:...) since those
    // are unnecessary.
    // Simply coercing to string will allow [1,2] as a count value here to
    // have the intuitive meaning.
    // We want to treat empty strings differently here since
    [test`x{3,${''}}`,
     // can be reasonably
     r`/x{3,}/`],
    // while if we allowed the empty string to be interpolated as the
    // empty string, then we would screw up the way postfix operators
    // associate as in
    [test`x${''}*`,
     // where it would be unintuitive for the * to associate with x.
     r`/x(?:)*/`],

    // Back-reference not scoped to containing RegExp
    [test`^(#+)([^#\r\n]*)${ /\1/ }`,
     // Can't use r`...` since \1 triggers an octal-escape strict parse error.
     '/^(#+)([^#\\r\\n]*)(?:\\1)/', [0, 1, 2]],
    // Negated charset into a charset
    [test`[${ /[^A-Z]/ }]`,
     r`/[\u0000-@\[-\uffff]/`],
    // String into a charset
    [test`[${ "A-Z" }]`,
     r`/[A\-Z]/`],
    // String into a negated charset
    [test`[^${ "A-Z" }]`,
     r`/[^A\-Z]/`],
    // Multiple elements into a charset: individual chars, charsets,
    // and special groups.
    [test`[${ /[a]|([c]|b)|d|_/ }]`,
     r`/[_a-d]/`],
    // Multiple case-insensitive elements into a charset: individual chars,
    // charsets, and special groups.
    [test`[${ /[a]|(?:[c]|b)|d|_/i }]`,
     r`/[A-D_a-d]/`],
    // {1,2} does not contribute chars.
    [test`[${ /x{1,2}/ }]`,
     r`/[x]/`],
    // . does contribute chars.
    [test`[${ /.|\r|\n/ }]`,
     r`/[\u0000-\u2027\u202a-\uffff]/`],
    // Rewrite group indices.
    [
    //test`(fo(o))${ /(x)\1(?:\2)/ }bar${ /\1/ }(baz)`,  // Octal esc error
      {
        ctor: RegExp,
        template: { raw: ['(fo(o))', 'bar', '(baz)'] },
        flags: '',
        values: [/(x)\1(?:\2)/, /\1/]
      },
      '/(fo(o))(?:(x)\\3(?:\\2))bar(?:\\1)(baz)/',
      // Group 3 -^ comes from an interpolated group.
      [0, 1, 2, 4]
    ],
    // Rewrite template back-references when interrupted.
    [
      //test`^(${ /(.*)/ }\n(#+)\n${ /(.*)/ }\n\2)\n`,
      {
        ctor: RegExp,
        flags: '',
        template: { raw: ['^(',         '\\n(#+)\\n',         '\\n\\2)\\n'] },
        values: [               /(.*)/,               /(.*)/],
        //                0 1               2                             <- Template groups
        //                0 1   2           3          4                  <- Output groups
      },
      '/^((?:(.*))\\n(#+)\\n(?:(.*))\\n\\3)\\n/',
      [0, 1, 3]
    ],
    // Test that interpolations break tokens.
    // ($x?:x) should not run together into (?:x) when x is empty.
    [test`(${""}?:x)`,
     '/((?:)?:x)/', [0, 1]],
    [test`(${new RegExp('')}?:x)`,
     '/((?:(?:))?:x)/', [0, 1]],

    // Test that interpolation of case-insensitive into case-sensitive
    // expands letters.
    [test`${ /<foo>/i }[a-z0-9_]*${ /<\/foo>/ }`,
     r`/(?:<[Ff][Oo][Oo]>)[a-z0-9_]*(?:<\/foo>)/`],

    // Test that \b means different things in different contexts.
    [test`[${ /[\b\t\n]/ }],[${ /\b|\t|\n/ }]`,
     r`/[\u0008-\u000a],[\u0009\u000a]/`],

    // Treat null and undefined like the empty string
    [test`${null},${undefined},${NaN},${false},${0}`,
     r`/(?:),(?:),(?:NaN),(?:false),(?:0)/`],

    // Test un-bindable back-reference
    [test`${ /\1/ }`, r`/(?:(?:))/`],

    // Subclassing of RegExp
    [test(SubRegExp)`foo`, 'SubRegExp:/foo/'],
    [test(SubRegExp, 'i')`foo`, 'SubRegExp:/foo/i'],

    // TODO: Handle case-folding properly when u flag is present
    // TODO: Test interpolation in middle of charset start.  `[${...}^]`
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
  var nPassing = 0, nFailing = 0;
  for (var i = 0, n = tests.length; i < n; ++i) {
    const [
      { template, values, ctor: RegExpCtor, flags },
      expectedPattern,
      expectedGroupsOpt
    ] = tests[i];
    const expectedGroups = expectedGroupsOpt || [0];

    const maker = function (template, ...values) {
      if (flags != null) {
        return RegExpCtor.make(flags)(template, ...values);
      } else {
        return RegExpCtor.make(template, ...values);
      }
    }
    var actualPattern, actualGroups;
    try {
      const re = maker(template, ...values);
      actualPattern = re.toString();
      actualGroups = re.templateGroups;
    } catch (e) {
      actualPattern = '###Error:' + e + '###';
      actualGroups = ['###Error###'];
      console.error(e);
    }

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

    if (passAll) {
      ++nPassing;
    } else {
      ++nFailing;
    }
  }

  document.getElementById('warning').style.display = 'none';
  document.title = (nFailing === 0 ? 'PASS' : 'FAIL') + ' : ' + document.title;
}());
