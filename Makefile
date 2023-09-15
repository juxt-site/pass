.PHONY: compile clean

compile: dist/index.js dist/utils.js

dist/index.js:	tsconfig.json
	tsc -p tsconfig.json

clean:
	rm dist/index.js dist/utils.js
