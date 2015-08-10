// Using the subset of ES6 currently supported by FF Nightly 42.0a1 (2015-08-01)
// For full ES6:
// * replace "var" below with "let"

RegExp.make = (function () {
  "use strict";

  /** @enum{number} */
  const Context = {
    /** A context in which any top-level RegExp operator can appear. */
    BLOCK: 0,
    /** A context inside a charset.  {@code /[HERE]/} */
    CHARSET: 1,
    /** A context inside a charset.  <code>/x{HERE}/</code> */
    COUNT: 2
  };


  /**
   * Matches characters that have special meaning at
   * the top-level of a RegExp.
   */
  const UNSAFE_CHARS_BLOCK = /[\\(){}\[\]\|\?\*\+\^\$\/.]/g;
  /**
   * Matches characters that have special meaning within
   * a RegExp charset.
   */
  const UNSAFE_CHARS_CHARSET = /[\[\]\-\\]/g;

  /**
   * Encodes the end-point of a character range in a RegExp charset.
   *
   * @param {number} n a UTF-16 code-unit.
   * @return {string} of regexp suitable for embedding in a charset.
   */
  function encodeRangeEndPoint(n) {
    if (0x20 <= n && n <= 0x7e) {
      return String.fromCharCode(n).replace(UNSAFE_CHARS_CHARSET, '\\$&');
    }
    var hex = n.toString(16);
    return '\\u0000'.substring(0, 6 - hex.length) + hex;
  }

  /**
   * Max code-unit is the maximum UTF-16 code-unit since
   *   /^[\ud800\udc00]$/.test('\ud800\udc00') is false
   * and
   *   /^[\ud800\udc00]$/.test('\ud800') is true.
   * TODO: Take into account 'u' flag.
   */
  const MAX_CHAR_IN_RANGE = 0xFFFF;

  /**
   * A range of characters.
   * @param  {!Array.<number>=} opt_ranges
   * @constructor
   */
  function CharRanges(opt_ranges) {
    /**
     * A series of ints bit-packed with the minimum in the high 16 bits and
     * the difference between the max and the min in the low 16 bits.
     *
     * The range consisting of the letter 'A' is then [0x00410000] which has
     * the char code for 'A' (65 == 0x41) in the top half, and the difference
     * between the min and max (0) in the lower 16 bits.
     *
     * The range [a-z] is represented as [0x00610019] which has the char code
     * for 'a' (97 == 0x61) in the upper four bits, and the difference between
     * min and max (25 == 0x19) in the lower 16 bits.
     *
     * @private
     * @type {!Array.<number>}
     */
    this.ranges = opt_ranges ? opt_ranges.slice() : [];
  }
  /**
   * @this {!CharRanges}
   * @return {boolean}
   */
  CharRanges.prototype.isEmpty = function () {
    return !this.ranges.length;
  };
  /**
   * Produces a string that has the same meaning in a RegExp charset.
   * Without enclosing square brackets.
   * @override
   * @this {!CharRanges}
   */
  CharRanges.prototype.toString = function () {
    var s = '';
    /** @type {!Array.<number>}. */
    const ranges = this.ranges;
    /** @type {number} */
    const n = ranges.length;
    for (var i = 0; i < n; ++i) {
      /** @type {number} */
      const leftAndSpan = ranges[i];
      const left = leftAndSpan >> 16;
      const span = leftAndSpan & 0xffff;
      s += encodeRangeEndPoint(left);
      if (span) {
        if (span !== 1) { s += '-'; }
        s += encodeRangeEndPoint(left + span);
      }
    }
    return s;
  };
  /**
   * The minimum code-point matched or NaN.
   * @this {!CharRanges}
   * @return {number|undefined}
   */
  CharRanges.prototype.getMin = function () {
    this.canonicalize();
    /** @type {!Array.<number>} */
    const ranges = this.ranges;
    return ranges.length ? (ranges[0] >> 16) : undefined;
  };
  /**
   * Adds a range starting at left and going to right, inclusive.
   *
   * @this {!CharRanges}
   * @param {number} left inclusive code-unit
   * @param {number=} opt_right inclusive code-unit.  left is assumed if absent.
   * @return {!CharRanges} this to allow chaining.
   */
  CharRanges.prototype.addRange = function (left, opt_right) {
    var right = opt_right || left;
    left = +left;
    right = +right;
    if ('number' !== typeof left
        || left < 0 || right > MAX_CHAR_IN_RANGE || left > right
        || left % 1 || right % 1) {
      throw new Error();
    }
    this.ranges.push((left << 16) | ((right - left) & 0xFFFF));
    return this;
  };
  /**
   * Adds the given ranges to this.
   * Modifies this in place making it the union of its prior value and ranges.
   *
   * @this {!CharRanges}
   * @param {CharRanges} ranges
   * @return {!CharRanges} this to allow chaining.
   */
  CharRanges.prototype.addAll = function (ranges) {
    if (ranges !== this) {
      Array.prototype.push.apply(this.ranges, ranges.ranges);
    }
    return this;
  };
  /**
   * @this {!CharRanges}
   * @return {!CharRanges} [\u0000-\uFFFF] - this.
   *    Allocates a new output.  Does not modify in place.
   */
  CharRanges.prototype.inverse = function () {
    this.canonicalize();
    /** @type {!Array.<number>} */
    const ranges = this.ranges;
    /** @type {number} */
    const n = ranges.length;
    var pastLastRight = 0;
    const invertedRanges = [];
    for (var i = 0; i < n; ++i) {
      /** @type {number} */
      const leftAndSpan = ranges[i];
      const left = leftAndSpan >> 16;
      const span = leftAndSpan & 0xFFFF;
      if (pastLastRight < left) {
        invertedRanges.push(
          (pastLastRight << 16)
            | (left - pastLastRight - 1)
        );
      }
      pastLastRight = left + span + 1;
    }
    if (pastLastRight <= MAX_CHAR_IN_RANGE) {
      invertedRanges.push(
        (pastLastRight << 16)
          | (MAX_CHAR_IN_RANGE - pastLastRight));
    }
    return new CharRanges(invertedRanges);
  };
  /**
   * Orders ranges and merges overlapping ranges.
   * @this {!CharRanges}
   * @return {!CharRanges} this to allow chaining.
   */
  CharRanges.prototype.canonicalize = function () {
    // Sort ranges so that they are ordered by left.
    /** @type {!Array.<number>} */
    const ranges = this.ranges;
    /** @type {number} */
    const n = ranges.length;
    if (!n) { return this; }
    ranges.sort(function (a, b) { return a - b; });
    // Merge overlapping ranges.
    var j = 1;  // Index into ranges past last merged item.
    var lastRight = (ranges[0] >> 16) + ranges[0] & 0xFFFF;
    for (var i = 1; i < n; ++i) {
      /** @type {number} */
      const leftAndSpan = ranges[i];
      const left = leftAndSpan >> 16;
      const span = leftAndSpan & 0xFFFF;
      if (lastRight + 1 >= left) {
        // We can merge the two.
        const lastLeft = ranges[j - 1] >> 16;
        lastRight = Math.max(lastRight, left + span);
        const merged = (lastLeft << 16) | (lastRight - lastLeft);
        ranges[j - 1] = merged;
        // Do not increment j.
      } else {
        ranges[j] = leftAndSpan;
        lastRight = left + span;
        ++j;
      }
    }
    ranges.length = j;
    return this;
  };
  /**
   * A newly allocated set with those elements in this that fall inside
   * {@code new CharRanges().addRange(min, max)}.
   * @this {!CharRanges}
   * @param {number} min inclusive
   * @param {number} max inclusive
   * @return {!CharRanges} a newly allocated output.  Not modified in place.
   */
  CharRanges.prototype.intersectionWithRange = function (min, max) {
    /** @type {!Array.<number>} */
    const ranges = this.ranges;
    const intersection = new CharRanges();
    /** @type {number} */
    const n = ranges.length;
    for (var i = 0; i < n; ++i) {
      /** @type {number} */
      const leftAndSpan = ranges[i];
      const left = leftAndSpan >> 16;
      const span = leftAndSpan & 0xFFFF;
      /** @type {number} */
      const right = left + span;

      if (!(left > max || right < min)) {
        intersection.addRange(Math.max(min, left), Math.min(max, right));
      }
    }
    return intersection;
  };
  /**
   * The ranges but with each ranges left-end-point shifted by delta.
   * @this {!CharRanges}
   * @param {number} delta
   * @return {!CharRanges} a newly allocated output.  Not modified in place.
   */
  CharRanges.prototype.shifted = function (delta) {
    return new CharRanges(
      this.ranges.map(function (x) { return x + (delta << 16); })
    );
  };
  /**
   * Applies callback to each range.
   * @param {function(number, number)} callback receives left and right inclusive.
   * @this {!CharRanges}
   */
  CharRanges.prototype.forEachRange = function (callback) {
    /** @type {!Array.<number>} */
    const ranges = this.ranges;
    /** @type {number} */
    const n = ranges.length;
    for (var i = 0; i < n; ++i) {
      /** @type {number} */
      const leftAndSpan = ranges[i];
      const left = leftAndSpan >> 16;
      const span = leftAndSpan & 0xFFFF;
      /** @type {number} */
      const right = left + span;
      callback(left, right);
    }
  };
  CharRanges.prototype.clear = function () {
    this.ranges.length = 0;
  };


  const TOKENIZERS = new Map();

  /**
   * Returns a function that invokes the event handler below on tokens found in
   * RegExp source.
   *
   * @param {{
   *   wholeInput:   boolean,
   *   startCharset: (function(string) | undefined),
   *   range:        (function(number, number) | undefined),
   *   endCharset:   (function(string) | undefined),
   *   bracket:      (function(string) | undefined),
   *   operators:    (function(string) | undefined),
   *   count:        (function(?number, ?number) | undefined),
   *   escape:       (function(string) | undefined),
   *   backref:      (function(number) | undefined),
   *   other:        (function(string) | undefined)
   * }} eventHandler
   * @return {!function(!Context, string):!Context} a function that takes
   *    a start context, and RegExp source, and returns an end context.
   */
  function parseRegExpSource(eventHandler) {
    const {
      wholeInput,  // Is the input whole.
      startCharset,
      range,
      endCharset,
      bracket,
      operators,
      count,
      escape,
      backref,
      other: otherOpt
    } = eventHandler;
    /** @type {function(string)} */
    const other = otherOpt || function () {};

    // We compile an efficient regular expression that groups as many things as
    // we don't care about as possible into runs of "other stuff".
    const signature = 0
            | (wholeInput ? 1 : 0)
            | ((startCharset || endCharset || range) ? 2 : 0)
            | (bracket ? 4 : 0)
            | (operators ? 8 : 0)
            | (escape ? 16 : 0)
            | (backref ? 32 : 0);

    var tokenizer = TOKENIZERS.get(signature);
    if (!tokenizer) {
      const tokens = [];
      const careChars = new CharRanges();
      const dontCareTokens = [];
      if (escape || backref) {
        if (backref) {
          tokens.push('\\\\[1-9][0-9]*');
        }
        if (escape) {
          tokens.push(
            '\\\\(?:[xX][0-9a-fA-F]{2}|[uU][0-9a-fA-F]{4}|[^1-9xXuU])');
        } else {
          dontCareTokens.push('\\\\[^1-9]');
        }
      } else {
        dontCareTokens.push('\\\\[\\s\\S]');
      }
      careChars.addRange('\\'.charCodeAt(0));

      // If we have the whole input, and don't need to report charsets, then we
      // can include them in dontCareTokens.
      (
        (startCharset || endCharset || range || !wholeInput)
          ? tokens : dontCareTokens
      ).push(
        '\\[(?:[^\\]\\\\]|\\\\[\\S\\s])*\\]?'
      );
      careChars.addRange('['.charCodeAt(0));

      // Reasoning is similar to charset above.
      (
        (count || !wholeInput)
          ? tokens : dontCareTokens
      ).push(
        '[{]\\d*(?:,\\d*)?[}]?'
      );
      careChars.addRange('{'.charCodeAt(0));

      if (bracket) {
        tokens.push('[(](?:[?][:=!])?|[)]');
        careChars.addRange('('.charCodeAt(0))
          .addRange(')'.charCodeAt(0));
      }

      const operatorChars = '$^*+?|.';
      if (operators) {
        tokens.push(
          '[' + operatorChars.replace(UNSAFE_CHARS_CHARSET, '\\$&') + ']');
        for (var i = 0, nOpChars = operatorChars.length; i < nOpChars; ++i) {
          careChars.addRange(operatorChars.charCodeAt(i));
        }
      }

      // I really wish we had a nice way of composing regular expressions.
      dontCareTokens.push('[' + careChars.inverse() + ']');
      tokens.push('(?:' + dontCareTokens.join('|') + ')+');
      tokenizer = new RegExp(tokens.join('|'), 'g');
      TOKENIZERS.set(signature, tokenizer);
    }

    return function(startContext, source) {
      /** @type {?Array.<string>} */
      var match;
      var blockSource = String(source);
      var outputContext = startContext;
      switch (startContext) {
      case Context.CHARSET:
        // Strip off the unclosed CHARSET, dispatch it,
        // and switch to block context.
        match = blockSource.match(/^(?:[^\]\\]|\\[\S\s])*?\]/);
        var ranges;
        if (match) {
          outputContext = Context.BLOCK;
          blockSource = blockSource.substring(match[0].length);
          ranges = match[0];
          ranges = ranges.substring(ranges.length - 1);
        } else {
          ranges = blockSource;
          blockSource = '';
        }
        if (range) {
          parseCharsetRanges(range, ranges);
        } else if (!endCharset) {
          other(match ? match[0] : blockSource);
        }
        if (endCharset && outputContext !== Context.CHARSET) {
          endCharset(match[0]);
        }
        break;
      case Context.COUNT:
        /** @type {number} */
        const rcurly = blockSource.indexOf('}');
        const hasCurly = rcurly >= 0;
        /** @type {number} */
        const end = hasCurly ? rcurly + 1 : blockSource.length;
        (count || other)(blockSource.substring(0, end));
        blockSource = blockSource.substring(end);
        if (hasCurly) {
          outputContext = Context.BLOCK;
        }
        break;
      }

      /** @type {?Array.<string>} */
      const sourceTokens = blockSource.match(tokenizer) || [];
      /** @type {number} */
      const nSourceTokens = sourceTokens ? sourceTokens.length : 0;

      // Assert that our tokenizer matched the whole input.
      var totalSourceTokenLength = 0;
      for (var i = 0; i < nSourceTokens; ++i) {
        totalSourceTokenLength += sourceTokens[i].length;
      }
      if (blockSource.length !== totalSourceTokenLength) {
        throw new Error(
          'Failed to tokenize ' + blockSource + ' with ' + tokenizer + '. Got '
          + JSON.stringify(sourceTokens) + ' which have a length delta of '
          + (blockSource.length - totalSourceTokenLength));
      }

      for (var i = 0; i < nSourceTokens; ++i) {
        /** @type {string} */
        const sourceToken = sourceTokens[i];
        switch (sourceToken[0]) {
        case '[':
          /** @type {boolean} */
          const isClosed = (
            i + 1 < nSourceTokens || /(?:^|[^\\])(?:\\\\)*\]$/.test(sourceToken)
          );
          if (!isClosed) {
            outputContext = Context.CHARSET;
          }
          if (startCharset || range) {
            const start = sourceToken[1] === '^' ? '[^' : '[';
            if (startCharset) {
              startCharset(start);
            }
            if (range) {
              /** @type {number} */
              const endPos = sourceToken.length + (isClosed ? -1 : 0);
              parseCharsetRanges(
                range, sourceToken.substring(start.length, endPos));
            }
          } else if (!endCharset) {
            other(sourceToken);
          }
          if (isClosed && endCharset) {
            endCharset(']');
          }
          break;
        case '\\':
          /** @type {string} */
          const ch1 = sourceToken[1];
          (('1' <= ch1 && ch1 <= '9' ? backref : escape) || other)(sourceToken);
          break;
        case '(': case ')':
          (bracket || other)(sourceToken);
          break;
        case '+': case '*': case '?': case '.': case '|': case '^': case '$':
          (operators || other)(sourceToken);
          break;
        case '{':
          if (count) {
            /** @type {?Array.<string>} */
            const minMaxMatch = /^\{(\d*)(?:,(\d*))?/.exec(sourceToken);
            const min = minMaxMatch ? +minMaxMatch[1] : 0;
            const max = +(minMaxMatch && minMaxMatch[2] || min);
            count(min, max);
          } else {
            other(sourceToken);
          }
          if (i + 1 == nSourceTokens
              && sourceToken[sourceToken.length - 1] !== '}') {
            outputContext = Context.COUNT;
          }
          break;
        default:
          other(sourceToken);
        }
      }

      return outputContext;
    };
  }

  /** Maps template literals to information derived from them. */
  const STATIC_INFO_CACHE = new WeakMap();

  /**
   * Given the template literal parts, computes a record of
   * the form
   * {
   *   contexts: [...],
   *   templateGroupCounts: [...],
   *   splitLiterals: [...],
   * }
   *
   * For each value, value[i], contexts[i] is the context in which
   * it is interpolated.
   *
   * For each template literal, template.raw[i], templateGroupCounts[i]
   * is the number of capturing groups entered in that part.
   *
   * For each template literal, template.raw[i], splitLiterals[i] is
   * an array that has template.raw[i] split around back-references and
   * the back-references replaces with the index referred to, so
   * the literal chunk 'foo\2bar' would split to ['foo', 2, 'bar'].
   *
   * @param {!Array.<string>} raw template literal parts.
   * @return {!{contexts            : !Array.<!Context>,
   *            templateGroupCounts : !Array.<number>,
   *            splitLiterals       : !Array.<!Array<(string|number)>>}}
   */
  function getStaticInfo(raw) {
    var staticInfo = STATIC_INFO_CACHE.get(raw);
    if (staticInfo) { return staticInfo; }

    const contexts = [];
    const templateGroupCounts = [];
    const splitLiterals = [];

    var context = Context.BLOCK;
    var templateGroupCount = 0;
    var splitLiteral = [];

    function pushSplitLiteral(s) {
      /** @type {number} */
      const n = splitLiteral.length;
      if (n && 'string' === typeof splitLiteral[n - 1]) {
        splitLiteral[n - 1] += s;
      } else {
        splitLiteral[n] = s;
      }
    }

    const parseHandler = {
      wholeInput: false,
      bracket: function (s) {
        if (s === '(') {
          ++templateGroupCount;
        }
        pushSplitLiteral(s);
      },
      backref: function (s) {
        splitLiteral.push(+s.substring(1));
      },
      other: function (s) {
        pushSplitLiteral(s);
      }
    };
    /** @type {function(!Context, string):!Context} */
    const parse = parseRegExpSource(parseHandler);

    /** @type {number} */
    const n = raw.length;
    for (var i = 0; i < n; ++i) {
      context = parse(context, raw[i]);
      contexts.push(context);
      templateGroupCounts.push(templateGroupCount);
      splitLiterals.push(splitLiteral);

      templateGroupCount = 0;
      splitLiteral = [];
    }

    // We don't need the context after the last part
    // since no value is interpolated there.
    contexts.length--;

    const computed = {
      contexts: contexts,
      templateGroupCounts: templateGroupCounts,
      splitLiterals: splitLiterals
    };
    STATIC_INFO_CACHE.set(raw, computed);
    return computed;
  }

  /**
   * The characters matched by {@code /./}.
   * @type {CharRanges}
   */
  const DOT_RANGES = new CharRanges()
          .addRange(0xA).addRange(0xD).addRange(0x2028, 0x2029)
          .inverse();

  /**
   * @param {string} source the source of a RegExp.
   * @param {string} flags the flags of a RegExp.
   * @return {string} the text of a charset that matches all code-units that
   *    could appear in any string in the language matched by the input.
   *    This is liberal.  For example {@code /ab{0}/} can match the string "a",
   *    but cannot match the string "ab" because of the zero-count.
   *    Lookaheads could similarly contribute characters unnecessarily.
   */
  function toCharRanges(source, flags) {
    // We parse the source and try to find all character sets
    // and literal characters, union them.

    // Accumulate all ranges onto charRanges.
    const charRanges = new CharRanges();
    var negCharRanges = null;

    parseRegExpSource(
      {
        wholeInput: true,
        escape: function (esc) {
          addEscapeValueTo(esc, false, charRanges);
        },
        operators: function (s) {
          if (s.indexOf('.') >= 0) {
            charRanges.addAll(DOT_RANGES);
          }
        },
        count: function(_) {},
        bracket: function (_) {},
        startCharset: function (start) {
          if (start[1] === '^') {
            negCharRanges = new CharRanges();
          }
        },
        endCharset: function (_) {
          if (negCharRanges) {
            charRanges.addAll(negCharRanges.inverse());
            negCharRanges = null;
          }
        },
        range: function (left, right) {
          (negCharRanges || charRanges).addRange(left, right);
        },
        other: function (s) {
          for (var i = 0, n = s.length; i < n; ++i) {
            charRanges.addRange(s.charCodeAt(i));
          }
        }
      })(
      Context.BLOCK,
      source);

    if (flags.indexOf('i') >= 0) {
      // Fold letters.
      caseFold(charRanges);
    }
    charRanges.canonicalize();
    return charRanges.toString();
  }


  /**
   * Adds other-case forms of any ASCII letters in charRanges.
   * @param {CharRanges} charRanges
   */
  function caseFold(charRanges) {
    charRanges.canonicalize();
    // TODO: Read spec and figure out what to do with non-ASCII characters.
    // Maybe take flags and look for the 'u' flag.
    /** @type {CharRanges} */
    const upperLetters = charRanges.intersectionWithRange(
      'A'.charCodeAt(0), 'Z'.charCodeAt(0));
    /** @type {CharRanges} */
    const lowerLetters = charRanges.intersectionWithRange(
      'a'.charCodeAt(0), 'z'.charCodeAt(0));
    charRanges.addAll(upperLetters.shifted(+32));
    charRanges.addAll(lowerLetters.shifted(-32));
  }

  /** An escape sequence that is definitely not a back-reference. */
  const ESCAPE_SEQUENCE_PATTERN =
          '\\\\(?:u[\\da-fA-F]{4}|x[\\da-fA-F]{2}|[^1-9]?)';

  /**
   * Pattern for the start or end of a character range.
   */
  const CHARSET_END_POINT_PATTERN = (
    '(?:'
      + '[^\\\\]'  // Not an escape
      + '|' + ESCAPE_SEQUENCE_PATTERN  // A full normal escape
      + '|\\\\[1-9]'  // Back-references cannot appear in charsets.
      + ')'
  );
  /**
   * Matches all the atomic parts of a charset: individual characters, groups,
   * and single ranges.
   */
  const CHARSET_PARTS_RE = new RegExp(
    '\\\\[DdSsWw]'  // A charset abbreviation
    + '|' + CHARSET_END_POINT_PATTERN
    + '(?:-' + CHARSET_END_POINT_PATTERN + ')?',
    'g'
  );
  /**
   * Matches a range putting the left of the range in group 1,
   * and the right in group 2.
   * If group 2 is not present, then it is implicitly the same as the left.
   */
  const CHARSET_RANGE_RE = new RegExp(
    '(' + CHARSET_END_POINT_PATTERN + ')'
    + '(?:-(' + CHARSET_END_POINT_PATTERN + '))?'
  );

  /**
   * Space characters that match \s
   * @type {CharRanges}
   */
  const SPACE_CHARS = new CharRanges()
      .addRange(0x9, 0xd)
      .addRange(0x20)
      .addRange(0xa0)
      .addRange(0x1680)
      .addRange(0x180e)
      .addRange(0x2000, 0x200a)
      .addRange(0x2028, 0x2029)
      .addRange(0x202f)
      .addRange(0x205f)
      .addRange(0x3000)
      .addRange(0xfeff);
  /**
   * Word chars that match \w
   * @type {CharRanges}
   */
  const WORD_CHARS = new CharRanges()
      .addRange('A'.charCodeAt(0), 'Z'.charCodeAt(0))
      .addRange('0'.charCodeAt(0), '9'.charCodeAt(0))
      .addRange('a'.charCodeAt(0), 'z'.charCodeAt(0))
      .addRange('_'.charCodeAt(0));
  /**
   * Digit chars that match \d
   * @type {CharRanges}
   */
  const DIGIT_CHARS = new CharRanges()
      .addRange('0'.charCodeAt(0), '9'.charCodeAt(0));
  /**
   * Maps letters after \ that are special in RegExps.
   * @type {!Map.<string, CharRanges>}
   */
  const ESCAPE_SEQ_MAP = new Map([
    ['\\s', SPACE_CHARS],
    ['\\S', SPACE_CHARS.inverse()],
    ['\\w', WORD_CHARS],
    ['\\W', WORD_CHARS.inverse()],
    ['\\d', DIGIT_CHARS],
    ['\\D', DIGIT_CHARS.inverse()],
    ['\\t', new CharRanges().addRange(0x9)],
    ['\\n', new CharRanges().addRange(0xA)],
    ['\\v', new CharRanges().addRange(0xB)],
    ['\\f', new CharRanges().addRange(0xC)],
    ['\\r', new CharRanges().addRange(0xD)],
    // b doesn't appear here since its meaning depends on context.
    ['\\B', new CharRanges()]
  ]);

  /**
   * The code-unit corresponding to the end-point of a range.
   * TODO; What does [\s-\w] mean?
   * @param {string} endPoint a character, escape sequence, or named charset.
   */
  function rangeEndPointToCodeUnit(endPoint) {
    var cu = (
      (endPoint[0] == '\\')
        ? addEscapeValueTo(endPoint, true, new CharRanges()).getMin()
        : endPoint.charCodeAt(0)
    );
    return cu;
  }

  /** @type {number} */
  const SLASH_B_CHAR_CODE = '\b'.charCodeAt(0);
  /**
   * Decodes an escape sequence and adds any ranges it specifies to the given
   * ranges.
   *
   * @param {string} esc an escape sequence.
   * @param {boolean} inCharSet true iff esc appears inside a [...] charset.
   * @param {CharRanges} ranges the output to add to.  Modified in place.
   */
  function addEscapeValueTo(esc, inCharSet, ranges) {
    var chars = ESCAPE_SEQ_MAP.get(esc);
    if (chars !== undefined) {
      ranges.addAll(chars);
    } else {
      var ch1 = esc.charAt(1);
      switch (ch1) {
      case 'u': case 'x':
        /** @type {number} */
        const cu = parseInt(esc.substring(2 /* strip \x or \u */), 16);
        ranges.addRange(cu);
        break;
      case 'b':
        if (inCharSet) {
          ranges.addRange(SLASH_B_CHAR_CODE);
        }
        break;
      default:
        if (!('1' <= ch1 && ch1 <= '9')) {
          ranges.addRange(ch1.charCodeAt(0));
        }
      }
    }
    return ranges;
  }

  /**
   * Applies the given handler to the left and right end-points (inclusive)
   * of the ranges in rangeText.
   *
   * @param {function(number, number)} handler receives 2 code-units.
   * @param {string} rangeText text of a RegExp charSet body.
   */
  function parseCharsetRanges(handler, rangeText) {
    /** @type {?Array.<string>} */
    const tokens = rangeText.match(CHARSET_PARTS_RE);
    /** @type {number} */
    const n = tokens ? tokens.length : 0;
    for (var i = 0; i < n; ++i) {
      /** @type {string} */
      const token = tokens[i];
      /** @type {?Array.<string>} */
      const m = CHARSET_RANGE_RE.exec(token);
      if (m && m[2]) {
        handler(
          rangeEndPointToCodeUnit(m[1]),
          rangeEndPointToCodeUnit(m[2]));
      } else if (token[0] === '\\') {
        const ranges = new CharRanges();
        addEscapeValueTo(token, true, ranges);
        ranges.forEachRange(handler);
      } else {
        /** @type {number} */
        const cu = token.charCodeAt(0);
        handler(cu, cu);
      }
    }
  }


  /**
   * Adjusts an interpolated RegExp so that it can be interpolated in
   * the context of the template while preserving the meaning of
   * back-references and character sets.
   *
   * @param {string} containerFlags the flags of the RegExp into which source
   *    is being interpolated.
   * @param {string} source the source of a RegExp being interpolated.
   * @param {string} flags associated with source.
   * @param {number} regexGroupCount The number of capturing groups that are
   *    opened before source is interpolated.
   * @param {!Array.<number>} templateGroups see the documentation for make for
   *    the contract.
   *    It only contains entries for capturing groups opened before the
   *    insertion point.
   *
   * @return [fixedSource, countOfCapturingGroupsInFixedSource]
   */
  function fixUpInterpolatedRegExp(
    containerFlags, source, flags, regexGroupCount, templateGroups) {
    // Count capturing groups, and use that to identify and
    // renumber back-references that are in scope.
    var sourceGroupCount = 0;
    var hasBackRef = false;
    const fixedSource = [];

    function append(tok) { fixedSource.push(tok); }

    const parseHandler = {
      wholeInput: true,
      bracket: function (tok) {
        if (tok === '(') {
          ++sourceGroupCount;
        }
        fixedSource.push(tok);
      },
      other: append
    };

    // Convert back-refs to numbers so we can renumber them below.
    if (regexGroupCount || templateGroups.length) {
      parseHandler.backref = function (tok) {
        hasBackRef = true;
        fixedSource.push(+tok.substring(1));
      };
    }

    const isCaseInsensitive = flags.indexOf('i') >= 0;
    if (isCaseInsensitive && containerFlags.indexOf('i') < 0) {
      // Expand literal letters and letters in charsets.
      parseHandler.startCharset = append;
      const ranges = new CharRanges();
      parseHandler.range = function (left, right) {
        ranges.addRange(left, right);
      };
      parseHandler.endCharset = function (s) {
        caseFold(ranges);
        fixedSource.push(ranges.toString(), s);
        ranges.clear();
      };
      parseHandler.other = function (tok) {
        fixedSource.push(tok.replace(
          /\\\\[\s\S]|[A-Za-z]/g,
          function (s) {
            if (s.length === 1) {
              const cu = s.charCodeAt(0) & ~32;
              if (65 <= cu && cu <= 90) {
                return '[' + String.fromCharCode(cu, cu | 32) + ']';
              }
            }
            return s;
          }));
      };
    }

    parseRegExpSource(parseHandler)(Context.BLOCK, source);

    // Rewrite back-references that are out of scope to refer
    // to the template group.
    if (hasBackRef) {
      for (var i = 0, n = fixedSource.length; i < n; ++i) {
        var el = fixedSource[i];
        if ('number' === typeof el) {
          /** @type {number} */
          const backRefIndex = el;
          if (backRefIndex <= sourceGroupCount) {
            // A local reference.
            el = '\\' + (backRefIndex + regexGroupCount - 1);
          } else if (backRefIndex < templateGroups.length) {
            // A reference to a template group that is in scope.
            el = '\\' + templateGroups[backRefIndex];
          } else {
            // An out of scope back-reference matches the empty string.
            el = '(?:)';
          }
          fixedSource[i] = el;
        }
      }
    }

    return [fixedSource.join(''), sourceGroupCount];
  }

  function make(flags, template, ...values) {
    if ('string' === typeof template && values.length === 0) {
      // Allow RegExp.make(i)`...` to specify flags.
      // This calling convention is disjoint with use as a template tag
      // since the typeof a template record is 'object'.
      return make.bind(null, template /* use as flags instead */);
    }

    /** @type {!Array.<string>} */
    const raw = template.raw;
    var { contexts, templateGroupCounts, splitLiterals } = getStaticInfo(raw);

    /** @type {number} */
    const n = contexts.length;

    var pattern = raw[0];
    // For each group specified in the template, the index of the corresponding
    // group in pattern.
    const templateGroups = [
      0 // Map implicit group 0, the whole match, to itself
    ];
    // The number of groups in the RegExp on pattern so far.
    var regexGroupCount = 1;  // Count group 0.

    function addTemplateGroups(i) {
      /** @type {number} */
      const n = templateGroupCounts[i];
      for (var j = 0; j < n; ++j) {
        templateGroups.push(regexGroupCount++);
      }
    }
    addTemplateGroups(0);

    for (var i = 0; i < n; ++i) {
      /** @type {Context} */
      const context = contexts[i];
      var value = values[i];
      if (value == null) {
        value = '';
      }
      var subst;
      switch (context) {
      case Context.BLOCK:
        if (value instanceof RegExp) {
          var [valueSource, valueGroupCount] = fixUpInterpolatedRegExp(
            flags, String(value.source), value.flags,
            regexGroupCount, templateGroups);
          subst = '(?:' + valueSource + ')';
          regexGroupCount += valueGroupCount;
        } else {
          subst =
            '(?:' + String(value).replace(UNSAFE_CHARS_BLOCK, '\\$&') + ')';
        }
        break;
      case Context.CHARSET:
        // TODO: We need to keep track of whether we're interpolating
        // into an inverted charset or not.
        subst =
          (value instanceof RegExp)
          ? toCharRanges(String(value.source), String(value.flags))
          : String(value).replace(UNSAFE_CHARS_CHARSET, '\\$&');
        break;
      case Context.COUNT:
        subst = String(value instanceof RegExp ? value.source : value);
      }

      var rawLiteralPart = raw[i+1];
      var splitLiteral = splitLiterals[i + 1];
      if (regexGroupCount !== templateGroups.length
          && (splitLiteral.length !== 1
              || 'string' !== typeof splitLiteral[0])) {
        /** @type {!Array.<(string|number)>}} */
        const splitCopy = splitLiteral.slice(0);
        for (var j = 0, splitLength = splitCopy.length; j < splitLength; ++j) {
          /** @type {string|number} */
          const splitElement = splitCopy[j];
          if ('number' === typeof splitElement) {
            if (splitElement < templateGroups.length) {
              // A reference to a template group that is in scope.
              splitCopy[j] = '\\' + templateGroups[splitElement];
            } else {
              // An out of scope back-reference matches the empty string.
              // We can't just use the empty string, because returning nothing
              // would change the way that postfix operators like * attach.
              splitCopy[j] = '(?:)';
            }
          }
        }
        rawLiteralPart = splitCopy.join('');
      }

      pattern += subst;
      pattern += rawLiteralPart;
      addTemplateGroups(i+1);
    }
    const output = new RegExp(pattern, flags);
    output.templateGroups = templateGroups;
    return output;
  }

  return make.bind(null, '' /* No flags by default */);
})();

// TODO: Figure out interpolation of charset after - as in `[a-${...}]`
