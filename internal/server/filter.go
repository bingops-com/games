package server

import (
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// Words the site does not let through in a name, a message or a list of
// words. The list is short on purpose: it stops the obvious, and players
// report the rest (see report in moderation.go).
var foulWords = []string{
	"connard", "connasse", "encule", "enculer", "salope", "salaud", "pute", "putain", "pd", "pede", "tapette", "tarlouze",
	"negre", "negro", "bougnoule", "youpin", "bicot", "nique", "niquer", "ntm", "fdp", "batard", "bite", "couille",
	"fuck", "fucker", "shit", "bitch", "cunt", "nigger", "nigga", "faggot", "fag", "retard", "whore", "slut", "dick", "asshole",
	"nazi", "hitler",
}

var foul = func() map[string]bool {
	m := map[string]bool{}
	for _, w := range foulWords {
		m[w] = true
	}
	return m
}()

// plain lowers a word and strips its accents and the usual disguises, so that
// "Enculé", "3ncule" and "e.n.c.u.l.e" read the same.
func plain(word string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(strings.ToLower(word)) {
		switch {
		case unicode.Is(unicode.Mn, r):
		case r == '0':
			b.WriteRune('o')
		case r == '1' || r == '!':
			b.WriteRune('i')
		case r == '3':
			b.WriteRune('e')
		case r == '4' || r == '@':
			b.WriteRune('a')
		case r == '5' || r == '$':
			b.WriteRune('s')
		case unicode.IsLetter(r):
			b.WriteRune(r)
		}
	}
	return b.String()
}

func isFoul(word string) bool {
	p := plain(word)
	return foul[p] || foul[strings.TrimSuffix(p, "s")]
}

// foulName says a name contains a word that is not let through: names are
// short and often glued together, so the word is looked for inside them.
func foulName(name string) bool {
	p := plain(name)
	for _, w := range foulWords {
		if len(w) >= 4 && strings.Contains(p, w) {
			return true
		}
	}
	for _, part := range strings.FieldsFunc(name, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
		if isFoul(part) {
			return true
		}
	}
	return false
}

// cleanText replaces the words that are not let through with asterisks.
func cleanText(text string) string {
	words := strings.Fields(text)
	for i, w := range words {
		if isFoul(w) {
			words[i] = strings.Repeat("*", len([]rune(w)))
		}
	}
	return strings.Join(words, " ")
}
