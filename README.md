# regexp-make-js
`RegExp.make` is an ES6 string template tag for dynamically creating regular expressions.

## Usage

```javascript
RegExp.make`^${foo},${bar}$`
```

is a `RegExp` instance that matches the whole string (`^...$`)
consisting of a substring matching the value of the expression `foo`
followed by the literal substring `","` followed by a substring
matching the value of the expression `bar`.

Interpolated expressions like `foo` and `bar` can be strings, or `RegExp`
instances, or other values that are coerced to strings.

`RegExp` instances are treated like the set of substrings they match
-- their source is not used as a literal string.

```javascript
RegExp.make`^${ /fo+/ }$`
```

matches the entire string consisting of `'f'` followed by one or more
`'o'`s; the Kleene + is not treated literally.


## Goals

This currently uses the subset of EcmaScript 2015 (ES6) that is
implemented on FF >= 39. To see the test visit the
[test page](https://rawgit.com/mikesamuel/regexp-make-js/master/test/)
in your browser using Firefox.

This is a proposed alternative to
[RegExp.escape](https://github.com/benjamingr/RegExp.escape).
To get simply the equivalent functionality of `RegExp.escape`,
anywhere you would have said

```javascript
RegExp.escape(str)
```

you can say instead

```javascript
RegExp.make`${str}`.source
```

However, if you do only that you have not gained anything. The
advantage of using the tag is that it can do reliable
context-dependent escaping of the string as interpolated into RegExp
source text. Where you might have said, for example,

```javascript
const re = new RegExp('^(' + RegExp.escape(str) + ')$');
```

with `RegExp.make` you can say instead

```javascript
const re = RegExp.make`^(${str})$`;
```

## Expressions

| Context | Example | String | Numeric | RegExp |
| ------- | ------- | ------ | ------- | ------ |
| Block   | `/${...}/` | Treated literally | Treated Literally | With back-references adjusted |
| Charset | `/[^${...}]/` | Individual chars | Individual Chars | All chars in any string matched by the RegExp |
| Count   | `/x{1,${...}}/` | Inlined without wrapping | Inlined without wrapping | Inlined without wrapping |

Interpolated values are treated as atoms so

```javascript
RegExp.make`${foo}*`
```

matches any number of the pattern specified by `foo`; it's not just
the last character in that pattern that the Kleene star applies to.


## Flags

```javascript
RegExp.make('i')`^${foo}$`
```

applies the `i` flag (case-insensitive) to the RegExp after interpolation happens,
so substrings matched by the expression `foo` are matched case-insensitively.


When a case-insensitive `RegExp` is interpolated into a case-sensitive one, the
interpolated one still matches case insensitively.

```javascript
RegExp.make`foo-${ /bar/i }`
```

matches `"foo-BAR"` but not `"FOO-BAR"`.



## Groups

`RegExp`s produced have the `templateGroups` property set so that if
values specify groups, you can figure out the group index of a group
specified by the template.

```javascript
var re = RegExp.make`${ /(foo)/ }(\d+)`;
//           value group ^       ^ template group 1
var match = "foo123".match();
match[1] === 'foo';  // Because of /(foo)/
match[re.templateGroups[1]] === '123';
```


## TODO

* [The `u` flag](https://mathiasbynens.be/notes/es6-unicode-regex) is not recognized and it should affect how we do case-folding and treat `.`, `\w` character classes, `\u{...}` escapes, etc.
