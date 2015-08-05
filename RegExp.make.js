// Using the subset of ES6 currently supported by FF Nightly 42.0a1 (2015-08-01)
// For full ES6:
// * replace "var" below with "let"

"use strict";

RegExp.make = (function () {
  /** A context in which any top-level RegExp operator can appear. */
  const BLOCK = 0;
  /** A context inside a charset. */
  const CHARSET = 1;
  /** A context inside a count -- inside the curlies in /x{1,2}/ */
  const COUNT = 2;

  /**
   * For each context, group 1 matches any token that exits the
   * context.
   */
  const CONTEXT_TOKENS = [
      /^(?:([\{\[]|\(\??)|(?:[^\\\{\[\(]|\\[\s\S])+)/,
      /^(?:(\])|(?:[^\]\\]|\\[\s\S])+)/,
      /^(?:([\}])|[^\}]+)/,
  ];

  /** Maps template literals to information derived from them. */
  const CONTEXTS_CACHE = new WeakMap();

  /**
   * Given the template literal parts, computes a record of
   * the form
   * {
   *   contexts: [...],
   *   templateGroupCounts: [...],
   * }
   *
   * For each value, value[i], contexts[i] is the context in which
   * it is interpolated.
   *
   * For each template literal, template.raw[i], templateGroupCounts[i]
   * is the number of capturing groups entered in that part.
   */
  function getStaticInfo(raw) {
    var staticInfo = CONTEXTS_CACHE.get(raw);
    if (staticInfo) { return staticInfo; }

    const contexts = [];
    const templateGroupCounts = [];

    var i = 0;
    const n = raw.length;
    var context = BLOCK;
    // We step over parts and consume tokens until we reach an
    // interpolation point.

    var currentPart = raw[0];
    var templateGroupCount = 0;
    while (i < n || currentPart) {
      if (!currentPart) {
        // We've reached an interpolation point.
        ++i;
        currentPart = raw[i];
        contexts.push(context);
	templateGroupCounts.push(templateGroupCount);
	templateGroupCount = 0;
        continue;
      }
      var m = currentPart.match(CONTEXT_TOKENS[context]);
      currentPart = currentPart.substring(m[0].length);
      if (!m[0].length) { throw new Error(currentPart); }
      if (m[1]) {
        switch (context) {
        case BLOCK:
          switch (m[1]) {
          case '[':  context = CHARSET;    break;
          case '{':  context = COUNT;      break;
	  case '(':  templateGroupCount++; // Fall-through
	  case '(?': context = BLOCK;      break;
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
    templateGroupCounts.push(templateGroupCount);

    const computed = {
      contexts: contexts,
      templateGroupCounts: templateGroupCounts
    };
    CONTEXTS_CACHE.set(raw, computed);
    return computed;
  }

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
   * @param {int} n a UTF-16 code-unit.
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
   */
  const MAX_CHAR_IN_RANGE = 0xFFFF;

  /**
   *
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
     * @type {Array.<int>}
     */
    this.ranges = opt_ranges ? opt_ranges.slice() : [];
  }
  /**
   * Produces a string that has the same meaning in a RegExp charset.
   * Without enclosing square brackets.
   */
  CharRanges.prototype.toString = function () {
    var s = '';
    const ranges = this.ranges;
    const n = ranges.length;
    for (var i = 0; i < n; ++i) {
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
  /** The minimum code-point matched or NaN. */
  CharRanges.prototype.getMin = function () {
    this.canonicalize();
    const ranges = this.ranges;
    return ranges.length ? (ranges[0] >> 16) : undefined;
  };
  /**
   * Adds a range starting at left and going to right, inclusive.
   *
   * @param {int} left inclusive code-unit
   * @param {int} right_opt inclusive code-unit.  left is assumed if absent.
   * @return {CharRanges} this to allow chaining.
   */
  CharRanges.prototype.addRange = function (left, right_opt) {
    var right = right_opt || left;
    left = +left;
    right = +right;
    if (left < 0 || right > MAX_CHAR_IN_RANGE || left > right
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
   * @param {CharRanges} ranges
   * @return {CharRanges} this to allow chaining.
   */
  CharRanges.prototype.addAll = function (ranges) {
    if (ranges !== this) {
      Array.prototype.push.apply(this.ranges, ranges.ranges);
    }
    return this;
  };
  /**
   * @return {CharRanges} [\u0000-\uFFFF] - this.
   *    Allocates a new output.  Does not modify in place.
   */
  CharRanges.prototype.inverse = function () {
    this.canonicalize();
    const ranges = this.ranges;
    const n = ranges.length;
    var pastLastRight = 0;
    const invertedRanges = [];
    for (var i = 0; i < n; ++i) {
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
   * @return {CharRanges} this to allow chaining.
   */
  CharRanges.prototype.canonicalize = function () {
    // Sort ranges so that they are ordered by left.
    const ranges = this.ranges;
    const n = ranges.length;
    if (!n) { return this; }
    ranges.sort(function (a, b) { return a - b; });
    // Merge overlapping ranges.
    var j = 1;  // Index into ranges past last merged item.
    var lastRight = (ranges[0] >> 16) + ranges[0] & 0xFFFF;
    for (var i = 1; i < n; ++i) {
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
   * @return {CharRanges} a newly allocated output.  Not modified in place.
   */
  CharRanges.prototype.intersectionWithRange = function (min, max) {
    const ranges = this.ranges;
    const intersection = new CharRanges();
    const n = ranges.length;
    for (var i = 0; i < n; ++i) {
      const leftAndSpan = ranges[i];
      const left = leftAndSpan >> 16;
      const span = leftAndSpan & 0xFFFF;
      const right = left + span;

      if (!(left > max || right < min)) {
        intersection.addRange(Math.max(min, left), Math.min(max, right));
      }
    }
    return intersection;
  };
  /**
   * The ranges but with each ranges left-end-point shifted by delta.
   * @return {CharRanges} a newly allocated output.  Not modified in place.
   */
  CharRanges.prototype.shifted = function (delta) {
    return new CharRanges(
      this.ranges.map(function (x) { return x + (delta << 16); })
    );
  };

  /** An escape sequence that is definitely not a back-reference. */
  const ESCAPE_SEQUENCE_PATTERN =
          '\\\\(?:u[\\da-fA-F]{4}|x[\\da-fA-F]{2}|[^1-9]?)';

  /** Matches all RegExp parts that specify characters. */
  const CHAR_RANGE_RELEVANT_OPERATORS = new RegExp(
    [
      ESCAPE_SEQUENCE_PATTERN,  // Escape sequence or boundary.
      '\\[(?:[^\\]\\\\]|\\\\[\\s\\S]])*\\]',  // A charset
      '[.]',  // Dot is a meta-character.
      '[(](?:[?][:=!])?',  // (?: (?! (?=  ( don't contribute chars.
      '[)]',
      '[{]\\d*(?:,\\d*)?[}]',  // In x{1,2} only x contributes chars.
      '[^\\\za\[()*?^$|.{]'  // A literal character
    ].join('|'),
    'g');

  /**
   * The characters matched by {@code /./}.
   * @type {CharRanges}
   */
  const DOT_RANGES = new CharRanges()
          .addRange(0xA).addRange(0xD).addRange(0x2028, 0x2029)
          .inverse();

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
    // TODO: We could try and fail when Kleene operators or
    // handle charsets that are in negative lookaheads differently.
    const interestingParts = source.match(CHAR_RANGE_RELEVANT_OPERATORS);
    const n = interestingParts.length;

    // Accumulate all ranges onto charRanges.
    const charRanges = new CharRanges();

    for (var i = 0; i < n; ++i) {
      const interestingPart = interestingParts[i];
      switch (interestingPart[0]) {
      case '\\':
        addEscapeValueTo(interestingPart, false, charRanges);
        break;
      case '.':
        charRanges.add(DOT_RANGES);
        break;
      case '[':
        addCharSetTo(interestingPart, charRanges);
        break;
      case '(': case ')': case '{':
        break;
      default:
        charRanges.addRange(interestingPart.charCodeAt(0));
      }
    }

    charRanges.canonicalize();
    if (flags.indexOf('i') >= 0) {
      // Fold letters.
      // TODO: Read spec and figure out what to do with non-ASCII characters.
      const upperLetters = charRanges.intersectionWithRange(
        'A'.charCodeAt(0), 'Z'.charCodeAt(0));
      const lowerLetters = charRanges.intersectionWithRange(
        'a'.charCodeAt(0), 'z'.charCodeAt(0));
      charRanges.addAll(upperLetters.shifted(+32));
      charRanges.addAll(lowerLetters.shifted(-32));
      charRanges.canonicalize();
    }
    return charRanges.toString();
  }

  /** Space characters that match \s */
  const SPACE_CHARS = addCharSetTo(
    '[ \f\n\r\t\v\u00a0\u1680\u180e\u2000-\u200a'
    + '\u2028\u2029\u202f\u205f\u3000\ufeff]',
    new CharRanges());
  /** Word chars that match \w */
  const WORD_CHARS = addCharSetTo(
    '[A-Za-z0-9_]',
    new CharRanges());
  /** Digit chars that match \d */
  const DIGIT_CHARS = addCharSetTo(
    '[0-9]',
    new CharRanges());
  /** Maps letters after \ that are special in RegExps. */
  const ESCAPE_SEQ_MAP = new Map([
    ['s', SPACE_CHARS],
    ['S', SPACE_CHARS.inverse()],
    ['w', WORD_CHARS],
    ['W', WORD_CHARS.inverse()],
    ['d', DIGIT_CHARS],
    ['D', DIGIT_CHARS.inverse()],
    ['t', new CharRanges().addRange(0x9)],
    ['n', new CharRanges().addRange(0xA)],
    ['v', new CharRanges().addRange(0xB)],
    ['f', new CharRanges().addRange(0xC)],
    ['r', new CharRanges().addRange(0xD)],
    // b doesn't appear here since its meaning depends on context.
    ['B', new CharRanges()]
  ]);

  /**
   * Parses a RegExp charSet and adds its ranges to the given set.
   *
   * @param {string} charSet the text of a RegExp charset including any
   *   square brackets.
   * @param {CharRanges} ranges to add to.
   *
   * @return ranges to allow chaining.
   */
  function addCharSetTo(charSet, ranges) {
    const isInverted = /^\[\^/.test(charSet);
    const rangesToAddTo = isInverted ? new CharRanges() : ranges;
    const body = charSet.replace(/^\[\^?|\]$/g, '');
    const bodyParts = body.match(CHARSET_PARTS_RE);
    const n = bodyParts.length;
    for (var i = 0; i < n; ++i) {
      const bodyPart = bodyParts[i];
      if (bodyPart.indexOf('-') >= 0) {
        const m = CHARSET_RANGE_RE.exec(bodyPart);
        const lt = rangeEndPointToCodeUnit(m[1]);
        const rt = m[2] ? rangeEndPointToCodeUnit(m[2]) : lt;
        rangesToAddTo.addRange(lt, rt);
      } else if (bodyPart[0] == '\\') {
        addEscapeValueTo(bodyPart, true, rangesToAddTo);
      } else {
        rangesToAddTo.addRange(bodyPart.charCodeAt(0));
      }
    }
    if (isInverted) {
      ranges.addAll(rangesToAddTo.inverse());
    }
    return ranges;
  }

  /**
   * The code-unit corresponding to the end-point of a range.
   * TODO; What does [\s-\w] mean?
   */
  function rangeEndPointToCodeUnit(endPoint) {
    var cu = (
      (endPoint[0] == '\\')
        ? addEscapeValueTo(endPoint, true, new CharRanges()).getMin()
        : endPoint.charCodeAt(0)
    );
    return cu;
  }

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

  const PAREN_AND_BACKREF_RE = new RegExp(
    '\\\\(?:[1-9]\\d*|\\D)'  // Back-reference or escape sequence
    + '|\\[(?:[^\\\]\\\\]|\\\\[\s\S])*\\]'  // Don't look for parens in character groups
    + '|\\(\\??',  // A group open.
    'g'
  );

  function fixUpInterpolatedRegExp(source, regexGroupCount, templateGroups) {
    // Count capturing groups, and use that to identify and
    // renumber back-references that are in scope.
    var sourceGroupCount = 0;
    var hasBackRef = false;

    const parts = source.match(PAREN_AND_BACKREF_RE);
    const n = parts ? parts.length : 0;
    for (var i = 0; i < n; ++i) {
      const part = parts[i];
      switch (part[0]) {
      case '\\':
        hasBackRef = hasBackRef || !isNaN(+part.substring(1));
        break;
      case '[':
        break;
      case '(':
        if (part === '(') {  // Not the start of a non-capturing group
          ++sourceGroupCount;
        }
      }
    }

    // Rewrite back-references that are out of scope to refer
    // to the template group.
    var fixedSource = source;
    if (sourceGroupCount && hasBackRef && regexGroupCount) {
      fixedSource = source.replace(
        PAREN_AND_BACKREF_RE,
        function (part) {
          if (part[0] == '\\') {
            var backRefIndex = +part.substring(1);
            if (backRefIndex === backRefIndex) {
              if (backRefIndex <= sourceGroupCount) {
                // A local reference.
                return '\\' + (backRefIndex + regexGroupCount - 1);
              } else if (backRefIndex < templateGroups.length) {
                // A reference to a template group that is in scope.
                return '\\' + templateGroups[backRefIndex];
              } else {
                // An out of scope back-reference matches the empty string.
                return '(?:)';
              }
            }
          }
          return part;
        }
      );
    }

    return [fixedSource, sourceGroupCount];
  }

  function make(flags, template, ...values) {
    if ('string' === typeof template && values.length === 0) {
      // Allow RegExp.make(i)`...` to specify flags.
      // This calling convention is disjoint with use as a template tag
      // since the typeof a template record is 'object'.
      return make.bind(null, template /* use as flags instead */);
    }

    const raw = template.raw;
    const { contexts, templateGroupCounts } = getStaticInfo(raw);

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
      const n = templateGroupCounts[i];
      for (var j = 0; j < n; ++j) {
        templateGroups.push(regexGroupCount++);
      }
    }
    addTemplateGroups(0);

    for (var i = 0; i < n; ++i) {
      const context = contexts[i];
      const value = values[i];
      var subst;
      switch (context) {
      case BLOCK:
        if (value instanceof RegExp) {
          const [valueSource, valueGroupCount] = fixUpInterpolatedRegExp(
            String(value.source), regexGroupCount, templateGroups);
          subst = '(?:' + valueSource + ')';
          regexGroupCount += valueGroupCount;
        } else {
          subst = '(?:'
            + String(value).replace(UNSAFE_CHARS_BLOCK, '\\$&')
            + ')';
        }
        break;
      case COUNT:
        subst = (+value || '0');
        break;
      case CHARSET:
        // TODO: We need to keep track of whether we're interpolating
        // into an inverted charset or not.
        subst =
          (value instanceof RegExp)
          ? toCharRanges(String(value.source), String(value.flags))
          : String(value).replace(UNSAFE_CHARS_CHARSET, '\\$&');
        break;
      }
      pattern += subst;
      pattern += raw[i+1];
      addTemplateGroups(i+1);
    }
    const output = new RegExp(pattern, flags);
    output.templateGroups = templateGroups;
    return output;
  }

  return make.bind(null, '' /* No flags by default */);
})();

// TODO: Figure out interpolation of charset after - as in `[a-${...}]`
// TODO: Maybe rewrite back-references in the template.
