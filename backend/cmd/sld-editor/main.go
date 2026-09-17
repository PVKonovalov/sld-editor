package main

import (
	"flag"

	"sld-editor/internal/api"
	"sld-editor/internal/config"
	"sld-editor/internal/elements"
	"sld-editor/internal/slddoc"
	"sld-editor/internal/storage"
	"sld-editor/pkg/configuration"
	"sld-editor/pkg/llog"
)

func main() {
	configFile := flag.String("config", "config/sld-editor.yaml", "path to the YAML configuration file")
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

	stateColors := make([]slddoc.StateColor, len(cfg.StateColors))
	for i, sc := range cfg.StateColors {
		stateColors[i] = slddoc.StateColor{State: sc.State, Label: sc.Label, Color: sc.Color}
	}
	fpiColors := make([]slddoc.StateColor, len(cfg.FPIStateColors))
	for i, sc := range cfg.FPIStateColors {
		fpiColors[i] = slddoc.StateColor{State: sc.State, Label: sc.Label, Color: sc.Color}
	}

	store, err := storage.New(cfg.Diagrams.Dir, lib.SymbolLibrary(), fpiColors, stateColors...)
	if err != nil {
		llog.Logger.Fatalf("opening diagrams directory (%s): %v", cfg.Diagrams.Dir, err)
	}

	srv := api.NewServer(store, lib, &cfg)
	llog.Logger.Infof("sld-editor listening on %s", cfg.Server.Bind)
	if err := srv.Run(cfg.Server.Bind); err != nil {
		llog.Logger.Fatalf("server error: %v", err)
	}
}
