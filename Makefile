#
# loadgen
#

NODE_VERSION =		v0.10.26
NODE_BASE_URL =		http://nodejs.org/dist/$(NODE_VERSION)
NODE_TARBALL =		node-$(NODE_VERSION)-sunos-x86.tar.gz

NODE_EXEC =		$(PWD)/node/bin/node
NPM_EXEC =		$(NODE_EXEC) $(PWD)/node/bin/npm

TARBALL_NAME =		loadgen.tar.gz

.PHONY: world
#world: $(TARBALL_NAME) npm-0-stamp
world: npm-0-stamp

downloads proto:
	mkdir -p $@

downloads/$(NODE_TARBALL): downloads
	@echo "downloading node $(NODE_VERSION) ..."
	curl -f -kL -o $@ '$(NODE_BASE_URL)/$(NODE_TARBALL)'

node/bin/node: downloads/$(NODE_TARBALL)
	@echo "extracting node $(NODE_VERSION) ..."
	mkdir -p node/bin
	gtar -xz -C node --strip-components=1 -f downloads/$(NODE_TARBALL)
	touch $@

npm-0-stamp: node/bin/node
	$(NPM_EXEC) install
	touch npm-0-stamp

.PHONY:
npm-add-dep:
	if [[ -z "$(DEP)" ]]; then \
		echo "specify DEP to install" >&2; \
		exit 1; \
	fi
	$(NPM_EXEC) install $(DEP) --save

$(TARBALL_NAME): node/bin/node
	tar cfz $@ node_modules node/bin/node cmd lib bin scripts

.PHONY: clean
clean:
	rm -rf asset.tar.gz node

clobber: clean
	rm -rf node_modules downloads

