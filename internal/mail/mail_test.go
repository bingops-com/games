package mail

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"testing"
	"time"
)

func TestLoggingSenderNeverLeaksRecoveryData(t *testing.T) {
	var buf bytes.Buffer
	sender := Log{Log: slog.New(slog.NewTextHandler(&buf, nil))}
	err := sender.Send(context.Background(), "person@audit.invalid", "synthetic subject", "https://audit.invalid/reset?t=synthetic-bearer-token")
	if !errors.Is(err, ErrDisabled) {
		t.Fatal("missing SMTP was not reported")
	}
	for _, forbidden := range []string{"person@audit.invalid", "synthetic subject", "synthetic-bearer-token", "https://audit.invalid"} {
		if strings.Contains(buf.String(), forbidden) {
			t.Fatal("mail data leaked to the log")
		}
	}
}

func TestSMTPRefusesPlaintextBeforeSendingMail(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	commands := make(chan []string, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			commands <- nil
			return
		}
		defer conn.Close()
		conn.SetDeadline(time.Now().Add(3 * time.Second))
		fmt.Fprint(conn, "220 audit.invalid ESMTP\r\n")
		var seen []string
		reader := bufio.NewScanner(conn)
		for reader.Scan() {
			seen = append(seen, reader.Text())
			if strings.HasPrefix(reader.Text(), "EHLO ") {
				fmt.Fprint(conn, "250 audit.invalid\r\n")
			} else {
				fmt.Fprint(conn, "250 ok\r\n")
			}
		}
		commands <- seen
	}()
	err = (SMTP{Addr: listener.Addr().String(), From: "noreply@audit.invalid", Envelope: "bounces@audit.invalid", RequireTLS: true}).Send(context.Background(), "person@audit.invalid", "test", "synthetic-bearer")
	if err == nil || !strings.Contains(err.Error(), "STARTTLS") {
		t.Fatal("plaintext relay accepted:", err)
	}
	for _, command := range <-commands {
		if strings.HasPrefix(command, "MAIL") || strings.HasPrefix(command, "DATA") {
			t.Fatal("sent mail before encryption")
		}
	}
}
