RegExp.make = (function () {
    var BLOCK = 0;
    var BACKSLASH = 1;
    var CHARSET = 2;
    var COUNT = 3;

    // For each context, group 1 matches any token that exits the
    // context.
    var CONTEXT_TOKENS = [
            /^(?:([\\\{\[])|(?:[^\\\{\[]|\\.)+)/,
            /^(?:[\s\S])/,
            /^(?:(\])|(?:[^\]\\]|\\.)+)/,
            /^(?:([\}])|[^\}]+)/,
    ];
    
    function computeContexts(regexParts) {
        var contexts = [];
        var flags = '';

        var i = 0;
        var n = regexParts.length;
        var context = BLOCK;
        // We step over parts and consume tokens until we reach an
        // interpolation point.

        // Use the (non-JS) convention that
        // (?i)
        // at the start specifies the flag i
        var m = /^\(\?([gim]*)\)/.exec(regexParts[0]);
        if (m) {
            flags = m[1];
            regexParts[0] = regexParts[0].substring(m[0].length);
        }
        
        var currentPart = regexParts[0];
        while (i < n || currentPart) {
            if (!currentPart) {
                // We've reached an interpolation point.
                ++i;
                currentPart = regexParts[i];
                contexts.push(context);
                continue;
            }
            m = CONTEXT_TOKENS[context].exec(currentPart);
            currentPart = currentPart.substring(m[0].length);
            if (!m[0].length) { throw new Error(currentPart); }
            if (m[1]) {
                switch (context) {
                case BLOCK:
                    switch (m[1]) {
                    case '\\': context = BACKSLASH; break;
                    case '[':  context = CHARSET;   break;
                    case '{':  context = COUNT;     break;
                    default: throw new Error(m[1]);
                    }
                    break;
                case BACKSLASH:
                case CHARSET:
                case COUNT:
                    context = BLOCK;
                    break;
                }
            }
        }

	// We don't need the context after the last part
	// since no value is interpolated there.
	contexts.length--;

        regexParts.contexts = contexts;
        regexParts.flags = flags;
    }

    var UNSAFE_CHARS_BLOCK = /[\\(){}\[\]\|\?\*\+\^\$\/]/g;
    var UNSAFE_CHARS_CHARSET = /[\]\-\\]/g;

    function destructureChars(source) {
        var n = source.length;
        if (source.charAt(0) === '['
            && source.charAt(n - 1) === ']') {
            // Guard \ at the end and unescaped ].
            var chars = source.substring(1, n - 1).replace(
                /((?:^|[^\\])(?:\\\\)*)(?:\\$|\])/g, '\\$&');
            return chars;
        }
	return '';
    }
    
    return function (regexParts, valuesVarArgs) {
	values = [];
	values.push.apply(values, arguments);
	values.shift();

        var contexts = regexParts.contexts;
        if (!contexts) {
            computeContexts(regexParts)
            contexts = regexParts.contexts
        }
        var flags = regexParts.flags;

        var n = contexts.length;
        var pattern = regexParts[0];
        for (var i = 0; i < n; ++i) {
            var context = contexts[i];
            var value = values[i];
            var subst;
            switch (context) {
            case BLOCK:
                subst = '(?:'
                    + (
                        (value instanceof RegExp)
                            ? String(value.source)
                            : String(value).replace(UNSAFE_CHARS_BLOCK, '\\$&')
                    )
                    + ')';
                break;
            case BACKSLASH:
            case COUNT:
                subst = (+value || '0');
                break;
            case CHARSET:
                subst =
                    (value instanceof RegExp)
                    ? destructureChars(String(value.source))
                    : String(value).replace(UNSAFE_CHARS_CHARSET, '\\$&');
                break;
            }
            pattern += subst;
            pattern += regexParts[i+1];
        }
        return new RegExp(pattern, flags);
    }

    // TODO: When interpolating regular expressions, turn capturing groups into non-capturing groups.
    // TODO: Rewrite a-z when interpolating charsets that have a different case-sensitivity.

})();
