# Unresolved Issues

## [How should flags be specified](https://github.com/mikesamuel/regexp-make-js/issues/19)

Syntax | Example
------ | -------
Current   | `RegExp.make('i')`foo`
Alternate | `RegExp.make`/foo/i`

## [Group Indexes when a RegExp with groups is interpolated](https://github.com/mikesamuel/regexp-make-js/issues/1)

Right now

```js
var litRegex = /f(o)o/;

var regexWithInterpolation = RegExp.make`(bar) ${myRegex} (baz)`;

var match = regexWithInterpolation.exec('bar foo baz');

// How can I reliably extract "baz" from match?
```

Approach | Example
-------- | -------
Current  | match[regexWithInterpolation.templateGroups[2]]
Alterante | ???