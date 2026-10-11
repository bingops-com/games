// Package mail sends the few messages the site writes: links to choose a new
// password. It speaks SMTP to a relay; signing (DKIM) is the relay's job.
package mail

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"log/slog"
	"mime"
	"net"
	"net/smtp"
	"strings"
	"time"
)

type Sender interface {
	Send(ctx context.Context, to, subject, text string) error
}

// SMTP hands messages to a relay.
type SMTP struct {
	// Addr is the relay, "host:port".
	Addr string
	// User and Password authenticate when the relay asks for it; empty for a
	// relay that trusts its network.
	User, Password string
	// From is the sender a reader sees; Envelope is where bounces go, and the
	// name SPF is checked against.
	From, Envelope string
}

// Log writes messages to the log instead of sending them: what runs when no
// relay is configured, so that a developer can still follow a link.
type Log struct{ Log *slog.Logger }

func (l Log) Send(_ context.Context, to, subject, text string) error {
	l.Log.Info("mail not sent: no relay configured (GAMES_SMTP_ADDR)", "to", to, "subject", subject, "text", text)
	return nil
}

func (s SMTP) Send(ctx context.Context, to, subject, text string) error {
	if strings.ContainsAny(to, "\r\n") {
		return fmt.Errorf("mail: bad recipient")
	}
	dialer := net.Dialer{Timeout: 10 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", s.Addr)
	if err != nil {
		return err
	}
	conn.SetDeadline(time.Now().Add(30 * time.Second))
	host, _, _ := net.SplitHostPort(s.Addr)
	c, err := smtp.NewClient(conn, host)
	if err != nil {
		conn.Close()
		return err
	}
	defer c.Close()
	if ok, _ := c.Extension("STARTTLS"); ok {
		if err := c.StartTLS(&tls.Config{ServerName: host}); err != nil {
			return err
		}
	}
	if s.User != "" {
		if err := c.Auth(smtp.PlainAuth("", s.User, s.Password, host)); err != nil {
			return err
		}
	}
	if err := c.Mail(s.Envelope); err != nil {
		return err
	}
	if err := c.Rcpt(to); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	var id [12]byte
	rand.Read(id[:])
	domain := s.From[strings.LastIndex(s.From, "@")+1:]
	headers := []string{
		"From: lab.bingo games <" + s.From + ">",
		"To: <" + to + ">",
		"Subject: " + mime.QEncoding.Encode("utf-8", subject),
		"Date: " + time.Now().Format(time.RFC1123Z),
		"Message-ID: <" + hex.EncodeToString(id[:]) + "@" + domain + ">",
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"Content-Transfer-Encoding: 8bit",
		"Auto-Submitted: auto-generated",
	}
	body := strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\n", "\r\n")
	if _, err := w.Write([]byte(strings.Join(headers, "\r\n") + "\r\n\r\n" + body + "\r\n")); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}
