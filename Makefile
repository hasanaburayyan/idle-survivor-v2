publish-maincloud-clean:
	spacetime publish --module-path spacetimedb idle-survivor --delete-data -y

generate-bindings:
	spacetime generate --lang typescript --out-dir src/module_bindings --module-path spacetimedb

start:
	npm run dev