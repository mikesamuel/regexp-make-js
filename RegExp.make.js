// Using the subset of ES6 currently supported by FF Nightly 42.0a1 (2015-08-01)
// For full ES6:
// * replace "var" below with "let"

"use strict";

RegExp.make = (function () {
  const BLOCK = 0;
  const CHARSET = 1;
  const COUNT = 2;

  // For each context, group 1 matches any token that exits the
  // context.
  const CONTEXT_TOKENS = [
      /^(?:([\{\[])|(?:[^\\\{\[]|\\[\s\S])+)/,
      /^(?:(\])|(?:[^\]\\]|\\[\s\S])+)/,
      /^(?:([\}])|[^\}]+)/,
  ];

  // Maps template literals to information derived from them.
  const CONTEXTS_CACHE = new WeakMap();

  function computeContexts(template) {
    const contexts = [];

    const raw = template.raw;

    var i = 0;
    const n = raw.length;
    var context = BLOCK;
    // We step over parts and consume tokens until we reach an
    // interpolation point.

    var currentPart = raw[0];
    while (i < n || currentPart) {
      if (!currentPart) {
        // We've reached an interpolation point.
        ++i;
        currentPart = raw[i];
        contexts.push(context);
        continue;
      }
      var m = CONTEXT_TOKENS[context].exec(currentPart);
      currentPart = currentPart.substring(m[0].length);
      if (!m[0].length) { throw new Error(currentPart); }
      if (m[1]) {
        switch (context) {
        case BLOCK:
          switch (m[1]) {
          case '[': context = CHARSET; break;
          case '{': context = COUNT;   break;
          default: throw new Error(m[1]);
          }
          break;
        default:
          context = BLOCK;
          break;
        }
      }
    }

    // We don't need the context after the last part
    // since no value is interpolated there.
    contexts.length--;

    CONTEXTS_CACHE[template] = {
      contexts: contexts
    };
  }

  const UNSAFE_CHARS_BLOCK = /[\\(){}\[\]\|\?\*\+\^\$\/]/g;
  const UNSAFE_CHARS_CHARSET = /[\]\-\\]/g;

  function toCharRanges(source) {
    const n = source.length;
    if (source.charAt(0) === '['
        && source.charAt(n - 1) === ']') {
      // Guard \ at the end and unescaped ].
      const chars = source.substring(1, n - 1).replace(
          /((?:^|[^\\])(?:\\\\)*)(?:\\$|\])/g, '\\$&');
      // TODO: if chars starts with ^, we should invert it
      return chars;
    }
    return '';
  }

  function fixUpInterpolatedRegExp(source) {
    // TODO: Count capturing groups, and use that to identify and
    // renumber back-references that are in scope.
    // TODO: Rewrite back-references that are out of scope to refer
    // to the template group.
    return source;
  }

  return function make(template, ...values) {
    if (values.length === 0 && typeof template === 'string') {
      // Allow RegExp.make(i)`...` to specify flags.
      // This calling convention is disjoint with use as a template tag
      // since the typeof a template record is 'object'.
      const flags = template;
      return function (template, ...values) {
        const re = make(template, ...values);
        return new RegExp(re.source, flags);
      };
    }

    var computed = CONTEXTS_CACHE[template];
    if (!computed) {
      computeContexts(template);
      computed = CONTEXTS_CACHE[template];
    }
    const contexts = computed.contexts;
    const raw = template.raw;

    const n = contexts.length;
    var pattern = raw[0];
    for (var i = 0; i < n; ++i) {
      const context = contexts[i];
      const value = values[i];
      var subst;
      switch (context) {
      case BLOCK:
        subst = '(?:'
          + (
            (value instanceof RegExp)
              ? fixUpInterpolatedRegExp(String(value.source))
              : String(value).replace(UNSAFE_CHARS_BLOCK, '\\$&')
          )
          + ')';
        break;
      case COUNT:
        subst = (+value || '0');
        break;
      case CHARSET:
        // TODO: We need to keep track of whether we're interpolating
        // into an inverted charset or not.
        subst =
          (value instanceof RegExp)
          ? toCharRanges(String(value.source))
          : String(value).replace(UNSAFE_CHARS_CHARSET, '\\$&');
        break;
      }
      pattern += subst;
      pattern += raw[i+1];
    }
    return new RegExp(pattern, '');
  };
})();
