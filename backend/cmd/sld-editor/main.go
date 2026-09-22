package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"sld-editor/internal/api"
	"sld-editor/internal/config"
	"sld-editor/internal/elements"
	"sld-editor/internal/storage"
	"sld-editor/pkg/configuration"
	"sld-editor/pkg/llog"

	"github.com/PVKonovalov/slddoc"
	"github.com/pkg/browser"
)

func main() {
	configFile := flag.String("config", "config/sld-editor.yaml", "path to the YAML configuration file")
	openBrowser := flag.Bool("open-browser", false, "open the browser automatically")
	flag.Parse()

	var cfg config.Config
	if err := configuration.Read(*configFile, &cfg); err != nil {
		llog.Logger.Fatalf("loading configuration (%s): %v", *configFile, err)
	}

	if level, err := llog.ParseLevel(cfg.Logging.Level); err != nil {
		llog.Logger.Warnf("invalid log level %q, defaulting to info: %v", cfg.Logging.Level, err)
		llog.Logger.SetLevel(llog.InfoLevel)
	} else {
		llog.Logger.SetLevel(level)
	}

	lib, err := elements.LoadAll(cfg.Elements.Libraries)
	if err != nil {
		llog.Logger.Fatalf("loading element libraries: %v", err)
	}
	llog.Logger.Infof("loaded %d element symbol(s) from %d configured element library file(s)", len(lib.Symbols), len(cfg.Elements.Libraries))

	if err := lib.ValidatePalette(cfg.Palette); err != nil {
		llog.Logger.Fatalf("validating palette configuration: %v", err)
	}

	stateColors := make([]slddoc.StateColor, len(cfg.StateColors))
	for i, sc := range cfg.StateColors {
		stateColors[i] = slddoc.StateColor{State: sc.State, Label: sc.Label, Color: sc.Color}
	}
	fpiColors := make([]slddoc.StateColor, len(cfg.FPIStateColors))
	for i, sc := range cfg.FPIStateColors {
		fpiColors[i] = slddoc.StateColor{State: sc.State, Label: sc.Label, Color: sc.Color}
	}

	store, err := storage.New(cfg.Diagrams.Dir, lib.SymbolLibrary(), cfg.Indicators.DefaultFPIText, fpiColors, stateColors...)
	if err != nil {
		llog.Logger.Fatalf("opening diagrams directory (%s): %v", cfg.Diagrams.Dir, err)
	}

	// SIGTERM is what systemd/Docker/`kill` send by default; SIGINT is
	// Ctrl-C in an interactive terminal. Either cancels ctx, which Run
	// treats as "shut down gracefully" rather than aborting in-flight
	// requests.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv := api.NewServer(store, lib, &cfg)
	llog.Logger.Infof("sld-editor listening on %s", cfg.Server.Bind)

	if *openBrowser {
		if _, port, ok := strings.Cut(cfg.Server.Bind, ":"); ok {
			go func() {
				time.Sleep(1 * time.Second)
				if err := browser.OpenURL(fmt.Sprintf("http://localhost:%s", port)); err != nil {
					llog.Logger.Errorf("opening browser: %v", err)
				}
			}()
		}
	}

	if err := srv.Run(ctx, cfg.Server.Bind); err != nil {
		llog.Logger.Fatalf("server error: %v", err)
	}
	llog.Logger.Infof("sld-editor shut down")
}
