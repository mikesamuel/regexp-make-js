# regexp-make-js
Make `RegExp.make` be an ES6 template string tag for dynamically creating regular expressions.

This currently uses the subset of EcmaScript 2015 (ES6) that is implemented on FF >= 39. To see the test run in your browser, visit https://rawgit.com/mikesamuel/regexp-make-js/master/test.html using Firefox.

This is a proposed alternative to https://github.com/benjamingr/RegExp.escape . To get simply the equivalent functionality of `RegExp.escape`, anywhere you would have said
```javascript
RegExp.escape(str)
```
you can say instead
```javascript
RegExp.make`${str}`.source
```
However, if you do only that you have not gained anything. The advantage of using the tag is that it can do reliable context-dependent escaping of the string as interpolated into RegExp source text. Where you might have said, for example,
```javascript
const re = new RegExp('^(' + RegExp.escape(str) + ')$');
```
with `RegExp.make` you can say instead
```javascript
const re = RegExp.make`^(${str})$`;
```
