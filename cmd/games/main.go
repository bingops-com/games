// games serves accounts, live game rooms and the embedded interface.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/bingops-com/games/internal/server"
	"github.com/bingops-com/games/internal/store"
	"github.com/bingops-com/games/web"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	if err := serve(log); err != nil {
		log.Error("games stopped", "err", err)
		os.Exit(1)
	}
}

func serve(log *slog.Logger) error {
	url := os.Getenv("GAMES_DATABASE_URL")
	if url == "" {
		return errors.New("GAMES_DATABASE_URL is not set (postgres://user:password@host:5432/games)")
	}
	production := os.Getenv("GAMES_PRODUCTION") == "true"
	cfg := server.Config{Production: production, TrustProxy: os.Getenv("GAMES_TRUST_PROXY") == "true", Log: log, PublicURL: os.Getenv("GAMES_PUBLIC_URL")}
	if err := cfg.Validate(); err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	// The database may still be starting when the server does.
	var st *store.Store
	var err error
	for attempt := 1; ; attempt++ {
		open, cancel := context.WithTimeout(ctx, 10*time.Second)
		st, err = store.Open(open, url)
		cancel()
		if err == nil {
			break
		}
		if attempt == 10 || ctx.Err() != nil {
			return err
		}
		log.Warn("database not ready, retrying", "attempt", attempt, "err", err)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
	defer st.Close()
	srv, err := server.New(st, web.Files(), cfg)
	if err != nil {
		return err
	}
	go srv.Housekeeping(ctx)
	hs := &http.Server{
		Addr:              env("GAMES_ADDR", ":3778"),
		Handler:           srv,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    16 << 10,
		ErrorLog:          slog.NewLogLogger(log.Handler(), slog.LevelWarn),
	}
	failed := make(chan error, 1)
	go func() { failed <- hs.ListenAndServe() }()
	log.Info("games listening", "addr", hs.Addr)
	select {
	case err := <-failed:
		return err
	case <-ctx.Done():
	}
	shut, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := hs.Shutdown(shut); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	log.Info("games stopped")
	return nil
}
