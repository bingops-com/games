package server

import (
	"errors"
	"net/url"
	"strings"
)

// Validate is also called before connecting to the database at startup.
func (c Config) Validate() error {
	if c.PublicURL != "" {
		u, err := url.Parse(c.PublicURL)
		if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || (u.Scheme != "https" && u.Scheme != "http") {
			return errors.New("GAMES_PUBLIC_URL must be an absolute HTTP(S) origin without credentials, path, query or fragment")
		}
		if c.Production && (u.Scheme != "https" || strings.EqualFold(u.Hostname(), "localhost") || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1") {
			return errors.New("production requires a public HTTPS GAMES_PUBLIC_URL")
		}
	}
	if (c.Production || c.Mail != nil) && c.PublicURL == "" {
		return errors.New("GAMES_PUBLIC_URL is required when mail or production is enabled")
	}
	if c.Production && c.Mail == nil {
		return errors.New("production requires GAMES_SMTP_ADDR; recovery links are never logged")
	}
	return nil
}
