package games

import "encoding/json"

// A drawing is a list of strokes on a sheet 1000 wide and 1000 high (the
// page stretches it to its own shape). Points travel as text, two base-36
// digits for x then two for y, so that a stroke of a hundred points is four
// hundred characters.

const (
	sketchColors  = 12
	sketchStrokes = 600
	sketchPoints  = 9000
)

type stroke struct {
	C int    `json:"c"` // colour, an index in the page's palette
	W int    `json:"w"` // width: 0 fine, 1 medium, 2 thick
	P string `json:"p"`
}

type sketch struct {
	strokes []stroke
	points  int
}

func validPoints(p string) bool {
	if len(p) == 0 || len(p)%4 != 0 || len(p) > 2400 {
		return false
	}
	for i := 0; i < len(p); i++ {
		if c := p[i]; !(c >= '0' && c <= '9' || c >= 'a' && c <= 'z') {
			return false
		}
	}
	for i := 0; i < len(p); i += 2 {
		digit := func(c byte) int {
			if c <= '9' {
				return int(c - '0')
			}
			return int(c-'a') + 10
		}
		if digit(p[i])*36+digit(p[i+1]) > 999 {
			return false
		}
	}
	return true
}

// act applies a drawing action; ok is false when the action is not one.
func (s *sketch) act(t string, action json.RawMessage) (ok bool, err error) {
	var a struct {
		C int    `json:"c"`
		W int    `json:"w"`
		P string `json:"p"`
	}
	switch t {
	case "begin", "more":
		if json.Unmarshal(action, &a) != nil || !validPoints(a.P) {
			return true, Error("Trait illisible")
		}
		if s.points+len(a.P)/4 > sketchPoints {
			return true, Error("Le dessin est plein : effacez pour continuer")
		}
		if t == "begin" {
			if a.C < 0 || a.C >= sketchColors || a.W < 0 || a.W > 2 || len(s.strokes) >= sketchStrokes {
				return true, Error("Le dessin est plein : effacez pour continuer")
			}
			s.strokes = append(s.strokes, stroke{C: a.C, W: a.W, P: a.P})
		} else {
			if len(s.strokes) == 0 {
				return true, nil
			}
			s.strokes[len(s.strokes)-1].P += a.P
		}
		s.points += len(a.P) / 4
	case "undo":
		if n := len(s.strokes); n > 0 {
			s.points -= len(s.strokes[n-1].P) / 4
			s.strokes = s.strokes[:n-1]
		}
	case "clear":
		s.strokes, s.points = nil, 0
	default:
		return false, nil
	}
	return true, nil
}

// view is the drawing as the page reads it, never null.
func (s *sketch) view() []stroke {
	out := make([]stroke, len(s.strokes))
	copy(out, s.strokes)
	return out
}
