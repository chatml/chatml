// Copyright 2014 Codehack.com All rights reserved.
// Use of this source code is governed by a MIT-style
// license that can be found in the LICENSE file.

package strarr

import (
	"strings"
	"testing"
)

var (
	arr  = []string{"Lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit", "donec", "tempus", "Lorem"}
	arr2 = []string{"*L*", "*i*", "*d*", "*s*", "*a*", "*c*", "*a*", "*e*", "*d*", "*t*", "*L*"}
)

func TestIndex(t *testing.T) {
	if e, i := 2, Index(arr, "dolor"); i != e {
		t.Errorf("expecting %d got %d", e, i)
	}
	if e, i := -1, Index(arr, "horse"); i != e {
		t.Errorf("expecting %d got %d", e, i)
	}
}
func TestIndexPrefix(t *testing.T) {
	if e, i := 2, IndexPrefix(arr, "do"); i != e {
		t.Errorf("expecting %d got %d", e, i)
	}
	if e, i := -1, IndexPrefix(arr, "xxx"); i != e {
		t.Errorf("expecting %d got %d", e, i)
	}
}
func TestIndexSuffix(t *testing.T) {
	if e, i := 3, IndexSuffix(arr, "it"); i != e {
		t.Errorf("expecting %d got %d", e, i)
	}
	if e, i := -1, IndexSuffix(arr, "xxx"); i != e {
		t.Errorf("expecting %d got %d", e, i)
	}
}
func TestSearch(t *testing.T) {
	if e, i := 5, Search(arr, "sect"); i != e {
		t.Errorf("expecting %d got %d", e, i)
	}
	if e, i := -1, Search(arr, "xxx"); i != e {
		t.Errorf("expecting %d got %d", e, i)
	}
}
func TestLastIndex(t *testing.T) {
	if e, i := 2, LastIndex(arr, "dolor"); i != e {
		t.Errorf("expecting %d got %d", e, i)
	}
	if e, i := -1, LastIndex(arr, "horse"); i != e {
		t.Errorf("expecting %d got %d", e, i)
	}
}
func TestLastIndexPrefix(t *testing.T) {
	if e, i := 8, LastIndexPrefix(arr, "do"); i != e {
		t.Errorf("expecting %d got %d", e, i)
	}
	if e, i := -1, LastIndexPrefix(arr, "xxx"); i != e {
		t.Errorf("expecting %d got %d", e, i)
	}
}
func TestLastIndexSuffix(t *testing.T) {
	if e, i := 7, LastIndexSuffix(arr, "it"); i != e {
		t.Errorf("expecting %d got %d", e, i)
	}
	if e, i := -1, LastIndexSuffix(arr, "xxx"); i != e {
		t.Errorf("expecting %d got %d", e, i)
	}
}
func TestLastSearch(t *testing.T) {
	if e, i := 5, LastSearch(arr, "sect"); i != e {
		t.Errorf("expecting %d got %d", e, i)
	}
	if e, i := -1, LastSearch(arr, "xxx"); i != e {
		t.Errorf("expecting %d got %d", e, i)
	}
}
func TestContains(t *testing.T) {
	if e, i := true, Contains(arr, "adipiscing"); i != e {
		t.Errorf("expecting %t got %t", e, i)
	}
	if e, i := false, Contains(arr, "codehack"); i != e {
		t.Errorf("expecting %t got %t", e, i)
	}
}
func TestContainsPrefix(t *testing.T) {
	if e, i := true, ContainsPrefix(arr, "adip"); i != e {
		t.Errorf("expecting %t got %t", e, i)
	}
	if e, i := false, ContainsPrefix(arr, "xxx"); i != e {
		t.Errorf("expecting %t got %t", e, i)
	}
}
func TestContainsSuffix(t *testing.T) {
	if e, i := true, ContainsSuffix(arr, "scing"); i != e {
		t.Errorf("expecting %t got %t", e, i)
	}
	if e, i := false, ContainsSuffix(arr, "xxx"); i != e {
		t.Errorf("expecting %t got %t", e, i)
	}
}
func TestCount(t *testing.T) {
	if e, i := 2, Count(arr, "Lorem"); i != e {
		t.Errorf("expecting %d got %d", e, i)
	}
	if e, i := 0, Count(arr, "codehack"); i != e {
		t.Errorf("expecting %d got %d", e, i)
	}
}
func TestMap(t *testing.T) {
	mapping := func(k string) string {
		return "*" + string(k[0]) + "*"
	}
	e := strings.Join(arr2, "")
	m := strings.Join(Map(mapping, arr), "")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestToUpper(t *testing.T) {
	e := "LOREMIPSUMDOLORSITAMET"
	m := strings.Join(ToUpper(arr[:5]), "")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestTolower(t *testing.T) {
	e := "loremipsumdolorsitamet"
	m := strings.Join(ToLower(arr[:5]), "")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestToTitle(t *testing.T) {
	e := "LoremIpsumDolorSitAmet"
	m := strings.Join(ToTitle(arr[:5]), "")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestTrim(t *testing.T) {
	e := "*L**i**d**s**c*"
	m := strings.Join(Trim(arr2[:7], "*a*"), "")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestTrimFunc(t *testing.T) {
	e := "*L**i**d**s**c*"
	f := func(v, s string) bool { return strings.Contains(v, s) }
	m := strings.Join(TrimFunc(arr2[:7], "a", f), "")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestTrimPrefix(t *testing.T) {
	e := "*L**i**d**s**c*"
	m := strings.Join(TrimPrefix(arr2[:7], "*a"), "")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestTrimSuffix(t *testing.T) {
	e := "*L**i**d**s**c*"
	m := strings.Join(TrimSuffix(arr2[:7], "a*"), "")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestFilter(t *testing.T) {
	e := "*a**a*"
	m := strings.Join(Filter(arr2[:7], "*a*"), "")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestFilterFunc(t *testing.T) {
	e := "*a**a*"
	f := func(v, s string) bool { return strings.Contains(v, s) }
	m := strings.Join(FilterFunc(arr2[:7], "a", f), "")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestFilterPrefix(t *testing.T) {
	e := "*a**a*"
	m := strings.Join(FilterPrefix(arr2[:7], "*a"), "")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestFilterSuffix(t *testing.T) {
	e := "*a**a*"
	m := strings.Join(FilterSuffix(arr2[:7], "a*"), "")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestDiff(t *testing.T) {
	e := "*i**s**c*"
	m := strings.Join(Diff(arr2[:6], arr2[6:]), "")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestIntersect(t *testing.T) {
	e := "*L**d**a*"
	m := strings.Join(Intersect(arr2[:6], arr2[6:]), "")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestRepeat(t *testing.T) {
	e := "loremloremloremloremlorem"
	m := strings.Join(Repeat("lorem", 5), "")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestReplace(t *testing.T) {
	e := "Lorem ipsum dolor sit amet"
	m := strings.Join(Replace(arr2[:2], arr[:5]), " ")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
	e = "*L* *i* dolor sit amet"
	m = strings.Join(Replace(arr[:5], arr2[:2]), " ")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
	e = "Lorem ipsum dolor"
	m = strings.Join(Replace(nil, arr[:3]), " ")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
	e = "*L* *i* *d*"
	m = strings.Join(Replace(arr2[:3], nil), " ")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
	e = ""
	m = strings.Join(Replace(nil, nil), " ")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestRand(t *testing.T) {
	e := 5
	m := Rand(arr, 5)
	if len(m) != e {
		t.Errorf("expecting %T got %T", e, m)
	}
}
func TestShuffle(t *testing.T) {
	e := strings.Join(arr, "")
	m := strings.Join(Shuffle(arr), "")
	if m == e {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestReverse(t *testing.T) {
	e := "amet sit dolor ipsum Lorem"
	m := strings.Join(Reverse(arr[:5]), " ")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
	e = "Lorem ipsum dolor sit amet"
	m = strings.Join(Reverse(Reverse(arr[:5])), " ")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
	e = ""
	m = strings.Join(Reverse(nil), " ")
	if m != e {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestShift(t *testing.T) {
	e := "ipsum"
	m := Shift(&arr)
	if m != "Lorem" || arr[0] != e {
		t.Errorf("expecting %q got %q", e, m)
	}
	bar := []string{"something"}
	e = ""
	m = Shift(&bar)
	if m != "something" || len(bar) != 0 {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestUnshift(t *testing.T) {
	e := "Lorem"
	m := Unshift(&arr, "Lorem")
	if m != 11 || arr[0] != e {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestPop(t *testing.T) {
	e := "tempus"
	m := Pop(&arr)
	if m != "Lorem" || arr[9] != e {
		t.Errorf("expecting %q got %q", e, m)
	}
	bar := []string{"something"}
	e = ""
	m = Pop(&bar)
	if m != "something" || len(bar) != 0 {
		t.Errorf("expecting %q got %q", e, m)
	}
}
func TestPush(t *testing.T) {
	e := "Lorem"
	m := Push(&arr, "Lorem")
	if m != 11 || arr[10] != e {
		t.Errorf("expecting %q got %q", e, m)
	}
}
