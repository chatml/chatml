OK_COLOR=\033[32;01m
NO_COLOR=\033[0m
ULIMIT=9000

TEST_ARTIFACTS = chatmld chatmld.race search_index
BUILDTAGS=debug

include Makefile.INCLUDE

release: all
	BUILDTAGS=release

debug: all
	BUILDTAGS=debug

all: binary test

$(GOCC): $(BUILD_PATH)/cache/$(GOPKG)
	@echo "$(OK_COLOR)==> Extracting $(GOPKG) into build directory $(NO_COLOR)"
	tar -C $(BUILD_PATH)/root -xzf $<
	touch $@

$(BUILD_PATH)/cache/$(GOPKG):
	@echo "$(OK_COLOR)==> Downloading GoLang compiler package $(NO_COLOR)"
	$(CURL) -o $@ -L $(GOURL)/$(GOPKG)

$(SELFLINK): $(GOPATH)
	@echo "$(OK_COLOR)==> Creating Symlink into Build workspace$(NO_COLOR)"
	mkdir -p $(GOPATH)/src/github.com/chatml
	@echo "$(OK_COLOR)==> $@ $(NO_COLOR)"
	ln -sFh $(CURDIR) $@

$(GOPATH): $(GOCC)
	@echo "$(OK_COLOR)==> Copying GoDep Workspace$(NO_COLOR)"
	cp -a $(CURDIR)/Godeps/_workspace $(GOPATH)

advice: $(GOCC)
	@echo "$(OK_COLOR)==> Running go vet $(NO_COLOR)"
	$(GO) vet ./...

binary: build
	@echo "$(OK_COLOR)==> Building Binary...$(NO_COLOR)"

build: $(GOPATH) config web
	@echo "$(OK_COLOR)==> Compiling source code$(NO_COLOR)"
	$(GO) build -tags '$(BUILDTAGS)' -o chatmld $(BUILDFLAGS) .

docker: build
	@echo "$(OK_COLOR)==> Building docker image$(NO_COLOR)"
	docker build -t chatml:$(REV) .

tarball: $(ARCHIVE)

$(ARCHIVE): build
	@echo "$(OK_COLOR)==> Creating Archive$(NO_COLOR)"
	tar -czf $(ARCHIVE) chatmld

benchmark: config dependencies tools web
	@echo "$(OK_COLOR)==> Running benchmarks...$(NO_COLOR)"
	$(GO) test $(GO_TEST_FLAGS) -test.run='NONE' -test.bench='.*' -test.benchmem ./... | tee benchmark.txt

clean:
	@echo "$(OK_COLOR)==> Cleaning up build environment$(NO_COLOR)"
	$(MAKE) -C $(BUILD_PATH) clean
	$(MAKE) -C config clean
	$(MAKE) -C web clean
	rm -rf $(TEST_ARTIFACTS)
	rm -rf assets
	rm -f config/config.pb.go
	-rm $(ARCHIVE)
	-find . -type f -name '*~' -exec rm '{}' ';'
	-find . -type f -name '*#' -exec rm '{}' ';'
	-find . -type f -name '.#*' -exec rm '{}' ';'

config:
	@echo "$(OK_COLOR)==> Runing config/Makefile$(NO_COLOR)"
	$(MAKE) -C config

dependencies: $(GOCC) | $(SELFLINK)
	@echo "$(OK_COLOR)==> Preparing dependencies...$(NO_COLOR)"

documentation: search_index
	@echo "$(OK_COLOR)==> Generating documentation...$(NO_COLOR)"
	godoc -http=:6060 -index -index_files='search_index'

format:
	@echo "$(OK_COLOR)==> Formatting the code $(NO_COLOR)"
	find . -iname '*.go' | egrep -v "^\./\.build|./generated|\./Godeps|\.(l|y)\.go" | xargs -n1 $(GOFMT) -w -s=true
	#find . -iname '*.go' | egrep -v "^\./\.build|./generated|\./Godeps|\.(l|y)\.go" | xargs -n1 $(GOIMPORT) -w

race_condition_binary: build
	$(GO) build -race -o chatmld.race $(BUILDFLAGS) .

race_condition_run: race_condition_binary
	./chatmld.race $(ARGUMENTS)

run: binary
	./chatmld -alsologtostderr -stderrthreshold=0 $(ARGUMENTS)

search_index:
	godoc -index -write_index -index_files='search_index'

web: dependencies
	@echo "$(OK_COLOR)==> Runing web/Makefile$(NO_COLOR)"
	$(MAKE) -C web

assets:
	@echo "$(OK_COLOR)==> Compiling Assets$(NO_COLOR)"
	$(GO) get -u github.com/jteeuwen/go-bindata/...
	$(GOBINDATA) -nomemcopy -pkg=assets -tags=$(BUILDTAGS) \
		-debug=$(if $(findstring debug,$(BUILDTAGS)),true,false) \
		-o=assets/assets_$(BUILDTAGS).go \
		web/static/...

cover:
	go test -cover -coverprofile cover.out
	go tool cover -html=cover.out


ctags:
	@ctags -R --exclude=.build --exclude=test

tag:
	git tag $(VERSION)
	git push --tags

contributors:
	echo "Contributors to Chatml, both large and small:\n" > CONTRIBUTORS
	git log --raw | grep "^Author: " | sort | uniq | cut -d ' ' -f2- | sed 's/^/- /' | cut -d '<' -f1 >> CONTRIBUTORS

install-dev-tools:
	@echo "$(OK_COLOR)==> Installing development tools $(NO_COLOR)"
	go get github.com/onsi/ginkgo/ginkgo
	go get github.com/onsi/gomega
	go get golang.org/x/tools/cmd/vet
	go get github.com/jteeuwen/go-bindata/...

.PHONY: advice binary build clean config dependencies documentation format race_condition_binary race_condition_run release run search_index tag tarball test
