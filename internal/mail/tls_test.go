package mail

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSMTPVerifiesCertificateName(t *testing.T) {
	// A fresh process loads this synthetic CA through the normal system trust
	// mechanism, without a test hook or disabled verification in SMTP.Send.
	if address := os.Getenv("GAMES_SMTP_TEST_ADDR"); address != "" {
		err := (SMTP{
			Addr: address, ServerName: os.Getenv("GAMES_SMTP_TEST_NAME"), RequireTLS: true,
			User: "synthetic-user", Password: "synthetic-password",
			From: "noreply@example.invalid", Envelope: "bounces@example.invalid",
		}).Send(context.Background(), "recipient@example.invalid", "synthetic subject", "synthetic body")
		if os.Getenv("GAMES_SMTP_TEST_REJECT") == "true" {
			if err == nil || !strings.Contains(err.Error(), "certificate") {
				t.Fatalf("expected certificate rejection, got %v", err)
			}
		} else if err != nil {
			t.Fatal(err)
		}
		return
	}
	private, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	certificate := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "smtp.example.invalid"},
		DNSNames: []string{"smtp.example.invalid"}, IsCA: true, BasicConstraintsValid: true,
		KeyUsage:    x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		NotBefore:   time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
	}
	der, err := x509.CreateCertificate(rand.Reader, certificate, certificate, private.Public(), private)
	if err != nil {
		t.Fatal(err)
	}
	caPath := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(caPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0600); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	delivered := make(chan bool, 3)
	go func() {
		for range 3 {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			func() {
				defer conn.Close()
				conn.SetDeadline(time.Now().Add(5 * time.Second))
				fmt.Fprint(conn, "220 smtp.example.invalid ESMTP\r\n")
				reader := bufio.NewScanner(conn)
				encrypted, authenticated := false, false
				for reader.Scan() {
					line := reader.Text()
					switch {
					case strings.HasPrefix(line, "EHLO"):
						if encrypted {
							fmt.Fprint(conn, "250-smtp.example.invalid\r\n250 AUTH PLAIN\r\n")
						} else {
							fmt.Fprint(conn, "250-smtp.example.invalid\r\n250 STARTTLS\r\n")
						}
					case line == "STARTTLS":
						fmt.Fprint(conn, "220 ready\r\n")
						secured := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: private}}, MinVersion: tls.VersionTLS12})
						if secured.Handshake() != nil {
							return
						}
						conn, reader, encrypted = secured, bufio.NewScanner(secured), true
					case strings.HasPrefix(line, "AUTH ") && encrypted:
						authenticated = true
						fmt.Fprint(conn, "235 authenticated\r\n")
					case line == "DATA" && encrypted && authenticated:
						fmt.Fprint(conn, "354 send message\r\n")
						for reader.Scan() && reader.Text() != "." {
						}
						delivered <- true
						fmt.Fprint(conn, "250 queued\r\n")
					case line == "QUIT":
						fmt.Fprint(conn, "221 bye\r\n")
						return
					default:
						fmt.Fprint(conn, "250 ok\r\n")
					}
				}
			}()
		}
	}()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"smtp.example.invalid", "other.example.invalid", ""} {
		t.Run(name, func(t *testing.T) {
			command := exec.Command(executable, "-test.run=^TestSMTPVerifiesCertificateName$")
			command.Env = append(os.Environ(), "SSL_CERT_FILE="+caPath, "SSL_CERT_DIR="+t.TempDir(),
				"GAMES_SMTP_TEST_ADDR="+listener.Addr().String(), "GAMES_SMTP_TEST_NAME="+name,
				fmt.Sprintf("GAMES_SMTP_TEST_REJECT=%t", name != "smtp.example.invalid"))
			if output, err := command.CombinedOutput(); err != nil {
				t.Fatalf("SMTP TLS client: %v\n%s", err, output)
			}
		})
	}
	if len(delivered) != 1 {
		t.Fatalf("delivered %d messages; only the valid certificate name may deliver", len(delivered))
	}
}
