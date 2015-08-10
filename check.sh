#!/bin/bash

java -jar tools/compiler.jar --language_in=ECMASCRIPT6 --warning_level=VERBOSE --jscomp_error="*" --compilation_level=ADVANCED --js RegExp.make.js --externs externs.js
